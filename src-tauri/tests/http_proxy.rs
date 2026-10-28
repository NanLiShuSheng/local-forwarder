use forwarder_core::codec::{TztCodec, TztResponse};
use forwarder_core::config::{CacheConfig, ForwardRule, TcpTargetConfig};
use forwarder_core::file_cache::FileCache;
use forwarder_core::http_proxy::{start_http_proxy, HttpProxyOptions, RunningHttpProxy};
use forwarder_core::tcp_bridge::TcpBridgePool;
use serde_json::Value;
use std::collections::HashMap;
use std::net::TcpListener as StdTcpListener;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;

fn rule(id: &str, match_: &str, target: &str, rewrite: Option<&str>) -> ForwardRule {
    ForwardRule {
        id: id.to_string(),
        name: id.to_string(),
        match_: match_.to_string(),
        target: target.to_string(),
        rewrite: rewrite.map(str::to_string),
        enabled: true,
    }
}

fn tcp_target(id: &str, port: u16, transport: Option<&str>) -> TcpTargetConfig {
    TcpTargetConfig {
        id: id.to_string(),
        name: id.to_string(),
        host: "127.0.0.1".to_string(),
        port,
        protocol: None,
        base_path: None,
        transport: transport.map(str::to_string),
    }
}

async fn read_frame(socket: &mut TcpStream) -> Option<Vec<u8>> {
    let mut header = [0u8; 6];
    socket.read_exact(&mut header).await.ok()?;
    let length = u32::from_le_bytes([header[2], header[3], header[4], header[5]]) as usize;
    let mut frame = header.to_vec();
    frame.resize(6 + length, 0);
    socket.read_exact(&mut frame[6..]).await.ok()?;
    Some(frame)
}

fn serial_of(request: &TztResponse) -> u32 {
    request
        .get("HandleSerialNo")
        .and_then(Value::as_str)
        .and_then(|text| text.parse().ok())
        .expect("request carries a serial")
}

// 回声 TZT 服务器：解出请求帧上报给测试，再回 {Action: "100", ERRORNO: "0"}
async fn start_tzt_echo_server() -> (u16, mpsc::UnboundedReceiver<TztResponse>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let (tx, rx) = mpsc::unbounded_channel();
    tokio::spawn(async move {
        while let Ok((mut socket, _)) = listener.accept().await {
            let tx = tx.clone();
            tokio::spawn(async move {
                let mut codec = TztCodec::new().unwrap();
                while let Some(frame) = read_frame(&mut socket).await {
                    let request = codec.decode(&frame).unwrap();
                    let serial = serial_of(&request);
                    let _ = tx.send(request);
                    let mut response = serde_json::Map::new();
                    response.insert("Action".to_string(), Value::String("100".to_string()));
                    response.insert("ERRORNO".to_string(), Value::String("0".to_string()));
                    let out = codec.encode(&response, serial).unwrap();
                    if socket.write_all(&out).await.is_err() {
                        return;
                    }
                }
            });
        }
    });
    (port, rx)
}

// 极简 HTTP 上游：读掉请求头后回固定响应
fn start_http_upstream(body: &'static str, content_type: &'static str, hits: Arc<AtomicUsize>) -> u16 {
    let listener = StdTcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        let listener = TcpListener::from_std(listener).unwrap();
        loop {
            let Ok((mut socket, _)) = listener.accept().await else { return };
            hits.fetch_add(1, Ordering::Relaxed);
            tokio::spawn(async move {
                let mut buf = Vec::new();
                let mut chunk = [0u8; 4096];
                loop {
                    let read = socket.read(&mut chunk).await.unwrap_or(0);
                    if read == 0 {
                        break;
                    }
                    buf.extend_from_slice(&chunk[..read]);
                    if buf.windows(4).any(|window| window == b"\r\n\r\n") {
                        break;
                    }
                }
                let response = format!("HTTP/1.1 200 OK\r\ncontent-type: {content_type}\r\ncontent-length: {}\r\n\r\n{body}", body.len());
                let _ = socket.write_all(response.as_bytes()).await;
            });
        }
    });
    port
}

struct ProxyFixture {
    proxy: RunningHttpProxy,
    client: reqwest::Client,
}

