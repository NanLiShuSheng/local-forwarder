use crate::codec::{TztCodec, TztQuery, TztResponse};
use crate::config::{Accounts, CacheConfig, ForwardRule, LogEntry, TcpTargetConfig, ValuesSnapshot};
use crate::file_cache::{decode_cached_resource, rewrite_legacy_navigation_script, CacheError, FileCache};
use crate::routing::{match_rule, parse_target, substitute_request_url, substitute_variables, ParsedTarget};
use crate::tcp_bridge::{TcpBridgePool, TcpTarget};
use axum::body::{Body, Bytes};
use axum::extract::{Request, State};
use axum::http::{HeaderMap, HeaderValue, Method, StatusCode};
use axum::response::Response;
use axum::Router;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use regex::Regex;
use serde_json::{Map, Value};
use std::collections::HashMap;
use std::convert::Infallible;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering as AtomicOrdering};
use std::sync::{Arc, OnceLock, RwLock};
use std::time::Duration;
use tokio::sync::{mpsc, Mutex};
use tokio_stream::wrappers::UnboundedReceiverStream;

const MAX_BODY_SIZE: usize = 16 * 1024 * 1024;
const MAX_LOG_DETAIL_SIZE: usize = 256 * 1024;

#[derive(Debug)]
pub enum ProxyEvent {
    LoginValuesCaptured(HashMap<String, String>),
    LocalValuesChanged(HashMap<String, String>),
    ValuesWritten,
}

#[derive(Default)]
pub struct HttpProxyStats {
    pub request_count: u64,
    pub success_count: u64,
    pub total_duration_ms: u64,
}

pub struct HttpProxyPatch {
    pub tcp_targets: Option<Vec<TcpTargetConfig>>,
    pub project_path: Option<Option<String>>,
    pub map_values: Option<HashMap<String, String>>,
    pub file_values: Option<HashMap<String, String>>,
}

pub struct HttpProxyOptions {
    pub bind_host: String,
    pub port: u16,
    pub timeout: Duration,
    pub project_path: Option<String>,
    pub rules: Vec<ForwardRule>,
    pub accounts: Accounts,
    pub tcp_targets: Vec<TcpTargetConfig>,
    pub bridge: Arc<TcpBridgePool>,
    pub cache: Option<Arc<FileCache>>,
    pub cache_config: Option<CacheConfig>,
    pub cache_codec: Option<Arc<Mutex<TztCodec>>>,
    pub local_values: HashMap<String, String>,
    pub map_values: HashMap<String, String>,
    pub file_values: HashMap<String, String>,
    pub log_tx: Option<mpsc::UnboundedSender<LogEntry>>,
    pub event_tx: Option<mpsc::UnboundedSender<ProxyEvent>>,
}

pub struct HttpProxyState {
    project_path: RwLock<Option<String>>,
    rules: Vec<ForwardRule>,
    accounts: Accounts,
    tcp_targets: RwLock<Vec<TcpTargetConfig>>,
    bridge: Arc<TcpBridgePool>,
    cache: Option<Arc<FileCache>>,
    cache_config: Option<CacheConfig>,
    cache_codec: Option<Arc<Mutex<TztCodec>>>,
    client: reqwest::Client,
    log_tx: Option<mpsc::UnboundedSender<LogEntry>>,
    event_tx: Option<mpsc::UnboundedSender<ProxyEvent>>,
    stats: HttpProxyStatsInner,
    local_values: RwLock<HashMap<String, String>>,
    map_values: RwLock<HashMap<String, String>>,
    file_values: RwLock<HashMap<String, String>>,
}

#[derive(Default)]
struct HttpProxyStatsInner {
    request_count: AtomicU64,
    success_count: AtomicU64,
    total_duration_ms: AtomicU64,
}

impl HttpProxyState {
    pub fn get_values(&self) -> ValuesSnapshot {
        ValuesSnapshot {
            local_values: self.local_values.read().expect("local values poisoned").clone(),
            map_values: self.map_values.read().expect("map values poisoned").clone(),
            file_values: self.file_values.read().expect("file values poisoned").clone(),
        }
    }

    pub fn update_options(&self, patch: HttpProxyPatch) {
        if let Some(targets) = patch.tcp_targets {
            *self.tcp_targets.write().expect("tcp targets poisoned") = targets;
        }
        if let Some(project_path) = patch.project_path {
            *self.project_path.write().expect("project path poisoned") = project_path;
        }
        if let Some(map_values) = patch.map_values {
            *self.map_values.write().expect("map values poisoned") = map_values;
        }
        if let Some(file_values) = patch.file_values {
            *self.file_values.write().expect("file values poisoned") = file_values;
        }
    }

    pub fn stats(&self) -> HttpProxyStats {
        HttpProxyStats {
            request_count: self.stats.request_count.load(AtomicOrdering::Relaxed),
            success_count: self.stats.success_count.load(AtomicOrdering::Relaxed),
            total_duration_ms: self.stats.total_duration_ms.load(AtomicOrdering::Relaxed),
        }
    }

    pub fn set_local_values(&self, values: HashMap<String, String>) {
        *self.local_values.write().expect("local values poisoned") = values;
    }
}

pub struct RunningHttpProxy {
    pub host: String,
    pub port: u16,
    task: tokio::task::JoinHandle<()>,
    state: Arc<HttpProxyState>,
}

impl RunningHttpProxy {
    pub fn stop(self) {
        self.task.abort();
    }

    pub fn state(&self) -> &Arc<HttpProxyState> {
        &self.state
    }

