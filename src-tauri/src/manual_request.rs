use crate::codec::{TztCodec, TztQuery, TztResponse};
use crate::local_cache::parse_local_cache_text;
use crate::tcp_bridge::{TcpBridgePool, TcpTarget};
use serde_json::Value;
use std::collections::HashMap;
use std::time::{Duration, Instant};
use tokio_stream::StreamExt;

const MAX_RESPONSE_SIZE: usize = 16 * 1024 * 1024;
const LOGIN_ACTIONS: [&str; 3] = ["100", "104", "105"];

pub struct ManualRequestOptions {
    pub host: String,
    pub port: u16,
    pub params_text: String,
    pub timeout: Duration,
    pub transport: Option<String>,
}

#[derive(Debug, serde::Serialize)]
pub struct ManualRequestResult {
    #[serde(rename = "statusCode")]
    pub status_code: Option<u16>,
    #[serde(rename = "statusMessage")]
    pub status_message: Option<String>,
    pub body: String,
    #[serde(rename = "durationMs")]
    pub duration_ms: u64,
}

pub fn parse_manual_request_params(text: &str) -> Result<TztQuery, String> {
    let mut params = TztQuery::new();
    for (index, line) in text.split('\n').enumerate() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with(';') {
            continue;
        }
        let Some(separator) = trimmed.find('=') else {
            return Err(format!("第 {} 行格式无效，请使用“键=值”格式", index + 1));
        };
        if separator == 0 {
            return Err(format!("第 {} 行缺少参数名", index + 1));
        }
        let key = trimmed[..separator].trim();
        if key.is_empty() {
            return Err(format!("第 {} 行缺少参数名", index + 1));
        }
        params.insert(key.to_string(), Value::String(trimmed[separator + 1..].trim().to_string()));
    }
    Ok(params)
}

pub fn serialize_manual_request_params(params: &TztQuery) -> String {
    let mut serializer = url::form_urlencoded::Serializer::new(String::new());
    for (key, value) in params {
        serializer.append_pair(key, value.as_str().unwrap_or(""));
    }
    serializer.finish()
}

fn format_tzt_value(value: &Value) -> String {
    match value {
        Value::String(text) => text.replace('\u{3}', ""),
        Value::Null => String::new(),
        Value::Number(_) | Value::Bool(_) => crate::http_proxy::js_string(value),
        other => other.to_string(),
    }
}

pub fn format_tzt_response(response: &TztResponse) -> String {
    let mut lines: Vec<String> = Vec::new();
    for (key, value) in response {
        if key == "zzkeyByte" || key == "zzbytes" {
            continue;
        }
        let display_key = if key == "Grid0" { "Grid" } else if key == "IntactToServer" { "Intacttoserver" } else { key.as_str() };
        if key == "Grid0" {
            if let Value::Array(rows) = value {
                let grid_lines: Vec<String> = rows.iter().map(format_tzt_value).collect();
                lines.push(format!("{display_key} = {}", grid_lines.join("\n")));
                continue;
            }
        }
        lines.push(format!("{display_key} = {}", format_tzt_value(value)));
    }
    lines.join("\n")
}

fn scalar_response_values(value: &Value) -> Option<HashMap<String, String>> {
    let record = value.as_object()?;
    let values: HashMap<String, String> = record
        .iter()
        .filter(|(_, entry)| matches!(entry, Value::String(_) | Value::Number(_) | Value::Bool(_)))
        .map(|(key, entry)| (key.to_uppercase(), crate::http_proxy::js_string(entry)))
        .collect();
    if values.is_empty() {
        return None;
    }
    Some(values)
}

pub fn extract_manual_login_values(params_text: &str, response_body: &str) -> Option<HashMap<String, String>> {
    let params = parse_manual_request_params(params_text).ok()?;
    let action = params
        .iter()
        .rev()
        .find(|(key, _)| key.to_uppercase() == "ACTION")
        .and_then(|(_, value)| value.as_str().map(str::trim))?;
    if !LOGIN_ACTIONS.contains(&action) {
        return None;
    }
    if let Ok(parsed) = serde_json::from_str::<Value>(response_body) {
        if let Some(values) = scalar_response_values(&parsed) {
            return Some(values);
        }
    }
    if let Ok(values) = parse_local_cache_text(response_body) {
        if !values.is_empty() {
            return Some(values);
        }
    }
    None
}

pub async fn send_manual_request(options: &ManualRequestOptions) -> Result<ManualRequestResult, String> {
    let params = parse_manual_request_params(&options.params_text)?;
    if options.transport.as_deref() == Some("http") {
        return send_http_request(options, &params).await;
    }
    send_tzt_request(options, &params).await
}

async fn send_tzt_request(options: &ManualRequestOptions, params: &TztQuery) -> Result<ManualRequestResult, String> {
    let started = Instant::now();
    let codec = TztCodec::new().map_err(|error| error.0)?;
    let bridge = TcpBridgePool::with_codec(codec, options.timeout, options.timeout);
    let host = options.host.trim_start_matches('[').trim_end_matches(']').to_string();
    let result = bridge.request(&TcpTarget { host, port: options.port }, params).await;
    bridge.close().await;
    let response = result.map_err(|error| error.0)?;
    Ok(ManualRequestResult {
        status_code: None,
        status_message: None,
        body: format_tzt_response(&response),
        duration_ms: started.elapsed().as_millis() as u64,
    })
}

async fn send_http_request(options: &ManualRequestOptions, params: &TztQuery) -> Result<ManualRequestResult, String> {
    let started = Instant::now();
    let host = options.host.trim_start_matches('[').trim_end_matches(']');
    let url = format!("http://{host}:{}/reqxml", options.port);
    let client = reqwest::Client::builder().timeout(options.timeout).build().map_err(|error| error.to_string())?;
    let response = client
        .post(&url)
        .header("content-type", "application/x-www-form-urlencoded")
        .body(serialize_manual_request_params(params))
        .send()
        .await
        .map_err(|error| if error.is_timeout() { "请求超时".to_string() } else { error.to_string() })?;
    let status = response.status();
    let mut body: Vec<u8> = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| error.to_string())?;
        body.extend_from_slice(&chunk);
        if body.len() > MAX_RESPONSE_SIZE {
            return Err("应答内容超过 16 MiB 限制".to_string());
        }
    }
    Ok(ManualRequestResult {
        status_code: Some(status.as_u16()),
        status_message: status.canonical_reason().map(str::to_string),
        body: String::from_utf8_lossy(&body).into_owned(),
        duration_ms: started.elapsed().as_millis() as u64,
    })
}
