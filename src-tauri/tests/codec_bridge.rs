use forwarder_core::codec::{TztCodec, TztQuery};
use forwarder_core::tcp_bridge::{TcpBridgePool, TcpTarget};
use serde_json::Value;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

const FIXED_FRAME_HEX: &str = "b7072500000064000300000200000031320006416374696f6e0300000031303003666f6f03000000626172";

fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn hex_decode(hex: &str) -> Vec<u8> {
    (0..hex.len()).step_by(2).map(|i| u8::from_str_radix(&hex[i..i + 2], 16).unwrap()).collect()
}

fn query(entries: &[(&str, &str)]) -> TztQuery {
    entries.iter().map(|(key, value)| (key.to_string(), Value::String(value.to_string()))).collect()
}

async fn read_server_frame(socket: &mut TcpStream) -> Option<Vec<u8>> {
    let mut header = [0u8; 6];
    socket.read_exact(&mut header).await.ok()?;
    let length = u32::from_le_bytes([header[2], header[3], header[4], header[5]]) as usize;
    let mut frame = header.to_vec();
    frame.resize(6 + length, 0);
    socket.read_exact(&mut frame[6..]).await.ok()?;
    Some(frame)
}

fn request_serial(request: &forwarder_core::codec::TztResponse) -> u32 {
    request
        .get("HandleSerialNo")
        .and_then(Value::as_str)
        .and_then(|text| text.parse().ok())
        .expect("request frame carries a serial")
}

#[test]
fn codec_preserves_the_fixed_regression_vectors() {
    let mut codec = TztCodec::new().unwrap();
    assert_eq!(hex_encode(&codec.rc4(b"Plaintext", "x").unwrap()), "32da9e2ceaea1a6e75");
    assert_eq!(hex_encode(&codec.rc4(b"Plaintext", "file").unwrap()), "7ad9f940a0c3d07a8f");
    assert_eq!(hex_encode(&codec.encode(&query(&[("Action", "100"), ("foo", "bar")]), 12).unwrap()), FIXED_FRAME_HEX);
}

#[test]
fn codec_preserves_long_and_utf8_text_through_the_legacy_runtime() {
    let mut codec = TztCodec::new().unwrap();
    let message = format!("中文{}", "x".repeat(100));
    let frame = codec.encode(&query(&[("Action", "100"), ("message", &message)]), 12).unwrap();
    let decoded = codec.decode(&frame).unwrap();
    assert_eq!(decoded.get("Action").and_then(Value::as_str), Some("100"));
    assert_eq!(decoded.get("message").and_then(Value::as_str), Some(message.as_str()));
    assert_eq!(decoded.get("HandleSerialNo").and_then(Value::as_str), Some("12"));
    assert!(decoded.contains_key("zzkeyByte"));
    assert!(decoded.contains_key("zzbytes"));
}

#[test]
fn codec_decodes_a_fixed_frame_and_preserves_its_serial_number() {
    let mut codec = TztCodec::new().unwrap();
    let decoded = codec.decode(&hex_decode(FIXED_FRAME_HEX)).unwrap();
    assert_eq!(decoded.get("Action").and_then(Value::as_str), Some("100"));
    assert_eq!(decoded.get("foo").and_then(Value::as_str), Some("bar"));
    assert_eq!(decoded.get("HandleSerialNo").and_then(Value::as_str), Some("12"));
    assert!(decoded.contains_key("zzkeyByte"));
    assert!(decoded.contains_key("zzbytes"));
}

#[test]
fn codec_rejects_malformed_and_truncated_frames() {
    let mut codec = TztCodec::new().unwrap();
    assert!(codec.decode(&hex_decode("b70706000000")).is_err());
    assert!(codec.decode(&hex_decode("00000700000000")).is_err());
}