    pub fn tcp_connections(&self) -> usize {
        self.state.bridge.connection_count()
    }
}

#[derive(Debug)]
pub struct ProxyStartError {
    pub addr_in_use: bool,
    pub message: String,
}

impl std::fmt::Display for ProxyStartError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl std::error::Error for ProxyStartError {}

impl ProxyStartError {
    fn other(message: impl Into<String>) -> Self {
        Self { addr_in_use: false, message: message.into() }
    }
}

pub async fn start_http_proxy(options: HttpProxyOptions) -> Result<RunningHttpProxy, ProxyStartError> {
    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .redirect(reqwest::redirect::Policy::none())
        .timeout(options.timeout)
        .build()
        .map_err(|error| ProxyStartError::other(error.to_string()))?;
    let state = Arc::new(HttpProxyState {
        project_path: RwLock::new(options.project_path),
        rules: options.rules,
        accounts: options.accounts,
        tcp_targets: RwLock::new(options.tcp_targets),
        bridge: options.bridge,
        cache: options.cache,
        cache_config: options.cache_config,
        cache_codec: options.cache_codec,
        client,
        log_tx: options.log_tx,
        event_tx: options.event_tx,
        stats: HttpProxyStatsInner::default(),
        local_values: RwLock::new(options.local_values),
        map_values: RwLock::new(options.map_values),
        file_values: RwLock::new(options.file_values),
    });
    let router = Router::new().fallback(handle).with_state(state.clone());
    let listener = tokio::net::TcpListener::bind((options.bind_host.as_str(), options.port)).await.map_err(|error| ProxyStartError {
        addr_in_use: error.kind() == std::io::ErrorKind::AddrInUse,
        message: error.to_string(),
    })?;
    let address = listener.local_addr().map_err(|error| ProxyStartError::other(error.to_string()))?;
    let task = tokio::spawn(async move {
        let _ = axum::serve(listener, router.into_make_service()).await;
    });
    Ok(RunningHttpProxy { host: address.ip().to_string(), port: address.port(), task, state })
}

#[derive(Clone)]
struct RequestLogContext {
    started: std::time::Instant,
    method: String,
    url: String,
    request_type: String,
    request_path: String,
    request_params: String,
}

async fn handle(State(state): State<Arc<HttpProxyState>>, request: Request) -> Response {
    let started = std::time::Instant::now();
    let method = request.method().clone();
    let headers = request.headers().clone();
    let request_type = request_type_for(&headers);
    let request_url = request.uri().path_and_query().map(|pq| pq.as_str().to_string()).unwrap_or_else(|| "/".to_string());
    let host_header = headers.get("host").and_then(|value| value.to_str().ok()).map(str::to_string);
    let body = match axum::body::to_bytes(request.into_body(), MAX_BODY_SIZE).await {
        Ok(body) => body,
        Err(_) => return error_json("request body exceeds 16 MiB", StatusCode::PAYLOAD_TOO_LARGE),
    };
    let log_ctx = request_type.map(|kind| {
        let request_params = if body.is_empty() {
            format!("{method} {request_url}")
        } else {
            let text = format!("{method} {request_url}\n\n{}", String::from_utf8_lossy(&body));
            truncate_log_detail(&text, text.len())
        };
        RequestLogContext { started, method: method.to_string(), url: request_url.clone(), request_type: kind, request_path: local_url(&request_url).path().to_string(), request_params }
    });
    let response = dispatch(&state, &method, &request_url, host_header.as_deref(), &headers, &body, log_ctx.clone()).await;
    let status = response.status();
    state.stats.request_count.fetch_add(1, AtomicOrdering::Relaxed);
    if (200..500).contains(&status.as_u16()) {
        state.stats.success_count.fetch_add(1, AtomicOrdering::Relaxed);
    }
    state.stats.total_duration_ms.fetch_add(started.elapsed().as_millis() as u64, AtomicOrdering::Relaxed);
    if let Some(ctx) = log_ctx {
        let is_sse = response
            .headers()
            .get("content-type")
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| value.to_lowercase().contains("text/event-stream"));
        // SSE 长流的结束日志由驱动任务在流结束时发送（含字节数），此处跳过
        if !is_sse {
            let (parts, response_body) = response.into_parts();
            let data = axum::body::to_bytes(response_body, MAX_BODY_SIZE).await.unwrap_or_default();
            emit_request_log(&state, &ctx, parts.status, response_data_for(&parts.headers, &data));
            return Response::from_parts(parts, Body::from(data));
        }
    }
    response
}

