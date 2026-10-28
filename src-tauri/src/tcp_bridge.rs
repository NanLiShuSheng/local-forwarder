use crate::codec::{TztCodec, TztQuery, TztResponse};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::tcp::{OwnedReadHalf, OwnedWriteHalf};
use tokio::net::TcpStream;
use tokio::sync::{mpsc, oneshot};

const MAGIC: u16 = 0x07b7;
const MAX_FRAME_SIZE: usize = 64 * 1024 * 1024;

#[derive(Debug, Clone)]
pub struct TcpTarget {
    pub host: String,
    pub port: u16,
}

#[derive(Debug)]
pub struct BridgeError(pub String);

impl std::fmt::Display for BridgeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl std::error::Error for BridgeError {}

type Result<T> = std::result::Result<T, BridgeError>;

fn err<T>(message: impl Into<String>) -> Result<T> {
    Err(BridgeError(message.into()))
}

enum Pending {
    Single(oneshot::Sender<Result<TztResponse>>),
    Stream(mpsc::UnboundedSender<Result<TztResponse>>),
}

pub struct Connection {
    key: String,
    writer: tokio::sync::Mutex<OwnedWriteHalf>,
    pending: Mutex<HashMap<u32, Pending>>,
    alive: AtomicBool,
    reader: Mutex<Option<tokio::task::JoinHandle<()>>>,
}

type SharedConnection = Arc<Connection>;

struct ConnectionSlot {
    gate: tokio::sync::Mutex<Option<SharedConnection>>,
}

pub struct TcpBridgePool {
    codec: Arc<tokio::sync::Mutex<TztCodec>>,
    connect_timeout: Duration,
    request_timeout: Duration,
    connections: Mutex<HashMap<String, Arc<ConnectionSlot>>>,
    serial: AtomicU32,
    closed: AtomicBool,
}

impl TcpBridgePool {
    pub fn new(connect_timeout: Duration, request_timeout: Duration) -> crate::codec::Result<Self> {
        Ok(Self::with_codec(TztCodec::new()?, connect_timeout, request_timeout))
    }

    pub fn with_codec(codec: TztCodec, connect_timeout: Duration, request_timeout: Duration) -> Self {
        Self {
            codec: Arc::new(tokio::sync::Mutex::new(codec)),
            connect_timeout,
            request_timeout,
            connections: Mutex::new(HashMap::new()),
            serial: AtomicU32::new(0),
            closed: AtomicBool::new(false),
        }
    }