#[test]
fn codec_reuses_one_runtime_across_sequential_invokes() {
    let mut codec = TztCodec::new().unwrap();
    for index in 0..20u32 {
        let frame = codec.encode(&query(&[("Action", "100")]), 12 + index).unwrap();
        assert_eq!(u16::from_le_bytes([frame[0], frame[1]]), 0x07b7);
    }
    assert_eq!(hex_encode(&codec.rc4(b"Plaintext", "file").unwrap()), "7ad9f940a0c3d07a8f");
}

#[test]
fn codec_survives_a_helper_reported_request_error() {
    let mut codec = TztCodec::new().unwrap();
    let failure = codec.decode(&hex_decode("b7070b0000000000000000000000000000")).unwrap_err();
    assert!(failure.0.contains("helper"), "unexpected error: {}", failure.0);
    assert_eq!(hex_encode(&codec.rc4(b"Plaintext", "file").unwrap()), "7ad9f940a0c3d07a8f");
}

#[tokio::test]
async fn bridge_round_trip_reuses_one_connection() {
    let accepted = Arc::new(AtomicUsize::new(0));
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let flag = accepted.clone();
    let server = tokio::spawn(async move {
        flag.fetch_add(1, Ordering::Relaxed);
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut codec = TztCodec::new().unwrap();
        for _ in 0..2 {
            let frame = read_server_frame(&mut socket).await.unwrap();
            let request = codec.decode(&frame).unwrap();
            let out = codec.encode(&query(&[("Action", "100"), ("ERRORNO", "0")]), request_serial(&request)).unwrap();
            socket.write_all(&out).await.unwrap();
        }
    });
    let pool = TcpBridgePool::new(Duration::from_secs(2), Duration::from_millis(1500)).unwrap();
    let target = TcpTarget { host: "127.0.0.1".to_string(), port };
    let first = pool.request(&target, &query(&[("Action", "100")])).await.unwrap();
    assert_eq!(first.get("ERRORNO").and_then(Value::as_str), Some("0"));
    assert!(!first.contains_key("HandleSerialNo"));
    let second = pool.request(&target, &query(&[("Action", "100")])).await.unwrap();
    assert_eq!(second.get("ERRORNO").and_then(Value::as_str), Some("0"));
    assert_eq!(accepted.load(Ordering::Relaxed), 1);
    server.abort();
}

#[tokio::test]
async fn bridge_isolates_a_single_request_timeout() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let server = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut codec = TztCodec::new().unwrap();
        let first = read_server_frame(&mut socket).await.unwrap();
        let first_serial = request_serial(&codec.decode(&first).unwrap());
        tokio::time::sleep(Duration::from_millis(400)).await;
        let late = codec.encode(&query(&[("Action", "100"), ("ERRORNO", "0")]), first_serial).unwrap();
        socket.write_all(&late).await.unwrap();
        let second = read_server_frame(&mut socket).await.unwrap();
        let second_serial = request_serial(&codec.decode(&second).unwrap());
        let out = codec.encode(&query(&[("Action", "100"), ("ERRORNO", "0")]), second_serial).unwrap();
        socket.write_all(&out).await.unwrap();
    });
    let pool = TcpBridgePool::new(Duration::from_secs(2), Duration::from_millis(300)).unwrap();
    let target = TcpTarget { host: "127.0.0.1".to_string(), port };
    let failure = pool.request(&target, &query(&[("Action", "100")])).await.unwrap_err();
    assert!(failure.0.contains("timeout"), "unexpected error: {}", failure.0);
    let second = pool.request(&target, &query(&[("Action", "100")])).await.unwrap();
    assert_eq!(second.get("ERRORNO").and_then(Value::as_str), Some("0"));
    server.abort();
}

#[tokio::test]
async fn bridge_rejects_pending_requests_when_the_target_disconnects() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let server = tokio::spawn(async move {
        let (socket, _) = listener.accept().await.unwrap();
        drop(socket);
    });
    let pool = TcpBridgePool::new(Duration::from_secs(2), Duration::from_millis(1500)).unwrap();
    let target = TcpTarget { host: "127.0.0.1".to_string(), port };
    let failure = pool.request(&target, &query(&[("Action", "100")])).await.unwrap_err();
    assert!(failure.0.contains("closed"), "unexpected error: {}", failure.0);
    server.abort();
}