async fn dispatch(state: &Arc<HttpProxyState>, method: &Method, request_url: &str, host_header: Option<&str>, headers: &HeaderMap, body: &Bytes, log_ctx: Option<RequestLogContext>) -> Response {
    let parsed = local_url(request_url);
    let tztforward = headers.get("tztforward").and_then(|value| value.to_str().ok()) == Some("forward");
    if tztforward || parsed.path() == "/reqsse" {
        return handle_sse(state, request_url, body, headers, log_ctx).await;
    }
    if let Some(action) = legacy_action_response(request_url, host_header) {
        return action.into_response();
    }
    match parsed.path() {
        "/reqlocal" => {
            let params = parse_params(request_url, body);
            let values = state.local_values.read().expect("local values poisoned");
            let output: Map<String, Value> = params.keys().map(|key| (key.to_uppercase(), Value::String(lookup_value(&values, key)))).collect();
            return json_response(Value::Object(output), StatusCode::OK);
        }
        "/reqsavemap" | "/reqreadmap" => {
            let params = uppercase_params(&parse_params(request_url, body));
            if parsed.path() == "/reqsavemap" {
                let mut values = state.map_values.write().expect("map values poisoned");
                for (key, value) in &params {
                    if let Some(text) = value.as_str() {
                        values.insert(key.clone(), text.to_string());
                    }
                }
                drop(values);
                if let Some(tx) = state.event_tx.as_ref() {
                    let _ = tx.send(ProxyEvent::ValuesWritten);
                }
                return json_response(json!({ "ERRORNO": "0" }), StatusCode::OK);
            }
            let values = state.map_values.read().expect("map values poisoned");
            let output: Map<String, Value> = params.keys().map(|key| (key.clone(), Value::String(lookup_value(&values, key)))).collect();
            return json_response(Value::Object(output), StatusCode::OK);
        }
        "/reqsavefile" | "/reqreadfile" => {
            let filename = parsed.query_pairs().find(|(key, _)| key == "filename").map(|(_, value)| value.into_owned()).unwrap_or_default();
            if filename.is_empty() || filename.contains('/') || filename.contains('\\') || filename == "." || filename == ".." {
                return error_json("invalid filename", StatusCode::BAD_REQUEST);
            }
            let key = filename.to_uppercase();
            if parsed.path() == "/reqsavefile" {
                state.file_values.write().expect("file values poisoned").insert(key, String::from_utf8_lossy(body).into_owned());
                if let Some(tx) = state.event_tx.as_ref() {
                    let _ = tx.send(ProxyEvent::ValuesWritten);
                }
                return json_response(json!({ "ERRORNO": "0" }), StatusCode::OK);
            }
            let value = state.file_values.read().expect("file values poisoned").get(&key).cloned().unwrap_or_default();
            return bytes_response(StatusCode::OK, value.into_bytes(), Some("application/octet-stream"));
        }
        "/reqxml" | "/login" => return handle_tcp(state, request_url, body, parsed.path() == "/login", method.clone(), headers).await,
        _ => {}
    }
    match serve_project_file(state, parsed.path()).await {
        Ok(Some(response)) => return response,
        Ok(None) => {}
        Err(error) => return error_json(&error, StatusCode::INTERNAL_SERVER_ERROR),
    }
    forward(state, method, request_url, headers, body.clone()).await
}

fn local_url(request_url: &str) -> url::Url {
    url::Url::options()
        .base_url(Some(&url::Url::parse("http://local-forwarder.invalid").expect("base url is valid")))
        .parse(request_url)
        .unwrap_or_else(|_| url::Url::parse("http://local-forwarder.invalid/").expect("fallback url is valid"))
}

fn json_response(value: Value, status: StatusCode) -> Response {
    let body = serde_json::to_vec(&value).unwrap_or_default();
    let mut response = Response::new(Body::from(body));
    *response.status_mut() = status;
    response.headers_mut().insert("content-type", HeaderValue::from_static("application/json; charset=utf-8"));
    response
}

fn error_json(message: &str, status: StatusCode) -> Response {
    json_response(json!({ "error": message }), status)
}

fn bytes_response(status: StatusCode, data: Vec<u8>, content_type: Option<&str>) -> Response {
    let mut response = Response::new(Body::from(data));
    *response.status_mut() = status;
    if let Some(content_type) = content_type {
        if let Ok(value) = HeaderValue::from_str(content_type) {
            response.headers_mut().insert("content-type", value);
        }
    }
    response
}

use serde_json::json;

fn parse_params(request_url: &str, body: &[u8]) -> TztQuery {
    let mut params = TztQuery::new();
    for (key, value) in local_url(request_url).query_pairs() {
        params.insert(key.into_owned(), Value::String(value.into_owned()));
    }
    if !body.is_empty() {
        for (key, value) in url::form_urlencoded::parse(body) {
            params.insert(key.into_owned(), Value::String(value.into_owned()));
        }
    }
    params
}

fn form_serialize(params: &TztQuery) -> String {
    let mut serializer = url::form_urlencoded::Serializer::new(String::new());
    for (key, value) in params {
        serializer.append_pair(key, value.as_str().unwrap_or(""));
    }
    serializer.finish()
}

fn form_parse(input: &str) -> TztQuery {
    let mut params = TztQuery::new();
    for (key, value) in url::form_urlencoded::parse(input.as_bytes()) {
        params.insert(key.into_owned(), Value::String(value.into_owned()));
    }
    params
}

fn substituted_params(state: &HttpProxyState, params: &TztQuery) -> TztQuery {
    let encoded = form_serialize(params);
    let substituted = substitute_variables(&encoded, &state.local_values.read().expect("local values poisoned"));
    form_parse(&substituted)
}

fn uppercase_params(params: &TztQuery) -> TztQuery {
    params.iter().map(|(key, value)| (key.to_uppercase(), value.clone())).collect()
}

fn lookup_value(values: &HashMap<String, String>, key: &str) -> String {
    let wanted = key.to_uppercase();
    values.iter().find(|(candidate, _)| candidate.to_uppercase() == wanted).map(|(_, value)| value.clone()).unwrap_or_default()
}

fn request_type_for(headers: &HeaderMap) -> Option<String> {
    let fetch_dest = headers.get("sec-fetch-dest").and_then(|value| value.to_str().ok()).map(str::to_lowercase).unwrap_or_default();
    let requested_with = headers.get("x-requested-with").and_then(|value| value.to_str().ok()).map(str::to_lowercase).unwrap_or_default();
    if requested_with == "xmlhttprequest" {
        return Some("xhr".to_string());
    }
    if fetch_dest == "empty" {
        return Some("fetch".to_string());
    }
    None
}

