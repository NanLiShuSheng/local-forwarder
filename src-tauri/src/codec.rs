use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::Serialize;
use serde_json::{Map, Value};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};

pub type TztQuery = Map<String, Value>;
pub type TztResponse = Map<String, Value>;

const MAGIC: u16 = 0x07b7;
const HEADER_SIZE: usize = 6;
const MAX_FRAME_SIZE: usize = 64 * 1024 * 1024;
// 新版 bytecode 的 zzkeyByte 元数据会把大字段的响应 JSON 放大约 14 倍（1.5MB 字段
// 实测 21MB），上限按帧上限对齐，而不是沿用 execFileSync 时代的 10MB。
const MAX_HELPER_RESPONSE_SIZE: usize = 64 * 1024 * 1024;

const FIXED_FRAME_HEX: &str = "b7072500000064000300000200000031320006416374696f6e0300000031303003666f6f03000000626172";
const FIXED_FILE_RC4_HEX: &str = "7ad9f940a0c3d07a8f";
const FIXED_X_RC4_HEX: &str = "32da9e2ceaea1a6e75";

#[derive(Debug)]
pub struct CodecError(pub String);

impl std::fmt::Display for CodecError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl std::error::Error for CodecError {}

pub type Result<T> = std::result::Result<T, CodecError>;

fn err<T>(message: impl Into<String>) -> Result<T> {
    Err(CodecError(message.into()))
}

fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[derive(Serialize)]
pub(crate) struct LegacyRequest<'a> {
    method: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    key: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    query: Option<&'a TztQuery>,
    #[serde(rename = "handleSerialNo", skip_serializing_if = "Option::is_none")]
    handle_serial_no: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    host: Option<&'a str>,
}

struct HelperProcess {
    child: Child,
    stdin: ChildStdin,
    stdout: ChildStdout,
}

impl Drop for HelperProcess {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

pub(crate) struct LegacyRuntime {
    helper: PathBuf,
    node: PathBuf,
    current: Option<HelperProcess>,
}

impl LegacyRuntime {
    fn new() -> Result<Self> {
        let dir = protocol_directory()?;
        Ok(Self {
            helper: dir.join("tzt-node16-helper.js"),
            node: node16_binary(&dir)?,
            current: None,
        })
    }

    fn spawn_helper(&self) -> Result<HelperProcess> {
        let mut child = Command::new(&self.node)
            .arg(&self.helper)
            .arg("--serve")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| CodecError(format!("TZT codec runtime incompatible: legacy protocol helper failed to start: {e}")))?;
        let stdin = child.stdin.take().expect("stdio piped");
        let stdout = child.stdout.take().expect("stdio piped");
        Ok(HelperProcess { child, stdin, stdout })
    }

    fn invoke(&mut self, request: &LegacyRequest) -> Result<Value> {
        let alive = self
            .current
            .as_mut()
            .is_some_and(|proc| matches!(proc.child.try_wait(), Ok(None)));
        if !alive {
            self.current = Some(self.spawn_helper()?);
        }
        let proc = self.current.as_mut().expect("helper just spawned");
        match exchange(proc, request) {
            // 单请求错误（helper 返回 error 帧）不影响进程存活；只有 I/O 失败才重生
            Ok(value) => Ok(value),
            Err(error) => {
                self.current = None;
                Err(error)
            }
        }
    }
}

fn exchange(proc: &mut HelperProcess, request: &LegacyRequest) -> Result<Value> {
    let payload = serde_json::to_vec(request).map_err(|e| CodecError(format!("failed to serialize codec request: {e}")))?;
    let write = (|| {
        proc.stdin.write_all(&(payload.len() as u32).to_le_bytes())?;
        proc.stdin.write_all(&payload)?;
        proc.stdin.flush()
    })();
    write.map_err(|e| CodecError(format!("TZT codec runtime incompatible: legacy protocol helper write failed: {e}")))?;
    let mut header = [0u8; 4];
    proc.stdout
        .read_exact(&mut header)
        .map_err(|e| CodecError(format!("TZT codec runtime incompatible: legacy protocol helper read failed: {e}")))?;
    let length = u32::from_le_bytes(header) as usize;
    if length > MAX_HELPER_RESPONSE_SIZE {
        return err(format!("legacy protocol helper response is too large: {length} bytes"));
    }
    let mut body = vec![0u8; length];
    proc.stdout
        .read_exact(&mut body)
        .map_err(|e| CodecError(format!("TZT codec runtime incompatible: legacy protocol helper read failed: {e}")))?;
    serde_json::from_slice(&body).map_err(|e| CodecError(format!("TZT codec runtime incompatible: legacy protocol helper returned invalid JSON: {e}")))
}