#[tokio::test]
async fn bridge_carries_frames_larger_than_one_mib() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let server = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut codec = TztCodec::new().unwrap();
        let frame = read_server_frame(&mut socket).await.unwrap();
        let request = codec.decode(&frame).unwrap();
        let big = "x".repeat(1_500_000);
        let out = codec.encode(&query(&[("Action", "100"), ("BIG", &big)]), request_serial(&request)).unwrap();
        socket.write_all(&out).await.unwrap();
    });
    let pool = TcpBridgePool::new(Duration::from_secs(2), Duration::from_secs(10)).unwrap();
    let target = TcpTarget { host: "127.0.0.1".to_string(), port };
    let response = pool.request(&target, &query(&[("Action", "100")])).await.unwrap();
    assert_eq!(response.get("BIG").and_then(Value::as_str).map(str::len), Some(1_500_000));
    server.abort();
}

#[tokio::test]
async fn bridge_streams_frames_until_the_consumer_cancels() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let server = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut codec = TztCodec::new().unwrap();
        let frame = read_server_frame(&mut socket).await.unwrap();
        let serial = request_serial(&codec.decode(&frame).unwrap());
        for index in 0..3 {
            let mark = index.to_string();
            let out = codec.encode(&query(&[("Action", "100"), ("GRID0", &mark)]), serial).unwrap();
            if socket.write_all(&out).await.is_err() {
                return;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    });
    let pool = TcpBridgePool::new(Duration::from_secs(2), Duration::from_millis(1500)).unwrap();
    let target = TcpTarget { host: "127.0.0.1".to_string(), port };
    let mut stream = pool.request_stream(&target, &query(&[("Action", "100")])).await.unwrap();
    let first = stream.next().await.unwrap().unwrap();
    assert_eq!(first.get("GRID0").and_then(Value::as_array).and_then(|rows| rows[0].as_str()), Some("0"));
    let second = stream.next().await.unwrap().unwrap();
    assert_eq!(second.get("GRID0").and_then(Value::as_array).and_then(|rows| rows[0].as_str()), Some("1"));
    stream.cancel();
    server.abort();
}

#[tokio::test]
async fn bridge_stream_rejects_after_idle_timeout() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let server = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let _ = read_server_frame(&mut socket).await;
        tokio::time::sleep(Duration::from_secs(2)).await;
    });
    let pool = TcpBridgePool::new(Duration::from_secs(2), Duration::from_millis(300)).unwrap();
    let target = TcpTarget { host: "127.0.0.1".to_string(), port };
    let mut stream = pool.request_stream(&target, &query(&[("Action", "100")])).await.unwrap();
    let failure = stream.next().await.unwrap().unwrap_err();
    assert!(failure.0.contains("idle timeout"), "unexpected error: {}", failure.0);
    assert!(stream.next().await.is_none());
    server.abort();
}

#[tokio::test]
async fn bridge_close_rejects_pending_requests() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let server = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let _ = read_server_frame(&mut socket).await;
        tokio::time::sleep(Duration::from_secs(2)).await;
    });
    let pool = Arc::new(TcpBridgePool::new(Duration::from_secs(2), Duration::from_secs(5)).unwrap());
    let target = TcpTarget { host: "127.0.0.1".to_string(), port };
    let pending = tokio::spawn({
        let pool = pool.clone();
        let target = target.clone();
        async move { pool.request(&target, &query(&[("Action", "100")])).await }
    });
    tokio::time::sleep(Duration::from_millis(200)).await;
    pool.close().await;
    let failure = pending.await.unwrap().unwrap_err();
    assert!(failure.0.contains("closed"), "unexpected error: {}", failure.0);
    server.abort();
}