fn truncate_log_detail(value: &str, total_bytes: usize) -> String {
    if total_bytes <= MAX_LOG_DETAIL_SIZE {
        return value.to_string();
    }
    format!("{value}\n…（内容过长，已截取前 {MAX_LOG_DETAIL_SIZE} 字节）")
}

fn response_data_for(headers: &HeaderMap, data: &[u8]) -> String {
    if data.is_empty() {
        return String::new();
    }
    let content_type = headers.get("content-type").and_then(|value| value.to_str().ok()).unwrap_or("").to_lowercase();
    if content_type.contains("text/event-stream") {
        return format!("[SSE 流式响应，共 {} 字节]", data.len());
    }
    if !content_type.is_empty() && !(content_type.contains("text") || content_type.contains("json") || content_type.contains("javascript") || content_type.contains("xml") || content_type.contains("x-www-form-urlencoded")) {
        return format!("[二进制响应，共 {} 字节]", data.len());
    }
    truncate_log_detail(&String::from_utf8_lossy(data), data.len())
}

fn emit_request_log(state: &HttpProxyState, ctx: &RequestLogContext, status: StatusCode, response_data: String) {
    let Some(tx) = state.log_tx.as_ref() else { return };
    let mut entry = LogEntry::new(if status.as_u16() >= 500 { "error" } else { "info" }, format!("{} {}", ctx.method, ctx.url));
    entry.direction = Some("inbound".to_string());
    entry.protocol = Some("http".to_string());
    entry.status_code = Some(status.as_u16());
    entry.duration_ms = Some(ctx.started.elapsed().as_millis() as u64);
    entry.request_type = Some(ctx.request_type.clone());
    entry.request_path = Some(ctx.request_path.clone());
    entry.request_params = Some(ctx.request_params.clone());
    entry.response_data = Some(response_data);
    let _ = tx.send(entry);
}

pub(crate) fn js_string(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        Value::Number(number) => {
            if let Some(int) = number.as_i64() {
                int.to_string()
            } else if let Some(uint) = number.as_u64() {
                uint.to_string()
            } else {
                number.as_f64().map(|float| float.to_string()).unwrap_or_default()
            }
        }
        Value::Bool(flag) => flag.to_string(),
        _ => String::new(),
    }
}

fn capture_local_values(state: &HttpProxyState, record: &Map<String, Value>) {
    let normalized: Vec<(String, String)> = record
        .iter()
        .filter(|(_, value)| matches!(value, Value::String(_) | Value::Number(_) | Value::Bool(_)))
        .map(|(key, value)| (key.to_uppercase(), js_string(value)))
        .collect();
    let action = normalized.iter().find(|(key, _)| key == "ACTION").map(|(_, value)| value.clone());
    let mut values = state.local_values.write().expect("local values poisoned");
    let mut captured: HashMap<String, String> = HashMap::new();
    let mut changed = false;
    if action.as_deref() == Some("100") {
        for (key, entry) in normalized {
            if values.get(&key) != Some(&entry) {
                values.insert(key.clone(), entry.clone());
                changed = true;
            }
            captured.insert(key, entry);
        }
    } else if let Some((_, token)) = normalized.iter().find(|(key, _)| key == "TOKEN") {
        if values.get("TOKEN") != Some(token) {
            values.insert("TOKEN".to_string(), token.clone());
            changed = true;
        }
        captured.insert("TOKEN".to_string(), token.clone());
    }
    drop(values);
    if changed {
        if let Some(tx) = state.event_tx.as_ref() {
            let _ = tx.send(ProxyEvent::LoginValuesCaptured(captured));
            let _ = tx.send(ProxyEvent::LocalValuesChanged(state.local_values.read().expect("local values poisoned").clone()));
        }
    }
}

fn capture_local_values_from_bytes(state: &HttpProxyState, data: &[u8]) {
    if let Ok(Value::Object(map)) = serde_json::from_slice::<Value>(data) {
        capture_local_values(state, &map);
    }
}

fn action_token_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| Regex::new(r"(?i)(?:^|/)action:(\d+)(?:[/?#]|$)").expect("action token pattern is valid"))
}

fn action_host_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| Regex::new(r"(?i)^action:(\d+)$").expect("action host pattern is valid"))
}

fn action_invocation_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| Regex::new(r"(?i)^/action:\d+(?:/|$)").expect("action invocation pattern is valid"))
}

fn cjk_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| Regex::new(r"[\x{4e00}-\x{9fa5}]").expect("cjk pattern is valid"))
}

fn action_code_for(request_url: &str, host_header: Option<&str>) -> Option<String> {
    if let Some(captures) = action_token_pattern().captures(request_url) {
        return Some(captures[1].to_string());
    }
    action_host_pattern().captures(host_header.unwrap_or("").trim()).map(|captures| captures[1].to_string())
}

fn is_action_invocation_path(request_url: &str) -> bool {
    let path = local_url(request_url).path().to_string();
    path == "/" || action_invocation_pattern().is_match(&path)
}