    pub async fn request(&self, target: &TcpTarget, query: &TztQuery) -> Result<TztResponse> {
        if self.closed.load(Ordering::Acquire) {
            return err("TCP bridge is closed");
        }
        if target.port == 0 {
            return err("Invalid TCP target port");
        }
        let serial = self.next_serial();
        let key = format!("{}:{}", target.host, target.port);
        let frame = self.codec.lock().await.encode(query, serial).map_err(|e| BridgeError(e.0))?;
        let connection = self.connection(target, &key).await?;
        let (tx, rx) = oneshot::channel();
        connection.pending.lock().expect("pending poisoned").insert(serial, Pending::Single(tx));
        if let Err(error) = connection.writer.lock().await.write_all(&frame).await {
            connection.pending.lock().expect("pending poisoned").remove(&serial);
            fail(&connection, BridgeError(format!("TCP write failed for {key}: {error}")));
            return err(format!("TCP write failed for {key}: {error}"));
        }
        match tokio::time::timeout(self.request_timeout, rx).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => err(format!("TCP connection closed for {key}")),
            Err(_) => {
                connection.pending.lock().expect("pending poisoned").remove(&serial);
                err(format!("TCP request timeout for {key}"))
            }
        }
    }

    pub async fn request_stream(&self, target: &TcpTarget, query: &TztQuery) -> Result<TztStream> {
        if self.closed.load(Ordering::Acquire) {
            return err("TCP bridge is closed");
        }
        if target.port == 0 {
            return err("Invalid TCP target port");
        }
        let serial = self.next_serial();
        let key = format!("{}:{}", target.host, target.port);
        let frame = self.codec.lock().await.encode(query, serial).map_err(|e| BridgeError(e.0))?;
        let connection = self.connection(target, &key).await?;
        let (tx, rx) = mpsc::unbounded_channel();
        connection.pending.lock().expect("pending poisoned").insert(serial, Pending::Stream(tx));
        if let Err(error) = connection.writer.lock().await.write_all(&frame).await {
            connection.pending.lock().expect("pending poisoned").remove(&serial);
            fail(&connection, BridgeError(format!("TCP write failed for {key}: {error}")));
            return err(format!("TCP write failed for {key}: {error}"));
        }
        Ok(TztStream {
            connection,
            serial,
            rx,
            idle_timeout: self.request_timeout,
        })
    }

    pub async fn close(&self) {
        if self.closed.swap(true, Ordering::AcqRel) {
            return;
        }
        let slots = std::mem::take(&mut *self.connections.lock().expect("connections poisoned"));
        for (_, slot) in slots {
            let guard = slot.gate.lock().await;
            if let Some(connection) = guard.as_ref() {
                fail(connection, BridgeError("TCP bridge closed".to_string()));
            }
        }
    }

    pub fn connection_count(&self) -> usize {
        self.connections.lock().expect("connections poisoned").len()
    }

    fn next_serial(&self) -> u32 {
        let previous = self
            .serial
            .try_update(Ordering::Relaxed, Ordering::Relaxed, |s| Some(if s == u32::MAX { 1 } else { s + 1 }))
            .expect("closure always returns Some");
        if previous == u32::MAX { 1 } else { previous + 1 }
    }

    async fn connection(&self, target: &TcpTarget, key: &str) -> Result<SharedConnection> {
        let slot = self
            .connections
            .lock()
            .expect("connections poisoned")
            .entry(key.to_string())
            .or_insert_with(|| Arc::new(ConnectionSlot { gate: tokio::sync::Mutex::new(None) }))
            .clone();
        let mut guard = slot.gate.lock().await;
        if let Some(connection) = guard.as_ref() {
            if connection.alive.load(Ordering::Acquire) {
                return Ok(connection.clone());
            }
        }
        let stream = match tokio::time::timeout(self.connect_timeout, TcpStream::connect((target.host.as_str(), target.port))).await {
            Ok(Ok(stream)) => stream,
            Ok(Err(error)) => return err(format!("TCP connection failed for {key}: {error}")),
            Err(_) => return err(format!("TCP connection timeout for {key}")),
        };
        let (reader, writer) = stream.into_split();
        let connection = Arc::new(Connection {
            key: key.to_string(),
            writer: tokio::sync::Mutex::new(writer),
            pending: Mutex::new(HashMap::new()),
            alive: AtomicBool::new(true),
            reader: Mutex::new(None),
        });
        let handle = tokio::spawn(read_loop(connection.clone(), reader, self.codec.clone()));
        *connection.reader.lock().expect("reader poisoned") = Some(handle);
        *guard = Some(connection.clone());
        Ok(connection)
    }
}

pub struct TztStream {
    connection: SharedConnection,
    serial: u32,
    rx: mpsc::UnboundedReceiver<Result<TztResponse>>,
    idle_timeout: Duration,
}

impl TztStream {
    pub async fn next(&mut self) -> Option<Result<TztResponse>> {
        match tokio::time::timeout(self.idle_timeout, self.rx.recv()).await {
            Ok(item) => item,
            Err(_) => {
                self.connection.pending.lock().expect("pending poisoned").remove(&self.serial);
                Some(err(format!("TCP stream idle timeout for {}", self.connection.key)))
            }
        }
    }

    pub fn cancel(self) {
        // Drop 负责注销，这里消费 self 即可
    }
}