fn expect_data(value: &Value) -> Result<&Value> {
    if let Some(message) = value.get("error").and_then(Value::as_str) {
        return err(format!("TZT codec runtime incompatible: legacy protocol helper reported an error: {message}"));
    }
    value
        .get("data")
        .ok_or_else(|| CodecError("TZT codec runtime incompatible: helper response is missing data".into()))
}

pub struct TztCodec {
    runtime: LegacyRuntime,
}

impl TztCodec {
    pub fn new() -> Result<Self> {
        let mut runtime = LegacyRuntime::new()?;
        assert_runtime_compatibility(&mut runtime)?;
        Ok(Self { runtime })
    }

    pub fn rc4(&mut self, data: &[u8], key: &str) -> Result<Vec<u8>> {
        let response = self.runtime.invoke(&LegacyRequest {
            method: "rc4",
            data: Some(BASE64.encode(data)),
            key: Some(key),
            query: None,
            handle_serial_no: None,
            host: None,
        })?;
        decode_base64_data(&response)
    }

    pub fn encode(&mut self, query: &TztQuery, serial: u32) -> Result<Vec<u8>> {
        let response = self.runtime.invoke(&LegacyRequest {
            method: "jsonltzt",
            data: None,
            key: None,
            query: Some(query),
            handle_serial_no: Some(serial),
            host: None,
        })?;
        decode_base64_data(&response)
    }

    pub fn decode(&mut self, frame: &[u8]) -> Result<TztResponse> {
        let bytes = assert_frame_shape(frame)?;
        let response = self.runtime.invoke(&LegacyRequest {
            method: "tztljson",
            data: Some(BASE64.encode(bytes)),
            key: None,
            query: None,
            handle_serial_no: None,
            host: Some("local-forwarder"),
        })?;
        let array = expect_data(&response)?
            .as_array()
            .ok_or_else(|| CodecError("Invalid TZT frame: legacy decoder returned no single response".into()))?;
        if array.len() != 1 {
            return err("Invalid TZT frame: legacy decoder returned no single response");
        }
        let object = array[0]
            .as_object()
            .ok_or_else(|| CodecError("Invalid TZT response: expected an object".into()))?;
        match object.get("HandleSerialNo") {
            Some(Value::String(_)) | Some(Value::Number(_)) => Ok(object.clone()),
            Some(_) => err("Invalid TZT response: invalid serial number"),
            None => err("Invalid TZT response: missing serial number"),
        }
    }
}

fn decode_base64_data(response: &Value) -> Result<Vec<u8>> {
    let data = expect_data(response)?
        .as_str()
        .ok_or_else(|| CodecError("TZT codec runtime incompatible: expected a base64 response".into()))?;
    BASE64
        .decode(data)
        .map_err(|e| CodecError(format!("TZT codec runtime incompatible: invalid base64 response: {e}")))
}

fn assert_frame_shape(frame: &[u8]) -> Result<&[u8]> {
    if frame.len() < HEADER_SIZE {
        return err("Invalid TZT frame: truncated header");
    }
    if u16::from_le_bytes([frame[0], frame[1]]) != MAGIC {
        return err("Invalid TZT frame: bad magic");
    }
    let payload_length = u32::from_le_bytes([frame[2], frame[3], frame[4], frame[5]]) as usize;
    if !(11..=MAX_FRAME_SIZE).contains(&payload_length) {
        return err(format!("Invalid TZT frame length: {}", payload_length + HEADER_SIZE));
    }
    if frame.len() != payload_length + HEADER_SIZE {
        return err("Invalid TZT frame: truncated or extra bytes");
    }
    Ok(frame)
}