fn resolve_action_target(request_url: &str, host_header: Option<&str>) -> Option<String> {
    let mut current_url = request_url.to_string();
    let mut current_host = host_header;
    for _ in 0..8 {
        action_code_for(&current_url, current_host)?;
        let parsed = local_url(&current_url);
        let target = parsed.query_pairs().find(|(key, _)| key == "url").map(|(_, value)| value.into_owned())?;
        let cleaned = cjk_pattern().replace_all(&target, "").into_owned();
        if action_code_for(&cleaned, None).is_none() {
            return Some(cleaned);
        }
        current_url = cleaned;
        current_host = None;
    }
    None
}

enum LegacyAction {
    Redirect { status: StatusCode, location: String },
    Html,
    Empty { status: StatusCode },
}

impl LegacyAction {
    fn into_response(self) -> Response {
        match self {
            LegacyAction::Redirect { status, location } => {
                let mut response = Response::new(Body::empty());
                *response.status_mut() = status;
                if let Ok(value) = HeaderValue::from_str(&location) {
                    response.headers_mut().insert("location", value);
                }
                response
            }
            LegacyAction::Html => bytes_response(
                StatusCode::OK,
                "<html><head><meta http-equiv=Content-Type><script type=text/javascript>window.history.go(-2);</script><body><html>".as_bytes().to_vec(),
                Some("text/html"),
            ),
            LegacyAction::Empty { status } => {
                let mut response = Response::new(Body::empty());
                *response.status_mut() = status;
                response
            }
        }
    }
}

fn legacy_action_response(request_url: &str, host_header: Option<&str>) -> Option<LegacyAction> {
    let action_code = action_code_for(request_url, host_header)?;
    if action_code == "10002" && is_action_invocation_path(request_url) {
        return Some(LegacyAction::Html);
    }
    if let Some(target) = resolve_action_target(request_url, host_header) {
        return Some(LegacyAction::Redirect {
            status: if action_code == "1964" { StatusCode::MOVED_PERMANENTLY } else { StatusCode::TEMPORARY_REDIRECT },
            location: target,
        });
    }
    if is_action_invocation_path(request_url) {
        return Some(LegacyAction::Empty { status: StatusCode::NO_CONTENT });
    }
    None
}

fn target_for(state: &HttpProxyState, params: &TztQuery) -> Option<TcpTargetConfig> {
    let index = uppercase_params(params)
        .get("REQLINKTYPE")
        .and_then(Value::as_str)
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(0);
    let targets = state.tcp_targets.read().expect("tcp targets poisoned");
    targets.get(index).or_else(|| targets.first()).cloned()
}

fn is_timeout(message: &str) -> bool {
    message.to_lowercase().contains("timeout")
}

async fn handle_tcp(state: &Arc<HttpProxyState>, route: &str, body: &[u8], login: bool, method: Method, headers: &HeaderMap) -> Response {
    let mut params = parse_params(route, body);
    if !login {
        params = substituted_params(state, &params);
    }
    if login {
        let account_type = uppercase_params(&params).get("TYPE").and_then(Value::as_str).unwrap_or("ptjy").to_string();
        if let Some(account) = state.accounts.get(&account_type) {
            for (key, value) in account {
                params.insert(key.clone(), Value::String(value.clone()));
            }
        }
        params.insert("REQLINKTYPE".to_string(), Value::String("1".to_string()));
        params = substituted_params(state, &params);
    }
    let Some(target) = target_for(state, &params) else {
        return error_json("TCP target is unavailable", StatusCode::BAD_GATEWAY);
    };
    if target.transport.as_deref() == Some("http") {
        return forward_reqxml_over_http(state, &target, route, &params, &method, headers, login).await;
    }
    match state.bridge.request(&TcpTarget { host: target.host, port: target.port }, &params).await {
        Ok(response) => {
            let normalized = uppercase_params(&response);
            capture_local_values(state, &normalized);
            json_response(Value::Object(normalized), StatusCode::OK)
        }
        Err(error) => error_json(&error.0, if is_timeout(&error.0) { StatusCode::GATEWAY_TIMEOUT } else { StatusCode::BAD_GATEWAY }),
    }
}

async fn handle_sse(state: &Arc<HttpProxyState>, route: &str, body: &[u8], headers: &HeaderMap, log_ctx: Option<RequestLogContext>) -> Response {
    let params = substituted_params(state, &parse_params(route, body));
    let Some(target) = target_for(state, &params) else {
        return error_json("TCP target is unavailable", StatusCode::BAD_GATEWAY);
    };
    if target.transport.as_deref() == Some("http") {
        return error_json("SSE streaming requires a TCP target", StatusCode::BAD_GATEWAY);
    }
    let binary = headers.get("tztcontenttype").and_then(|value| value.to_str().ok()) == Some("application/octet-stream");
    let mut stream = match state.bridge.request_stream(&TcpTarget { host: target.host, port: target.port }, &params).await {
        Ok(stream) => stream,
        Err(error) => return error_json(&error.0, if is_timeout(&error.0) { StatusCode::GATEWAY_TIMEOUT } else { StatusCode::BAD_GATEWAY }),
    };
    // 首帧之前不签发 SSE 响应头：此刻出错仍能回 JSON 错误（对齐 TS ensureHeaders 语义）
    let first = loop {
        match stream.next().await {
            Some(Ok(frame)) => {
                capture_local_values(state, &frame);
                let (payload, terminal) = sse_frame_payload(&frame, binary);
                if payload.is_empty() && !terminal {
                    continue;
                }
                break Some((payload, terminal));
            }
            Some(Err(error)) => return error_json(&error.0, if is_timeout(&error.0) { StatusCode::GATEWAY_TIMEOUT } else { StatusCode::BAD_GATEWAY }),
            None => break None,
        }
    };
    let (tx, rx) = mpsc::unbounded_channel::<std::result::Result<Bytes, Infallible>>();
    let state_for_stream = state.clone();
    tokio::spawn(async move {
        let mut sent_bytes = 0usize;
        'run: {
            let Some((payload, terminal)) = first else { break 'run };
            sent_bytes += payload.len();
            if tx.send(Ok(Bytes::from(payload))).is_err() || terminal {
                break 'run;
            }
            while let Some(item) = stream.next().await {
                match item {
                    Ok(frame) => {
                        capture_local_values(&state_for_stream, &frame);
                        let (payload, terminal) = sse_frame_payload(&frame, binary);
                        if payload.is_empty() && !terminal {
                            continue;
                        }
                        sent_bytes += payload.len();
                        if tx.send(Ok(Bytes::from(payload))).is_err() || terminal {
                            break 'run;
                        }
                    }
                    // 响应头已发出，流中错误只能截断（对齐 TS：headersSent 后 end）
                    Err(_) => break 'run,
                }
            }
        }
        if let Some(ctx) = log_ctx {
            emit_request_log(&state_for_stream, &ctx, StatusCode::OK, format!("[SSE 流式响应，共 {sent_bytes} 字节]"));
        }
    });
    let mut response = Response::new(Body::from_stream(UnboundedReceiverStream::new(rx)));
    let headers = response.headers_mut();
    headers.insert("content-type", HeaderValue::from_static("text/event-stream; charset=utf-8"));
    headers.insert("cache-control", HeaderValue::from_static("no-cache, no-store"));
    headers.insert("connection", HeaderValue::from_static("keep-alive"));
    response
}