impl ProxyFixture {
    fn url(&self, path: &str) -> String {
        format!("http://127.0.0.1:{}{}", self.proxy.port, path)
    }
}

async fn start_proxy(tcp_targets: Vec<TcpTargetConfig>, rules: Vec<ForwardRule>, local_values: HashMap<String, String>) -> ProxyFixture {
    let codec = TztCodec::new().unwrap();
    let bridge = Arc::new(TcpBridgePool::with_codec(codec, Duration::from_secs(2), Duration::from_millis(1500)));
    let proxy = start_http_proxy(HttpProxyOptions {
        bind_host: "127.0.0.1".to_string(),
        port: 0,
        timeout: Duration::from_secs(5),
        project_path: None,
        rules,
        accounts: HashMap::new(),
        tcp_targets,
        bridge,
        cache: None,
        cache_config: None,
        cache_codec: None,
        local_values,
        map_values: HashMap::new(),
        file_values: HashMap::new(),
    })
    .await
    .unwrap();
    let client = reqwest::Client::builder().redirect(reqwest::redirect::Policy::none()).build().unwrap();
    ProxyFixture { proxy, client }
}

#[tokio::test]
async fn reqxml_over_tcp_uppercases_response_keys() {
    let (port, _rx) = start_tzt_echo_server().await;
    let fixture = start_proxy(vec![tcp_target("hq", port, None)], vec![], HashMap::new()).await;
    let response = fixture.client.get(fixture.url("/reqxml?Action=100")).send().await.unwrap();
    assert_eq!(response.status(), 200);
    let body: Value = response.json().await.unwrap();
    assert_eq!(body.get("ACTION").and_then(Value::as_str), Some("100"));
    assert_eq!(body.get("ERRORNO").and_then(Value::as_str), Some("0"));
    fixture.proxy.stop();
}

#[tokio::test]
async fn reqxml_selects_target_by_reqlinktype() {
    let (first_port, _first_rx) = start_tzt_echo_server().await;
    let (second_port, mut second_rx) = start_tzt_echo_server().await;
    let fixture = start_proxy(vec![tcp_target("hq", first_port, None), tcp_target("jy", second_port, None)], vec![], HashMap::new()).await;
    let response = fixture.client.get(fixture.url("/reqxml?Action=100&REQLINKTYPE=1")).send().await.unwrap();
    assert_eq!(response.status(), 200);
    let request = tokio::time::timeout(Duration::from_secs(2), second_rx.recv()).await.unwrap().unwrap();
    assert_eq!(request.get("REQLINKTYPE").and_then(Value::as_str), Some("1"));
    fixture.proxy.stop();
}

#[tokio::test]
async fn login_merges_account_fields_and_forces_reqlinktype() {
    let (port, mut rx) = start_tzt_echo_server().await;
    let mut fixture_options_accounts: HashMap<String, HashMap<String, String>> = HashMap::new();
    fixture_options_accounts.insert("ptjy".to_string(), HashMap::from([("WT_ACCOUNT".to_string(), "600554432".to_string())]));
    let codec = TztCodec::new().unwrap();
    let bridge = Arc::new(TcpBridgePool::with_codec(codec, Duration::from_secs(2), Duration::from_millis(1500)));
    let proxy = start_http_proxy(HttpProxyOptions {
        bind_host: "127.0.0.1".to_string(),
        port: 0,
        timeout: Duration::from_secs(5),
        project_path: None,
        rules: vec![],
        accounts: fixture_options_accounts,
        // login 强制 REQLINKTYPE=1，回声服务器必须在索引 1
        tcp_targets: vec![tcp_target("hq", 1, None), tcp_target("jy", port, None)],
        bridge,
        cache: None,
        cache_config: None,
        cache_codec: None,
        local_values: HashMap::new(),
        map_values: HashMap::new(),
        file_values: HashMap::new(),
    })
    .await
    .unwrap();
    let client = reqwest::Client::new();
    let response = client.get(format!("http://127.0.0.1:{}/login?Action=100", proxy.port)).send().await.unwrap();
    assert_eq!(response.status(), 200);
    let request = tokio::time::timeout(Duration::from_secs(2), rx.recv()).await.unwrap().unwrap();
    assert_eq!(request.get("WT_ACCOUNT").and_then(Value::as_str), Some("600554432"));
    assert_eq!(request.get("REQLINKTYPE").and_then(Value::as_str), Some("1"));
    proxy.stop();
}