fn assert_runtime_compatibility(runtime: &mut LegacyRuntime) -> Result<()> {
    let file = fixed_rc4(runtime, "file")?;
    let x = fixed_rc4(runtime, "x")?;
    let frame = fixed_frame(runtime)?;
    if hex_encode(&file) != FIXED_FILE_RC4_HEX || hex_encode(&x) != FIXED_X_RC4_HEX || hex_encode(&frame) != FIXED_FRAME_HEX {
        return err("TZT codec runtime incompatible: bundled legacy protocol failed its fixed regression vectors");
    }
    Ok(())
}

fn fixed_rc4(runtime: &mut LegacyRuntime, key: &str) -> Result<Vec<u8>> {
    let response = runtime.invoke(&LegacyRequest {
        method: "rc4",
        data: Some(BASE64.encode(b"Plaintext")),
        key: Some(key),
        query: None,
        handle_serial_no: None,
        host: None,
    })?;
    decode_base64_data(&response)
}

fn fixed_frame(runtime: &mut LegacyRuntime) -> Result<Vec<u8>> {
    let mut query: TztQuery = Map::new();
    query.insert("Action".to_string(), Value::String("100".to_string()));
    query.insert("foo".to_string(), Value::String("bar".to_string()));
    let response = runtime.invoke(&LegacyRequest {
        method: "jsonltzt",
        data: None,
        key: None,
        query: Some(&query),
        handle_serial_no: Some(12),
        host: None,
    })?;
    decode_base64_data(&response)
}

pub(crate) fn protocol_directory() -> Result<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(dir) = std::env::var("TZT_PROTOCOL_DIR") {
        if !dir.is_empty() {
            candidates.push(dir.into());
        }
    }
    // 打包后：Contents/MacOS/<exe> → Contents/Resources/protocol
    if let Ok(exe) = std::env::current_exe() {
        if let Some(resources) = exe.parent().and_then(|macos| macos.parent()).map(|contents| contents.join("Resources").join("protocol")) {
            candidates.push(resources);
        }
    }
    candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("resources").join("protocol"));
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("resources").join("protocol"));
    }
    for candidate in &candidates {
        if candidate.join("tzt-node16-helper.js").is_file() && candidate.join("tzt.bytecode-16.13.0").is_file() {
            return Ok(candidate.clone());
        }
    }
    err("TZT codec runtime incompatible: bundled resources/protocol assets are missing")
}

fn node16_binary(protocol_dir: &Path) -> Result<PathBuf> {
    let platform = match std::env::consts::OS {
        "macos" => "darwin",
        "windows" => "win",
        other => other,
    };
    let arch = match std::env::consts::ARCH {
        "aarch64" => "arm64",
        "x86_64" => "x64",
        other => other,
    };
    let exe = if cfg!(windows) { "node.exe" } else { "node" };
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(bin) = std::env::var("TZT_NODE16_BIN") {
        if !bin.is_empty() {
            candidates.push(bin.into());
        }
    }
    candidates.push(protocol_dir.join("node").join(format!("{platform}-{arch}")).join(exe));
    if let Some(home) = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")) {
        candidates.push(PathBuf::from(home).join(".nvm/versions/node/v16.13.0/bin/node"));
    }
    if let Ok(nvm_bin) = std::env::var("NVM_BIN") {
        if !nvm_bin.is_empty() {
            candidates.push(PathBuf::from(nvm_bin).join(exe));
        }
    }
    for candidate in &candidates {
        if executable(candidate) {
            return Ok(candidate.clone());
        }
    }
    err(format!(
        "TZT codec runtime incompatible: Node.js 16.13.0 is required to load the bundled legacy protocol bytecode; set TZT_NODE16_BIN. Checked: {}",
        candidates.iter().map(|c| c.display().to_string()).collect::<Vec<_>>().join(", ")
    ))
}

#[cfg(unix)]
fn executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    path.metadata().map(|meta| meta.is_file() && meta.permissions().mode() & 0o111 != 0).unwrap_or(false)
}

/// 供 legacy 配置求值等模块复用 bundled node16
pub(crate) fn node16_binary_path() -> Result<PathBuf> {
    let dir = protocol_directory()?;
    node16_binary(&dir)
}

#[cfg(not(unix))]
fn executable(path: &Path) -> bool {
    path.is_file()
}