fn sse_frame_payload(frame: &TztResponse, binary: bool) -> (String, bool) {
    let grid = frame.get("GRID0").or_else(|| frame.get("Grid0"));
    let terminal = matches!(grid, Some(Value::String(text)) if !text.is_empty() && text.trim().parse::<f64>() == Ok(0.0));
    if binary {
        let bytes = frame.get("zzkeyByte").and_then(|zz| zz.get("Grid0")).and_then(zz_bytes);
        let payload = bytes.map(|bytes| format!("{}\r\n\r\n", BASE64.encode(bytes))).unwrap_or_default();
        return (payload, terminal);
    }
    match grid {
        Some(Value::Array(rows)) => {
            let payload = rows
                .iter()
                .map(|row| match row {
                    Value::Null => "\r\n".to_string(),
                    Value::String(text) if text.is_empty() => "\r\n".to_string(),
                    Value::String(text) => text.clone(),
                    other => js_string(other),
                })
                .collect::<Vec<_>>()
                .join("\r\n");
            (payload, terminal)
        }
        Some(Value::String(text)) if !text.is_empty() => (text.clone(), terminal),
        Some(Value::Number(number)) if number.as_f64() != Some(0.0) => (js_string(&Value::Number(number.clone())), terminal),
        Some(Value::Bool(flag)) => (flag.to_string(), terminal),
        _ => {
            let mut rest = frame.clone();
            rest.shift_remove("zzbytes");
            rest.shift_remove("zzkeyByte");
            (serde_json::to_string(&Value::Object(uppercase_params(&rest))).unwrap_or_default(), terminal)
        }
    }
}

fn zz_bytes(value: &Value) -> Option<Vec<u8>> {
    match value {
        Value::Array(items) => items.iter().map(|item| item.as_u64().map(|byte| byte as u8)).collect(),
        Value::Object(map) => {
            if let Some(data) = map.get("data") {
                return zz_bytes(data);
            }
            // 新 bytecode 以 {"0":..,"1":..} 对象携带字节（TS 版此处会丢成空串，属附带修复）
            let mut entries: Vec<(usize, u8)> = map.iter().filter_map(|(key, value)| Some((key.parse().ok()?, value.as_u64()? as u8))).collect();
            if entries.is_empty() {
                return None;
            }
            entries.sort_by_key(|(index, _)| *index);
            Some(entries.into_iter().map(|(_, byte)| byte).collect())
        }
        _ => None,
    }
}

async fn serve_project_file(state: &Arc<HttpProxyState>, request_path: &str) -> Result<Option<Response>, String> {
    let root = state.project_path.read().expect("project path poisoned").clone();
    let Some(root) = root else {
        return Ok(None);
    };
    let (absolute, relative) = join_project_path(&root, request_path)?;
    let mut actual = absolute;
    if !tokio::fs::metadata(&actual).await.map(|meta| meta.is_file()).unwrap_or(false) {
        let encoded = PathBuf::from(format!("{}.d", actual.display()));
        if !tokio::fs::metadata(&encoded).await.map(|meta| meta.is_file()).unwrap_or(false) {
            return Ok(None);
        }
        actual = encoded;
    }
    let mut data = tokio::fs::read(&actual).await.map_err(|error| error.to_string())?;
    let is_encoded = actual.to_string_lossy().ends_with(".d");
    if is_encoded {
        if let Some(codec) = state.cache_codec.as_ref() {
            data = decode_cached_resource(&relative, &data, &mut *codec.lock().await, true).map_err(|error| error.0)?;
        }
    }
    if !is_encoded || state.cache_codec.is_some() {
        data = rewrite_legacy_navigation_script(&relative, &data);
    }
    Ok(Some(bytes_response(StatusCode::OK, data, Some(content_type_for(&relative)))))
}