impl Drop for TztStream {
    fn drop(&mut self) {
        self.connection.pending.lock().expect("pending poisoned").remove(&self.serial);
    }
}

fn fail(connection: &SharedConnection, reason: BridgeError) {
    if !connection.alive.swap(false, Ordering::AcqRel) {
        return;
    }
    if let Some(handle) = connection.reader.lock().expect("reader poisoned").take() {
        handle.abort();
    }
    let pending = std::mem::take(&mut *connection.pending.lock().expect("pending poisoned"));
    for (_, entry) in pending {
        match entry {
            Pending::Single(tx) => {
                let _ = tx.send(Err(BridgeError(reason.0.clone())));
            }
            Pending::Stream(tx) => {
                let _ = tx.send(Err(BridgeError(reason.0.clone())));
            }
        }
    }
}

async fn read_frame(reader: &mut OwnedReadHalf) -> Result<Vec<u8>> {
    let mut header = [0u8; 6];
    reader
        .read_exact(&mut header)
        .await
        .map_err(|e| BridgeError(format!("TCP connection closed: {e}")))?;
    if u16::from_le_bytes([header[0], header[1]]) != MAGIC {
        return err("Invalid TZT frame: bad magic");
    }
    let payload_length = u32::from_le_bytes([header[2], header[3], header[4], header[5]]) as usize;
    if payload_length == 0 || payload_length + 6 > MAX_FRAME_SIZE {
        return err(format!("Invalid TZT frame length: {}", payload_length + 6));
    }
    let mut frame = Vec::with_capacity(payload_length + 6);
    frame.extend_from_slice(&header);
    frame.resize(payload_length + 6, 0);
    reader
        .read_exact(&mut frame[6..])
        .await
        .map_err(|e| BridgeError(format!("TCP connection closed: {e}")))?;
    Ok(frame)
}

async fn read_loop(connection: SharedConnection, mut reader: OwnedReadHalf, codec: Arc<tokio::sync::Mutex<TztCodec>>) {
    loop {
        let frame = match read_frame(&mut reader).await {
            Ok(frame) => frame,
            Err(error) => {
                fail(&connection, error);
                return;
            }
        };
        let decoded = codec.lock().await.decode(&frame);
        let mut response = match decoded {
            Ok(response) => response,
            Err(error) => {
                fail(&connection, BridgeError(error.0));
                return;
            }
        };
        let serial = match response_serial(&response) {
            Some(serial) => serial,
            None => continue,
        };
        response.shift_remove("HandleSerialNo");
        enum Taken {
            Single(oneshot::Sender<Result<TztResponse>>),
            Stream(mpsc::UnboundedSender<Result<TztResponse>>),
        }
        let taken = {
            let mut pending = connection.pending.lock().expect("pending poisoned");
            match pending.get(&serial) {
                None => None,
                Some(Pending::Single(_)) => match pending.remove(&serial) {
                    Some(Pending::Single(tx)) => Some(Taken::Single(tx)),
                    _ => unreachable!(),
                },
                Some(Pending::Stream(tx)) => Some(Taken::Stream(tx.clone())),
            }
        };
        match taken {
            // 超时请求的在途迟到帧：忽略，避免拖垮同一长连接上的其他请求
            None => continue,
            Some(Taken::Single(tx)) => {
                let _ = tx.send(Ok(response));
            }
            Some(Taken::Stream(tx)) => {
                if tx.send(Ok(response)).is_err() {
                    connection.pending.lock().expect("pending poisoned").remove(&serial);
                }
            }
        }
    }
}

fn response_serial(response: &TztResponse) -> Option<u32> {
    match response.get("HandleSerialNo") {
        Some(Value::String(text)) => text.parse().ok(),
        Some(Value::Number(number)) => number.as_u64().and_then(|value| u32::try_from(value).ok()),
        _ => None,
    }
}