#[tokio::test]
async fn reqsse_streams_frames_until_terminal_sentinel() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut codec = TztCodec::new().unwrap();
        let frame = read_frame(&mut socket).await.unwrap();
        let serial = serial_of(&codec.decode(&frame).unwrap());
        let mut grid = serde_json::Map::new();
        grid.insert("Action".to_string(), Value::String("100".to_string()));
        grid.insert("GRID0".to_string(), Value::String("row1\nrow2".to_string()));
        socket.write_all(&codec.encode(&grid, serial).unwrap()).await.unwrap();
        let mut sentinel = serde_json::Map::new();
        sentinel.insert("GRID0".to_string(), Value::String("0".to_string()));
        socket.write_all(&codec.encode(&sentinel, serial).unwrap()).await.unwrap();
    });
    let fixture = start_proxy(vec![tcp_target("hq", port, None)], vec![], HashMap::new()).await;
    let response = fixture.client.get(fixture.url("/reqsse?Action=100")).send().await.unwrap();
    assert_eq!(response.status(), 200);
    assert_eq!(response.headers().get("content-type").and_then(|value| value.to_str().ok()), Some("text/event-stream; charset=utf-8"));
    let body = response.text().await.unwrap();
    assert_eq!(body, "row1\nrow2".to_string() + "0");
    fixture.proxy.stop();
}

#[tokio::test]
async fn reqsse_rejects_http_transport_targets() {
    let fixture = start_proxy(vec![tcp_target("hq", 1, Some("http"))], vec![], HashMap::new()).await;
    let response = fixture.client.get(fixture.url("/reqsse?Action=100")).send().await.unwrap();
    assert_eq!(response.status(), 502);
    let body: Value = response.json().await.unwrap();
    assert_eq!(body.get("error").and_then(Value::as_str), Some("SSE streaming requires a TCP target"));
    fixture.proxy.stop();
}

#[tokio::test]
async fn forward_uppercases_json_response_keys() {
    let hits = Arc::new(AtomicUsize::new(0));
    let upstream = start_http_upstream("{\"foo\":\"bar\"}", "application/json", hits);
    let fixture = start_proxy(vec![], vec![rule("r1", "/quotes", &format!("http://127.0.0.1:{upstream}"), None)], HashMap::new()).await;
    let response = fixture.client.get(fixture.url("/quotes/x")).send().await.unwrap();
    assert_eq!(response.status(), 200);
    let body: Value = response.json().await.unwrap();
    assert_eq!(body.get("FOO").and_then(Value::as_str), Some("bar"));
    fixture.proxy.stop();
}

#[tokio::test]
async fn forward_preserves_gbk_charset_responses() {
    let hits = Arc::new(AtomicUsize::new(0));
    let upstream = start_http_upstream("{\"foo\":\"bar\"}", "application/json; charset=GBK", hits);
    let fixture = start_proxy(vec![], vec![rule("r1", "/quotes", &format!("http://127.0.0.1:{upstream}"), None)], HashMap::new()).await;
    let response = fixture.client.get(fixture.url("/quotes/x")).send().await.unwrap();
    assert_eq!(response.status(), 200);
    assert_eq!(response.text().await.unwrap(), "{\"foo\":\"bar\"}");
    fixture.proxy.stop();
}

#[tokio::test]
async fn forward_without_matching_rule_returns_404() {
    let fixture = start_proxy(vec![], vec![], HashMap::new()).await;
    let response = fixture.client.get(fixture.url("/nowhere")).send().await.unwrap();
    assert_eq!(response.status(), 404);
    fixture.proxy.stop();
}

#[tokio::test]
async fn legacy_action_redirects_to_the_cleaned_target() {
    let fixture = start_proxy(vec![], vec![], HashMap::new()).await;
    let response = fixture.client.get(fixture.url("/action:1964/?url=http%3A%2F%2Fexample.com%2Fx")).send().await.unwrap();
    assert_eq!(response.status(), 301);
    assert_eq!(response.headers().get("location").and_then(|value| value.to_str().ok()), Some("http://example.com/x"));
    fixture.proxy.stop();
}