fn join_project_path(root_dir: &str, request_path: &str) -> Result<(PathBuf, String), String> {
    let path = local_url(request_path).path().to_string();
    let decoded = percent_encoding::percent_decode_str(&path).decode_utf8().map_err(|error| error.to_string())?;
    let relative = if decoded == "/" { "index.html".to_string() } else { decoded.trim_start_matches('/').to_string() };
    let root = crate::normalize_lexical(&std::path::absolute(root_dir).map_err(|error| error.to_string())?);
    let absolute = crate::normalize_lexical(&root.join(&relative));
    if absolute != root && !absolute.starts_with(&root) {
        return Err("project path escapes configured directory".to_string());
    }
    Ok((absolute, relative))
}

fn content_type_for(relative_path: &str) -> &'static str {
    let lower = relative_path.to_lowercase();
    let without_suffix = lower.strip_suffix(".d").unwrap_or(&lower);
    match without_suffix.rfind('.').map(|index| &without_suffix[index..]) {
        Some(".js") => "application/javascript",
        Some(".html") | Some(".htm") => "text/html; charset=utf-8",
        Some(".css") => "text/css; charset=utf-8",
        Some(".json") => "application/json",
        Some(".png") => "image/png",
        Some(".jpg") | Some(".jpeg") => "image/jpeg",
        Some(".svg") => "image/svg+xml",
        _ => "application/octet-stream",
    }
}

fn binary_content_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| Regex::new(r"(?i)application/binary").expect("binary pattern is valid"))
}

fn gbk_content_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| Regex::new(r"(?i)charset\s*=\s*gbk").expect("gbk pattern is valid"))
}

fn uppercase_json_keys(data: &[u8], content_type: Option<&str>) -> Vec<u8> {
    let header = content_type.unwrap_or("");
    if binary_content_pattern().is_match(header) || gbk_content_pattern().is_match(header) {
        return data.to_vec();
    }
    let Ok(Value::Object(map)) = serde_json::from_slice::<Value>(data) else {
        return data.to_vec();
    };
    serde_json::to_vec(&Value::Object(uppercase_params(&map))).unwrap_or_else(|_| data.to_vec())
}

fn clean_response_headers(headers: &HeaderMap) -> HeaderMap {
    let mut output = HeaderMap::new();
    for (key, value) in headers {
        if ["content-encoding", "content-length", "transfer-encoding", "connection"].contains(&key.as_str()) {
            continue;
        }
        output.append(key, value.clone());
    }
    output
}

async fn upstream_response(state: &HttpProxyState, upstream: reqwest::Response) -> Response {
    let status = StatusCode::from_u16(upstream.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let content_type = upstream.headers().get("content-type").and_then(|value| value.to_str().ok()).map(str::to_string);
    let headers = clean_response_headers(upstream.headers());
    let data = match upstream.bytes().await {
        Ok(data) => data,
        Err(_) => return error_json("upstream response decompression failed", StatusCode::BAD_GATEWAY),
    };
    let data = uppercase_json_keys(&data, content_type.as_deref());
    capture_local_values_from_bytes(state, &data);
    let mut response = Response::new(Body::from(data));
    *response.status_mut() = status;
    *response.headers_mut() = headers;
    response
}

async fn forward(state: &Arc<HttpProxyState>, method: &Method, request_url: &str, headers: &HeaderMap, body: Bytes) -> Response {
    let values = state.local_values.read().expect("local values poisoned").clone();
    let substituted_url = substitute_variables(request_url, &values);
    let Some(rule) = match_rule(&substituted_url, &state.rules) else {
        return error_json("No forwarding rule matched", StatusCode::NOT_FOUND);
    };
    let target = match parse_target(&substitute_variables(&rule.target, &values)) {
        Ok(target) => target,
        Err(error) => return error_json(&error, StatusCode::BAD_GATEWAY),
    };
    if target.protocol == "tcp" {
        return error_json("TCP target requires /reqxml", StatusCode::BAD_GATEWAY);
    }
    if let (Some(cache), Some(cache_config)) = (state.cache.as_ref(), state.cache_config.as_ref()) {
        if cache_config.auto_download && method == Method::GET && rule.rewrite.as_deref().is_some_and(|rewrite| rewrite.to_lowercase().contains(".d")) {
            return match serve_cached_resource(state, cache, cache_config, method, &substituted_url).await {
                Ok(response) => response,
                Err(error) => error_json(&error, StatusCode::INTERNAL_SERVER_ERROR),
            };
        }
    }
    let outgoing_body: Vec<u8> = if body.is_empty() {
        body.to_vec()
    } else {
        substitute_variables(&String::from_utf8_lossy(&body), &values).into_bytes()
    };
    let outgoing_path = match rule.rewrite.as_deref() {
        Some(rewrite) => substitute_request_url(&substitute_variables(rewrite, &values), &substituted_url),
        None => substituted_url.clone(),
    };
    let target_path = if target.pathname == "/" {
        outgoing_path
    } else {
        format!("{}{}", target.pathname.strip_suffix('/').unwrap_or(&target.pathname), ensure_slash(&outgoing_path))
    };
    let url = format!("{}://{}:{}{}{}", target.protocol, target.hostname, target.port, target_path, target.search);
    let mut outbound_headers = headers.clone();
    outbound_headers.remove("connection");
    outbound_headers.remove("content-length");
    let mut outbound = state.client.request(method.clone(), &url).headers(outbound_headers);
    if !outgoing_body.is_empty() {
        outbound = outbound.body(outgoing_body);
    }
    match outbound.send().await {
        Ok(upstream) => upstream_response(state, upstream).await,
        Err(error) if error.is_timeout() => error_json("upstream request timeout", StatusCode::GATEWAY_TIMEOUT),
        Err(_) => error_json("upstream request failed", StatusCode::BAD_GATEWAY),
    }
}

fn ensure_slash(path: &str) -> String {
    if path.starts_with('/') {
        path.to_string()
    } else {
        format!("/{path}")
    }
}

async fn forward_reqxml_over_http(
    state: &Arc<HttpProxyState>,
    target: &TcpTargetConfig,
    route: &str,
    params: &TztQuery,
    method: &Method,
    headers: &HeaderMap,
    login: bool,
) -> Response {
    let request_path = if login { "/reqxml".to_string() } else { local_url(route).path().to_string() };
    let base_path = target.base_path.as_deref().unwrap_or("");
    let target_path = format!("{base_path}{}", ensure_slash(&request_path));
    let query = form_serialize(params);
    let path = if *method == Method::GET && !query.is_empty() { format!("{target_path}?{query}") } else { target_path };
    let protocol = target.protocol.as_deref().unwrap_or("http");
    let url = format!("{protocol}://{}:{}{}", target.host, target.port, path);
    let mut outgoing_headers = headers.clone();
    if let Ok(host) = HeaderValue::from_str(&target.host) {
        outgoing_headers.insert("host", host);
    }
    outgoing_headers.remove("connection");
    outgoing_headers.remove("content-length");
    if *method != Method::GET && !outgoing_headers.contains_key("content-type") {
        outgoing_headers.insert("content-type", HeaderValue::from_static("application/x-www-form-urlencoded"));
    }
    let mut outbound = state.client.request(method.clone(), &url).headers(outgoing_headers);
    if *method != Method::GET {
        outbound = outbound.body(query);
    }
    match outbound.send().await {
        Ok(upstream) => upstream_response(state, upstream).await,
        Err(error) if error.is_timeout() => error_json("upstream request timeout", StatusCode::GATEWAY_TIMEOUT),
        Err(_) => error_json("upstream request failed", StatusCode::BAD_GATEWAY),
    }
}

fn cache_key_for(request_url: &str) -> Result<String, String> {
    let parsed = local_url(request_url);
    let requested_path = parsed.query_pairs().find(|(key, _)| key == "url").map(|(_, value)| value.into_owned()).unwrap_or_else(|| parsed.path().to_string());
    if requested_path.split(['/', '\\']).any(|segment| segment == "..") {
        return Err("invalid cached resource path".to_string());
    }
    let normalized = local_url(&requested_path).path().trim_start_matches('/').to_string();
    if normalized.is_empty() || normalized == "." || normalized.contains('\\') {
        return Err("invalid cached resource path".to_string());
    }
    Ok(if normalized.to_lowercase().ends_with(".d") { normalized } else { format!("{normalized}.d") })
}

async fn serve_cached_resource(state: &Arc<HttpProxyState>, cache: &Arc<FileCache>, config: &CacheConfig, method: &Method, request_url: &str) -> Result<Response, String> {
    if config.download_target.is_empty() {
        return Err("resource cache download target is not configured".to_string());
    }
    let cache_key = cache_key_for(request_url)?;
    let target = parse_target(&config.download_target)?;
    if target.protocol == "tcp" {
        return Err("resource cache download target must use HTTP or HTTPS".to_string());
    }
    if target.pathname != "/" && !target.pathname.to_lowercase().starts_with("/download") {
        return Err("resource cache download target must use the /download prefix".to_string());
    }
    let prefix = if target.pathname == "/" { "/download".to_string() } else { target.pathname.strip_suffix('/').unwrap_or(&target.pathname).to_string() };
    let download_path = format!("{prefix}/{cache_key}");
    let result = cache.get_or_download(&cache_key, || download_resource(state, &target, &download_path)).await.map_err(|error: CacheError| error.0)?;
    let decoded = async {
        let mut data = result.data;
        if config.decrypt_enabled {
            let codec = state.cache_codec.as_ref().ok_or("resource cache codec is unavailable")?;
            data = decode_cached_resource(&cache_key, &data, &mut *codec.lock().await, true).map_err(|error| error.0)?;
        }
        if !cache_key.to_lowercase().ends_with(".d") || config.decrypt_enabled {
            data = rewrite_legacy_navigation_script(&cache_key, &data);
        }
        Ok::<Vec<u8>, String>(data)
    }
    .await;
    let data = match decoded {
        Ok(data) => data,
        Err(error) => {
            let _ = cache.remove(&cache_key).await;
            return Err(error);
        }
    };
    let mut response = bytes_response(StatusCode::OK, if *method == Method::HEAD { Vec::new() } else { data.clone() }, Some(content_type_for(&cache_key)));
    if *method == Method::HEAD {
        if let Ok(length) = HeaderValue::from_str(&data.len().to_string()) {
            response.headers_mut().insert("content-length", length);
        }
    }
    Ok(response)
}

async fn download_resource(state: &HttpProxyState, target: &ParsedTarget, resource_path: &str) -> Result<Vec<u8>, CacheError> {
    let url = format!("{}://{}:{}{}", target.protocol, target.hostname, target.port, resource_path);
    let response = state.client.get(&url).send().await.map_err(|error| CacheError(format!("resource download failed: {error}")))?;
    if response.status() != StatusCode::OK {
        return Err(CacheError(format!("resource download failed with status {}", response.status())));
    }
    Ok(response.bytes().await.map_err(|error| CacheError(error.to_string()))?.to_vec())
}