#[tokio::test]
async fn legacy_action_10002_returns_history_html() {
    let fixture = start_proxy(vec![], vec![], HashMap::new()).await;
    let response = fixture.client.get(fixture.url("/action:10002/")).send().await.unwrap();
    assert_eq!(response.status(), 200);
    assert!(response.text().await.unwrap().contains("window.history.go(-2)"));
    fixture.proxy.stop();
}

#[tokio::test]
async fn local_value_stores_roundtrip() {
    let fixture = start_proxy(vec![], vec![], HashMap::from([("TOKEN".to_string(), "abc123".to_string())])).await;
    let response = fixture.client.get(fixture.url("/reqlocal?token")).send().await.unwrap();
    let body: Value = response.json().await.unwrap();
    assert_eq!(body.get("TOKEN").and_then(Value::as_str), Some("abc123"));

    let response = fixture.client.post(fixture.url("/reqsavemap")).body("K1=V1").send().await.unwrap();
    assert_eq!(response.status(), 200);
    let response = fixture.client.get(fixture.url("/reqreadmap?K1")).send().await.unwrap();
    let body: Value = response.json().await.unwrap();
    assert_eq!(body.get("K1").and_then(Value::as_str), Some("V1"));

    let response = fixture.client.post(fixture.url("/reqsavefile?filename=demo.txt")).body("file-content").send().await.unwrap();
    assert_eq!(response.status(), 200);
    let response = fixture.client.get(fixture.url("/reqreadfile?filename=demo.txt")).send().await.unwrap();
    assert_eq!(response.text().await.unwrap(), "file-content");
    fixture.proxy.stop();
}

#[tokio::test]
async fn oversized_body_returns_413() {
    let fixture = start_proxy(vec![], vec![], HashMap::new()).await;
    let big = "x".repeat(17 * 1024 * 1024);
    let response = fixture.client.post(fixture.url("/reqxml?Action=100")).body(big).send().await.unwrap();
    assert_eq!(response.status(), 413);
    fixture.proxy.stop();
}

#[tokio::test]
async fn cache_downloads_once_and_then_serves_from_cache() {
    let hits = Arc::new(AtomicUsize::new(0));
    let upstream = start_http_upstream("console.log(1)", "application/javascript", hits.clone());
    let cache_dir = std::env::temp_dir().join(format!("forwarder-cache-test-{}", std::process::id()));
    let codec = TztCodec::new().unwrap();
    let bridge = Arc::new(TcpBridgePool::with_codec(codec, Duration::from_secs(2), Duration::from_millis(1500)));
    let proxy = start_http_proxy(HttpProxyOptions {
        bind_host: "127.0.0.1".to_string(),
        port: 0,
        timeout: Duration::from_secs(5),
        project_path: None,
        rules: vec![rule("r1", "/resource", "http://127.0.0.1:1", Some("/cached/($url).d"))],
        accounts: HashMap::new(),
        tcp_targets: vec![],
        bridge,
        cache: Some(Arc::new(FileCache::new(&cache_dir).unwrap())),
        cache_config: Some(CacheConfig {
            root_dir: cache_dir.to_string_lossy().to_string(),
            download_target: format!("http://127.0.0.1:{upstream}"),
            decrypt_enabled: false,
            auto_download: true,
        }),
        cache_codec: None,
        local_values: HashMap::new(),
        map_values: HashMap::new(),
        file_values: HashMap::new(),
    })
    .await
    .unwrap();
    let client = reqwest::Client::new();
    let url = format!("http://127.0.0.1:{}/resource/main.js", proxy.port);
    let first = client.get(&url).send().await.unwrap();
    let first_status = first.status();
    let first_body = first.text().await.unwrap();
    assert_eq!(first_status, 200, "body: {first_body}");
    assert_eq!(first_body, "console.log(1)");
    let second = client.get(&url).send().await.unwrap();
    let second_status = second.status();
    let second_body = second.text().await.unwrap();
    assert_eq!(second_status, 200, "body: {second_body}");
    assert_eq!(second_body, "console.log(1)");
    assert_eq!(hits.load(Ordering::Relaxed), 1);
    proxy.stop();
    let _ = std::fs::remove_dir_all(&cache_dir);
}
