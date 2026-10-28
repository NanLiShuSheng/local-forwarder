use crate::config::{create_default_config, AppConfig, ForwardRule, TcpTargetConfig};
use regex::Regex;
use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::OnceLock;

const MAX_LEGACY_INPUT_BYTES: usize = 1_048_576;
const MAX_LEGACY_DEPTH: usize = 64;
const MAX_LEGACY_NODES: usize = 10_000;
const MAX_SERIALIZED_CONFIG_BYTES: usize = 1_000_000;
const MAX_STATIC_REPEAT_COUNT: u64 = 8_000_000;
const EVAL_TIMEOUT: std::time::Duration = std::time::Duration::from_millis(2_000);
const DANGEROUS_KEYS: [&str; 3] = ["__proto__", "prototype", "constructor"];

#[derive(Debug)]
pub struct ParseError {
    pub filename: String,
    pub field: String,
    pub message: String,
}

impl std::fmt::Display for ParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{} {}: {}", self.filename, self.field, self.message)
    }
}

impl std::error::Error for ParseError {}

type Result<T> = std::result::Result<T, ParseError>;

fn error<T>(filename: &str, field: &str, message: impl Into<String>) -> Result<T> {
    Err(ParseError { filename: filename.to_string(), field: field.to_string(), message: message.into() })
}

fn key_of(value: &str) -> String {
    value.trim().to_lowercase()
}

fn is_dangerous_key(key: &str) -> bool {
    DANGEROUS_KEYS.contains(&key_of(key).as_str())
}

fn record_key<'a>(record: &'a Map<String, Value>, wanted: &str) -> Option<&'a str> {
    record.keys().find(|key| key_of(key) == wanted).map(String::as_str)
}

fn value_of<'a>(record: &'a Map<String, Value>, wanted: &str) -> Option<&'a Value> {
    record_key(record, wanted).map(|key| &record[key])
}

fn required_record<'a>(value: &'a Value, filename: &str) -> Result<&'a Map<String, Value>> {
    value.as_object().ok_or_else(|| ParseError { filename: filename.to_string(), field: "root".to_string(), message: "expected an object".to_string() })
}

fn parse_port(value: &Value, filename: &str, field: &str) -> Result<u16> {
    let number = value.as_i64().or_else(|| value.as_u64().and_then(|v| i64::try_from(v).ok()));
    match number {
        Some(port) if (1..=65535).contains(&port) => Ok(port as u16),
        _ => error(filename, field, "port must be an integer between 1 and 65535"),
    }
}

fn parse_legacy_root_port(value: &Value, filename: &str, field: &str) -> Result<u16> {
    if let Some(text) = value.as_str() {
        let trimmed = text.trim();
        if trimmed.is_empty() || !trimmed.bytes().all(|byte| byte.is_ascii_digit()) {
            return error(filename, field, "port must be an integer between 1 and 65535");
        }
        return parse_port(&Value::from(trimmed.parse::<i64>().unwrap_or(-1)), filename, field);
    }
    parse_port(value, filename, field)
}

fn normalize_host(host: &str) -> String {
    host.strip_prefix('[').and_then(|h| h.strip_suffix(']')).unwrap_or(host).to_string()
}

fn parse_boolean(value: &Value, filename: &str, field: &str) -> Result<bool> {
    if let Some(flag) = value.as_bool() {
        return Ok(flag);
    }
    if let Some(text) = value.as_str() {
        let trimmed = text.trim().to_lowercase();
        if trimmed == "true" || trimmed == "false" {
            return Ok(trimmed == "true");
        }
    }
    error(filename, field, "expected a boolean")
}

fn parse_timeout(value: &Value, filename: &str, field: &str) -> Result<u64> {
    match value.as_u64().or_else(|| value.as_i64().and_then(|v| u64::try_from(v).ok())) {
        Some(timeout) => Ok(timeout),
        None => error(filename, field, "expected a non-negative integer"),
    }
}

pub fn assert_config_data_limits(value: &Value, filename: &str) -> Result<()> {
    let mut pending: Vec<(&Value, usize, String)> = vec![(value, 0, "root".to_string())];
    let mut nodes = 0usize;
    let mut estimated_bytes = 0usize;
    while let Some((current, depth, field)) = pending.pop() {
        nodes += 1;
        if nodes > MAX_LEGACY_NODES {
            return error(filename, &field, "structure exceeds maximum node count");
        }
        if depth > MAX_LEGACY_DEPTH {
            return error(filename, &field, "structure exceeds maximum depth");
        }
        match current {
            Value::String(text) => estimated_bytes += text.len() + 2,
            _ => estimated_bytes += 16,
        }
        if estimated_bytes > MAX_SERIALIZED_CONFIG_BYTES {
            return error(filename, &field, "structure exceeds maximum serialized size");
        }
        if let Value::Array(items) = current {
            for (index, child) in items.iter().enumerate() {
                let child_field = format!("{}[{}]", if field == "root" { String::new() } else { field.clone() }, index);
                pending.push((child, depth + 1, child_field));
            }
        } else if let Value::Object(record) = current {
            for (key, child) in record {
                let child_field = if field == "root" { key.clone() } else { format!("{field}.{key}") };
                estimated_bytes += key.len() + 3;
                if estimated_bytes > MAX_SERIALIZED_CONFIG_BYTES {
                    return error(filename, &child_field, "structure exceeds maximum serialized size");
                }
                if is_dangerous_key(key) {
                    return error(filename, &child_field, "dangerous key is not allowed");
                }
                pending.push((child, depth + 1, child_field));
            }
        }
    }
    Ok(())
}

fn assert_no_obvious_huge_allocation(text: &str, filename: &str) -> Result<()> {
    static PATTERNS: OnceLock<Vec<Regex>> = OnceLock::new();
    let patterns = PATTERNS.get_or_init(|| {
        vec![
            Regex::new(r"\.repeat\s*\(\s*(\d+)\s*\)").expect("repeat pattern"),
            Regex::new(r"(?:new\s+)?Array\s*\(\s*(\d+)\s*\)").expect("array pattern"),
            Regex::new(r"Array\.from\s*\(\s*\{\s*length\s*:\s*(\d+)").expect("array-from pattern"),
        ]
    });
    for pattern in patterns {
        for captures in pattern.captures_iter(text) {
            if captures[1].parse::<u64>().unwrap_or(0) > MAX_STATIC_REPEAT_COUNT {
                return error(filename, "root", "source exceeds restricted worker resource limit");
            }
        }
    }
    Ok(())
}

fn protocol_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| Regex::new(r"^[A-Za-z][A-Za-z0-9+.-]*://").expect("protocol pattern"))
}

fn bare_host_port_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| Regex::new(r"^(?:\[[^\]]+\]|[^/:?#\s]+):\d+(?:[/?#].*)?$").expect("host:port pattern"))
}

struct LegacyApplier<'a> {
    config: &'a mut AppConfig,
    filename: String,
}

impl LegacyApplier<'_> {
    fn extra(&mut self) -> &mut Map<String, Value> {
        &mut self.config.legacy.get_or_insert_with(Default::default).extra
    }

    fn preserve_unknown(&mut self, record: &Map<String, Value>, known_keys: &[&str], prefix: &str) {
        let known: HashSet<String> = known_keys.iter().map(|key| key_of(key)).collect();
        for (key, value) in record {
            let normalized = key_of(key);
            if !known.contains(&normalized) {
                self.extra().insert(format!("{prefix}.{normalized}"), value.clone());
            }
        }
    }

    fn apply_server(&mut self, raw: &Map<String, Value>) -> Result<()> {
        let filename = self.filename.clone();
        if let Some(value) = value_of(raw, "bindhost") {
            let Some(host) = value.as_str() else { return error(&filename, "server.bindHost", "expected a string") };
            self.config.server.bind_host = host.to_string();
        }
        if let Some(value) = value_of(raw, "port") {
            self.config.server.port = parse_legacy_root_port(value, &filename, "server.port")?;
        }
        if let Some(value) = value_of(raw, "timeout") {
            self.config.server.timeout_ms = parse_timeout(value, &filename, "server.timeoutMs")?;
        }
        if let Some(value) = value_of(raw, "islog") {
            self.config.server.logging_enabled = parse_boolean(value, &filename, "server.loggingEnabled")?;
        }
        let Some(server_value) = value_of(raw, "server") else { return Ok(()) };
        let server = required_record(server_value, &filename)?.clone();
        if let Some(value) = value_of(&server, "bindhost") {
            let Some(host) = value.as_str() else { return error(&filename, "server.bindHost", "expected a string") };
            self.config.server.bind_host = host.to_string();
        }
        if let Some(value) = value_of(&server, "port") {
            self.config.server.port = parse_port(value, &filename, "server.port")?;
        }
        if let Some(value) = value_of(&server, "timeoutms") {
            self.config.server.timeout_ms = parse_timeout(value, &filename, "server.timeoutMs")?;
        }
        if let Some(value) = value_of(&server, "loggingenabled") {
            self.config.server.logging_enabled = parse_boolean(value, &filename, "server.loggingEnabled")?;
        }
        self.preserve_unknown(&server, &["bindhost", "port", "timeoutms", "loggingenabled"], "server");
        Ok(())
    }

    fn apply_cache(&mut self, raw: &Map<String, Value>) -> Result<()> {
        let filename = self.filename.clone();
        let Some(cache_value) = value_of(raw, "cache") else { return Ok(()) };
        let cache = required_record(cache_value, &filename)?.clone();
        for (field, is_root_dir) in [("rootdir", true), ("downloadtarget", false)] {
            if let Some(value) = value_of(&cache, field) {
                let Some(text) = value.as_str() else {
                    return error(&filename, if is_root_dir { "cache.rootDir" } else { "cache.downloadTarget" }, "expected a string");
                };
                if is_root_dir {
                    self.config.cache.root_dir = text.to_string();
                } else {
                    self.config.cache.download_target = text.to_string();
                }
            }
        }
        if let Some(value) = value_of(&cache, "decryptenabled") {
            self.config.cache.decrypt_enabled = parse_boolean(value, &filename, "cache.decryptEnabled")?;
        }
        if let Some(value) = value_of(&cache, "autodownload") {
            self.config.cache.auto_download = parse_boolean(value, &filename, "cache.autoDownload")?;
        }
        self.preserve_unknown(&cache, &["rootdir", "downloadtarget", "decryptenabled", "autodownload"], "cache");
        Ok(())
    }

    fn apply_accounts(&mut self, raw: &Map<String, Value>) -> Result<()> {
        let filename = self.filename.clone();
        let value = value_of(raw, "accounts").or_else(|| value_of(raw, "account"));
        let Some(value) = value else { return Ok(()) };
        let Some(accounts) = value.as_object() else { return error(&filename, "accounts", "expected an object") };
        let accounts = accounts.clone();
        for (account_name, account_value) in &accounts {
            let Some(fields) = account_value.as_object() else {
                return error(&filename, &format!("accounts.{account_name}"), "expected an object");
            };
            let account = self.config.accounts.entry(account_name.to_lowercase()).or_default();
            for (field, entry) in fields {
                let text = match entry {
                    Value::String(text) => text.clone(),
                    Value::Number(number) => number.to_string(),
                    Value::Bool(flag) => flag.to_string(),
                    _ => return error(&filename, &format!("accounts.{account_name}.{field}"), "expected a string, number, or boolean"),
                };
                account.insert(field.to_lowercase(), text);
            }
        }
        Ok(())
    }

    fn as_rule(&self, value: &Value, index: usize) -> Result<ForwardRule> {
        let filename = self.filename.clone();
        let Some(record) = value.as_object() else { return error(&filename, &format!("httpRules[{index}]"), "expected an object") };
        let match_ = value_of(record, "match").and_then(Value::as_str);
        let target = value_of(record, "target").and_then(Value::as_str);
        let Some(match_) = match_ else { return error(&filename, &format!("httpRules[{index}].match"), "expected a string") };
        let Some(target) = target else { return error(&filename, &format!("httpRules[{index}].target"), "expected a string") };
        for (field, value) in [("id", value_of(record, "id")), ("name", value_of(record, "name")), ("rewrite", value_of(record, "rewrite"))] {
            if let Some(value) = value {
                if !value.is_string() {
                    return error(&filename, &format!("httpRules[{index}].{field}"), "expected a string");
                }
            }
        }
        if let Some(enabled) = value_of(record, "enabled") {
            if !enabled.is_boolean() {
                return error(&filename, &format!("httpRules[{index}].enabled"), "expected a boolean");
            }
        }
        Ok(ForwardRule {
            id: value_of(record, "id").and_then(Value::as_str).map(str::to_string).unwrap_or_else(|| format!("http-{}", index + 1)),
            name: value_of(record, "name").and_then(Value::as_str).map(str::to_string).unwrap_or_else(|| match_.to_string()),
            match_: match_.to_string(),
            target: target.to_string(),
            rewrite: value_of(record, "rewrite").and_then(Value::as_str).map(str::to_string),
            enabled: value_of(record, "enabled").and_then(Value::as_bool).unwrap_or(true),
        })
    }

    fn apply_canonical_rules(&mut self, raw: &Map<String, Value>) -> Result<()> {
        let filename = self.filename.clone();
        if let Some(value) = value_of(raw, "httprules") {
            let Some(rules) = value.as_array() else { return error(&filename, "httpRules", "expected an array") };
            let rules = rules.clone();
            let mut parsed = Vec::new();
            for (index, rule) in rules.iter().enumerate() {
                parsed.push(self.as_rule(rule, index)?);
                if let Some(record) = rule.as_object() {
                    self.preserve_unknown(record, &["id", "name", "match", "target", "rewrite", "enabled"], &format!("httpRules[{index}]"));
                }
            }
            self.config.http_rules = parsed;
        }
        if let Some(value) = value_of(raw, "tcptargets") {
            let Some(targets) = value.as_array() else { return error(&filename, "tcpTargets", "expected an array") };
            let targets = targets.clone();
            let mut parsed = Vec::new();
            for (index, target) in targets.iter().enumerate() {
                let prefix = format!("tcpTargets[{index}]");
                let Some(record) = target.as_object() else { return error(&filename, &prefix, "expected an object") };
                let record = record.clone();
                let host = value_of(&record, "host").and_then(Value::as_str);
                let Some(host) = host else { return error(&filename, &format!("{prefix}.host"), "expected a string") };
                let port = parse_port(value_of(&record, "port").unwrap_or(&Value::Null), &filename, &format!("{prefix}.port"))?;
                if let Some(id) = value_of(&record, "id") {
                    if !id.is_string() {
                        return error(&filename, &format!("{prefix}.id"), "expected a string");
                    }
                }
                if let Some(name) = value_of(&record, "name") {
                    if !name.is_string() {
                        return error(&filename, &format!("{prefix}.name"), "expected a string");
                    }
                }
                let protocol = value_of(&record, "protocol").and_then(Value::as_str);
                if let Some(protocol) = protocol {
                    if protocol != "http" && protocol != "https" {
                        return error(&filename, &format!("{prefix}.protocol"), "expected http or https");
                    }
                }
                let base_path = value_of(&record, "basepath").and_then(Value::as_str);
                if let Some(base_path) = base_path {
                    if !base_path.starts_with('/') {
                        return error(&filename, &format!("{prefix}.basePath"), "expected an absolute path");
                    }
                }
                let transport = value_of(&record, "transport").and_then(Value::as_str);
                if let Some(transport) = transport {
                    if transport != "tcp" && transport != "http" {
                        return error(&filename, &format!("{prefix}.transport"), "expected tcp or http");
                    }
                }
                let normalized_host = normalize_host(host);
                self.preserve_unknown(&record, &["id", "name", "host", "port", "protocol", "basePath", "transport"], &prefix);
                parsed.push(TcpTargetConfig {
                    id: value_of(&record, "id").and_then(Value::as_str).map(str::to_string).unwrap_or_else(|| format!("tcp-{}", index + 1)),
                    name: value_of(&record, "name").and_then(Value::as_str).map(str::to_string).unwrap_or_else(|| normalized_host.clone()),
                    host: normalized_host,
                    port,
                    protocol: protocol.map(str::to_string),
                    base_path: base_path.map(str::to_string),
                    transport: transport.map(str::to_string),
                });
            }
            self.config.tcp_targets = parsed;
        }
        Ok(())
    }

    fn apply_legacy_conifg(&mut self, raw: &Map<String, Value>) -> Result<()> {
        let filename = self.filename.clone();
        let value = value_of(raw, "conifg").or_else(|| value_of(raw, "config"));
        let Some(value) = value else { return Ok(()) };
        let Some(conifg) = value.as_object() else { return error(&filename, "conifg", "expected an object") };
        let conifg = conifg.clone();
        let mut http_rules: Vec<ForwardRule> = Vec::new();
        let mut tcp_targets: Vec<TcpTargetConfig> = Vec::new();
        let existing_tcp_targets = self.config.tcp_targets.clone();
        for (match_key, entry) in &conifg {
            let rule = if entry.is_object() { entry.clone() } else { Value::Object(Map::from_iter([("target".to_string(), entry.clone())])) };
            let rule_record = rule.as_object().expect("rule object").clone();
            if entry.is_object() {
                self.preserve_unknown(&rule_record, &["target", "url", "id", "name", "rewrite", "enabled", "useHttp"], &format!("conifg.{match_key}"));
            }
            let target = value_of(&rule_record, "target");
            if match_key.to_lowercase() == "/reqxml" {
                let target_items: Vec<Value> = match target {
                    Some(Value::Array(items)) => items.clone(),
                    Some(item) => vec![item.clone()],
                    None => vec![],
                };
                let use_http = value_of(&rule_record, "usehttp");
                if let Some(use_http) = use_http {
                    if !use_http.is_boolean() {
                        return error(&filename, &format!("conifg.{match_key}.useHttp"), "expected a boolean");
                    }
                }
                let use_http = use_http.and_then(Value::as_bool) == Some(true);
                let is_array = matches!(target, Some(Value::Array(_)));
                for (index, item) in target_items.iter().enumerate() {
                    let field = if is_array { format!("conifg.{match_key}.target[{index}]") } else { format!("conifg.{match_key}.target") };
                    let Some(item) = item.as_str() else { return error(&filename, &field, "expected a string") };
                    let normalized_item = normalize_wrapped_url(item);
                    let has_protocol = protocol_pattern().is_match(&normalized_item);
                    if !has_protocol && !bare_host_port_pattern().is_match(&normalized_item) {
                        return error(&filename, &field, "invalid URL");
                    }
                    let parseable = if has_protocol { normalized_item.clone() } else { format!("http://{normalized_item}") };
                    let url = url::Url::parse(&parseable).map_err(|_| ParseError { filename: filename.clone(), field: field.clone(), message: "invalid URL".to_string() })?;
                    if url.scheme() != "http" && url.scheme() != "https" {
                        return error(&filename, &field, "expected an http or https URL");
                    }
                    if url.host_str().unwrap_or("").is_empty() {
                        return error(&filename, &field, "invalid URL");
                    }
                    let port = url.port().unwrap_or(if url.scheme() == "https" { 443 } else { 80 });
                    let metadata = existing_tcp_targets.get(tcp_targets.len());
                    tcp_targets.push(TcpTargetConfig {
                        id: metadata.map(|target| target.id.clone()).unwrap_or_else(|| format!("tcp-{}", tcp_targets.len() + 1)),
                        name: metadata.map(|target| target.name.clone()).unwrap_or_else(|| match_key.clone()),
                        host: normalize_host(url.host_str().unwrap_or("")),
                        port,
                        protocol: Some(if url.scheme() == "https" { "https".to_string() } else { "http".to_string() }),
                        base_path: if url.path() == "/" { None } else { Some(url.path().trim_end_matches('/').to_string()) },
                        transport: if use_http { Some("http".to_string()) } else { None },
                    });
                }
                continue;
            }
            let resolved = value_of(&rule_record, "target").or_else(|| value_of(&rule_record, "url"));
            let Some(resolved) = resolved.and_then(Value::as_str) else {
                return error(&filename, &format!("conifg.{match_key}.target"), "expected a string");
            };
            let id = value_of(&rule_record, "id").and_then(Value::as_str);
            let name = value_of(&rule_record, "name").and_then(Value::as_str);
            let rewrite = value_of(&rule_record, "rewrite").and_then(Value::as_str);
            let enabled = value_of(&rule_record, "enabled").and_then(Value::as_bool);
            http_rules.push(ForwardRule {
                id: id.map(str::to_string).unwrap_or_else(|| format!("http-{}", http_rules.len() + 1)),
                name: name.map(str::to_string).unwrap_or_else(|| match_key.clone()),
                match_: match_key.clone(),
                target: resolved.to_string(),
                rewrite: rewrite.map(str::to_string),
                enabled: enabled.unwrap_or(true),
            });
        }
        let mut existing_matches: HashSet<String> = self.config.http_rules.iter().map(|rule| rule.match_.clone()).collect();
        for (index, rule) in http_rules.iter().enumerate() {
            if !existing_matches.insert(rule.match_.clone()) {
                return error(&filename, &format!("httpRules[{}].match", self.config.http_rules.len() + index), "duplicate HTTP rule match");
            }
        }
        self.config.http_rules.extend(http_rules);
        self.config.tcp_targets = tcp_targets;
        Ok(())
    }
}

fn apply_string_record(target: &mut HashMap<String, String>, value: Option<&Value>, filename: &str, field: &str, uppercase_keys: bool) -> Result<()> {
    let Some(value) = value else { return Ok(()) };
    let Some(record) = value.as_object() else { return error(filename, field, "expected an object") };
    for (key, entry) in record {
        let Some(text) = entry.as_str() else { return error(filename, &format!("{field}.{key}"), "expected a string") };
        target.insert(if uppercase_keys { key.to_uppercase() } else { key.clone() }, text.to_string());
    }
    Ok(())
}

fn normalize_wrapped_url(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.len() >= 2 {
        let first = trimmed.as_bytes()[0] as char;
        let last = trimmed.as_bytes()[trimmed.len() - 1] as char;
        if (first == '"' || first == '\'') && first == last {
            return trimmed[1..trimmed.len() - 1].trim().to_string();
        }
        if first == '"' || first == '\'' {
            let candidate = trimmed[1..].trim();
            if is_legal_http_url(candidate) {
                return candidate.to_string();
            }
        }
    }
    trimmed.to_string()
}

fn is_legal_http_url(value: &str) -> bool {
    let Ok(url) = url::Url::parse(value) else { return false };
    (url.scheme() == "http" || url.scheme() == "https") && !url.host_str().unwrap_or("").is_empty()
}

pub fn parse_sys_config(text: &str, filename: &str) -> Result<HashMap<String, String>> {
    if text.len() > MAX_LEGACY_INPUT_BYTES {
        return error(filename, "file", "input is too large");
    }
    let mut result = HashMap::new();
    let mut entries = 0usize;
    for (index, line) in text.split('\n').enumerate() {
        let uncommented = line.split([';', '#']).next().unwrap_or("").trim();
        if uncommented.is_empty() {
            continue;
        }
        if uncommented.starts_with('[') && uncommented.ends_with(']') && uncommented.len() >= 2 {
            let section = uncommented[1..uncommented.len() - 1].trim();
            if section.is_empty() {
                return error(filename, &format!("line {}", index + 1), "section name cannot be empty");
            }
            if is_dangerous_key(section) {
                return error(filename, section, "dangerous key is not allowed");
            }
            continue;
        }
        let Some(separator) = uncommented.find('=') else {
            return error(filename, &format!("line {}", index + 1), "expected key=value");
        };
        let key = uncommented[..separator].trim();
        if key.is_empty() {
            return error(filename, &format!("line {}", index + 1), "key cannot be empty");
        }
        if is_dangerous_key(key) {
            return error(filename, key, "dangerous key is not allowed");
        }
        entries += 1;
        if entries > MAX_LEGACY_NODES {
            return error(filename, &format!("line {}", index + 1), "input exceeds maximum entry count");
        }
        result.insert(key.to_uppercase(), uncommented[separator + 1..].trim().to_string());
    }
    Ok(result)
}

fn from_raw(raw: &Value, filename: &str) -> Result<AppConfig> {
    assert_config_data_limits(raw, filename)?;
    let mut config = create_default_config();
    apply_raw_object(&mut config, raw, filename)?;
    let mut matches = HashSet::new();
    for (index, rule) in config.http_rules.iter().enumerate() {
        if !matches.insert(rule.match_.clone()) {
            return error(filename, &format!("httpRules[{index}].match"), "duplicate HTTP rule match");
        }
    }
    config.legacy.get_or_insert_with(Default::default).files.insert(filename.to_string(), raw.clone());
    Ok(config)
}

fn apply_raw_object(config: &mut AppConfig, raw: &Value, filename: &str) -> Result<()> {
    let record = required_record(raw, filename)?.clone();
    {
        let mut applier = LegacyApplier { config, filename: filename.to_string() };
        if let Some(project_path) = value_of(&record, "path").or_else(|| value_of(&record, "projectpath")) {
            let Some(project_path) = project_path.as_str() else { return error(filename, "projectPath", "expected a string") };
            applier.config.project_path = Some(project_path.to_string());
        }
        applier.apply_server(&record)?;
        applier.apply_cache(&record)?;
        applier.apply_accounts(&record)?;
        applier.apply_canonical_rules(&record)?;
        applier.apply_legacy_conifg(&record)?;
        let known: HashSet<&str> = ["server", "path", "projectpath", "cache", "accounts", "account", "localvalues", "local", "mapvalues", "map", "httprules", "tcptargets", "conifg", "config", "legacy", "islog", "timeout", "port", "bindhost"].into_iter().collect();
        for (key, value) in &record {
            let normalized = key_of(key);
            if !known.contains(normalized.as_str()) {
                applier.extra().insert(normalized, value.clone());
            }
        }
    }
    let local_values = value_of(&record, "localvalues").or_else(|| value_of(&record, "local")).cloned();
    apply_string_record(&mut config.local_values, local_values.as_ref(), filename, "localValues", true)?;
    let map_values = value_of(&record, "mapvalues").or_else(|| value_of(&record, "map")).cloned();
    apply_string_record(&mut config.map_values, map_values.as_ref(), filename, "mapValues", true)?;
    Ok(())
}

pub fn parse_legacy_json(text: &str, filename: &str) -> Result<AppConfig> {
    if text.len() > MAX_LEGACY_INPUT_BYTES {
        return error(filename, "file", "input is too large");
    }
    let raw: Value = serde_json::from_str(text).map_err(|error| ParseError { filename: filename.to_string(), field: "root".to_string(), message: format!("invalid JSON: {error}") })?;
    from_raw(&raw, filename)
}

/// config.js 求值沙箱（bundled node16 子进程内运行；与 TS worker 版同一套隔离策略）
const EVAL_WORKER_SOURCE: &str = r#"
const fs = require("node:fs");
const vm = require("node:vm");
const text = fs.readFileSync(0, "utf8");
const finish = (payload) => { process.stdout.write(JSON.stringify(payload)); };
try {
  const context = vm.createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false } });
  const runOptions = { filename: "config.js", timeout: 500, contextCodeGeneration: { strings: false, wasm: false } };
  vm.runInContext(`const __jsonStringify = JSON.stringify;
    const __jsonReplacer = (key, value) => {
      if (typeof value === "function") throw new Error("resource value is not serializable");
      if (value !== null && typeof value === "object") {
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== null && prototype !== Object.prototype && prototype !== Array.prototype) throw new Error("resource object type is not serializable");
      }
      return value;
    };
    for (const name of ["ArrayBuffer","SharedArrayBuffer","DataView","Uint8Array","Uint8ClampedArray","Uint16Array","Uint32Array","Int8Array","Int16Array","Int32Array","Float32Array","Float64Array","BigInt64Array","BigUint64Array","Buffer","WebAssembly","Proxy"]) {
      try { Object.defineProperty(globalThis, name, { value: undefined, writable: false, configurable: false }); } catch {}
    }
    var module = Object.create(null); var exports = Object.create(null); module.exports = exports;`, context, runOptions);
  vm.runInContext(text, context, runOptions);
  const serialized = vm.runInContext("__jsonStringify(module.exports, __jsonReplacer)", context, runOptions);
  if (typeof serialized !== "string") throw new Error("module.exports must be JSON-serializable");
  finish({ ok: true, serialized });
} catch (error) {
  finish({ ok: false, message: String(error && error.message ? error.message : error) });
}
"#;

pub fn parse_legacy_config_js(text: &str, filename: &str) -> Result<AppConfig> {
    if text.len() > MAX_LEGACY_INPUT_BYTES {
        return error(filename, "file", "input is too large");
    }
    assert_no_obvious_huge_allocation(text, filename)?;
    let raw = eval_with_node16(text, filename)?;
    from_raw(&raw, filename)
}

fn eval_with_node16(text: &str, filename: &str) -> Result<Value> {
    use std::io::{Read, Write};
    let node = crate::codec::node16_binary_path().map_err(|error| ParseError { filename: filename.to_string(), field: "root".to_string(), message: error.0 })?;
    let mut child = std::process::Command::new(node)
        .args(["--max-old-space-size=64", "--stack-size=4096", "-e", EVAL_WORKER_SOURCE])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|error| ParseError { filename: filename.to_string(), field: "root".to_string(), message: format!("could not start restricted config worker: {error}") })?;
    child.stdin.take().expect("stdin piped").write_all(text.as_bytes()).ok();
    let started = std::time::Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if started.elapsed() < EVAL_TIMEOUT => std::thread::sleep(std::time::Duration::from_millis(10)),
            _ => {
                let _ = child.kill();
                return error(filename, "root", "restricted config worker exceeded resource limit or timeout");
            }
        }
    }
    let mut output = Vec::new();
    let _ = child.stdout.take().expect("stdout piped").read_to_end(&mut output);
    let envelope: Value = serde_json::from_slice(&output).map_err(|error| ParseError { filename: filename.to_string(), field: "root".to_string(), message: format!("restricted config worker returned invalid JSON: {error}") })?;
    if envelope.get("ok") == Some(&Value::Bool(true)) {
        if let Some(serialized) = envelope.get("serialized").and_then(Value::as_str) {
            if serialized.len() > MAX_SERIALIZED_CONFIG_BYTES {
                return error(filename, "root", "serialized config is too large");
            }
            let raw: Value = serde_json::from_str(serialized).map_err(|error| ParseError { filename: filename.to_string(), field: "root".to_string(), message: format!("invalid serialized config JSON: {error}") })?;
            return Ok(raw);
        }
    }
    let message = envelope.get("message").and_then(Value::as_str).unwrap_or("unknown worker error");
    error(filename, "root", format!("restricted config worker resource limit or timeout: {message}"))
}

async fn read_legacy_file(directory: &Path, filename: &str) -> Result<String> {
    let file_path = directory.join(filename);
    let meta = tokio::fs::symlink_metadata(&file_path).await.map_err(|error| ParseError { filename: filename.to_string(), field: "file".to_string(), message: format!("could not read legacy file: {error}") })?;
    if !meta.is_file() || meta.file_type().is_symlink() {
        return error(filename, "file", "legacy input must be a regular file and cannot be a symlink");
    }
    if meta.len() as usize > MAX_LEGACY_INPUT_BYTES {
        return error(filename, "file", "input is too large");
    }
    let text = tokio::fs::read_to_string(&file_path).await.map_err(|error| ParseError { filename: filename.to_string(), field: "file".to_string(), message: format!("could not read legacy file: {error}") })?;
    if text.len() > MAX_LEGACY_INPUT_BYTES {
        return error(filename, "file", "input is too large");
    }
    Ok(text)
}

pub async fn import_legacy_config(directory: &Path) -> Result<AppConfig> {
    if let Ok(meta) = tokio::fs::symlink_metadata(directory).await {
        if !meta.is_dir() || meta.file_type().is_symlink() {
            return error("directory", "path", "legacy directory must be a real directory");
        }
    }
    let js_text = read_legacy_file(directory, "config.js").await?;
    let json_text = read_legacy_file(directory, "config.json").await?;
    let ini_text = read_legacy_file(directory, "sysconfig.ini").await?;
    let js_raw = parse_legacy_config_js(&js_text, "config.js")?;
    let json_raw = parse_legacy_json(&json_text, "config.json")?;
    let sys_values = parse_sys_config(&ini_text, "sysconfig.ini")?;
    let mut config = create_default_config();
    if let Some(raw) = json_raw.legacy.as_ref().and_then(|legacy| legacy.files.get("config.json")).cloned() {
        apply_raw_object(&mut config, &raw, "config.json")?;
    }
    apply_sys_config(&mut config, &sys_values, "sysconfig.ini")?;
    if let Some(raw) = js_raw.legacy.as_ref().and_then(|legacy| legacy.files.get("config.js")).cloned() {
        apply_raw_object(&mut config, &raw, "config.js")?;
    }
    if let Some(project_path) = config.project_path.clone() {
        if !Path::new(&project_path).is_absolute() {
            config.project_path = Some(directory.join(&project_path).to_string_lossy().into_owned());
        }
    }
    let mut files = Map::new();
    if let Some(value) = js_raw.legacy.and_then(|legacy| legacy.files.get("config.js").cloned()) {
        files.insert("config.js".to_string(), value);
    }
    if let Some(value) = json_raw.legacy.and_then(|legacy| legacy.files.get("config.json").cloned()) {
        files.insert("config.json".to_string(), value);
    }
    files.insert("sysconfig.ini".to_string(), Value::Object(sys_values.into_iter().map(|(key, value)| (key, Value::String(value))).collect()));
    config.legacy.get_or_insert_with(Default::default).files = files;
    Ok(config)
}

fn apply_sys_config(config: &mut AppConfig, values: &HashMap<String, String>, filename: &str) -> Result<()> {
    for (key, value) in values {
        match key.as_str() {
            "PORT" | "SERVER_PORT" => config.server.port = parse_port(&Value::from(value.parse::<i64>().unwrap_or(-1)), filename, "server.port")?,
            "BINDHOST" | "SERVER_BINDHOST" => config.server.bind_host = value.clone(),
            "TIMEOUTMS" | "SERVER_TIMEOUTMS" => config.server.timeout_ms = parse_timeout(&Value::from(value.parse::<u64>().unwrap_or(0)), filename, "server.timeoutMs")?,
            "LOGGINGENABLED" | "SERVER_LOGGINGENABLED" => config.server.logging_enabled = parse_boolean(&Value::from(value.clone()), filename, "server.loggingEnabled")?,
            _ => {
                config.local_values.insert(key.clone(), value.clone());
            }
        }
    }
    Ok(())
}

// ---------- 导出侧 ----------

fn format_tcp_host(host: &str) -> String {
    let unbracketed = normalize_host(host);
    if unbracketed.contains(':') {
        format!("[{unbracketed}]")
    } else {
        unbracketed
    }
}

fn set_safe_path(target: &mut Map<String, Value>, segments: &[&str], value: Value, field: &str) -> Result<()> {
    let mut current = target;
    for (index, segment) in segments.iter().enumerate() {
        if is_dangerous_key(segment) {
            return error("config.js", field, "dangerous path segment is not allowed");
        }
        if index == segments.len() - 1 {
            current.insert(segment.to_string(), value);
            return Ok(());
        }
        if !current.get(*segment).is_some_and(Value::is_object) {
            current.insert(segment.to_string(), Value::Object(Map::new()));
        }
        current = current.get_mut(*segment).and_then(Value::as_object_mut).expect("just inserted");
    }
    Ok(())
}

fn copy_legacy_value(value: &Value, field: &str, filename: &str) -> Result<Value> {
    assert_config_data_limits(value, filename).map_err(|error| ParseError { field: format!("{field}:{}", error.field), ..error })?;
    Ok(value.clone())
}

fn export_http_rule(rule: &ForwardRule, index: usize) -> Result<Map<String, Value>> {
    let mut output = Map::new();
    set_safe_path(&mut output, &["id"], Value::String(rule.id.clone()), &format!("HTTPRULES[{index}].id"))?;
    set_safe_path(&mut output, &["name"], Value::String(rule.name.clone()), &format!("HTTPRULES[{index}].name"))?;
    set_safe_path(&mut output, &["match"], Value::String(rule.match_.clone()), &format!("HTTPRULES[{index}].match"))?;
    set_safe_path(&mut output, &["target"], Value::String(rule.target.clone()), &format!("HTTPRULES[{index}].target"))?;
    if let Some(rewrite) = &rule.rewrite {
        set_safe_path(&mut output, &["rewrite"], Value::String(rewrite.clone()), &format!("HTTPRULES[{index}].rewrite"))?;
    }
    set_safe_path(&mut output, &["enabled"], Value::Bool(rule.enabled), &format!("HTTPRULES[{index}].enabled"))?;
    Ok(output)
}

fn export_tcp_target(target: &TcpTargetConfig, index: usize) -> Result<Map<String, Value>> {
    let mut output = Map::new();
    set_safe_path(&mut output, &["id"], Value::String(target.id.clone()), &format!("tcpTargets[{index}].id"))?;
    set_safe_path(&mut output, &["name"], Value::String(target.name.clone()), &format!("tcpTargets[{index}].name"))?;
    set_safe_path(&mut output, &["host"], Value::String(target.host.clone()), &format!("tcpTargets[{index}].host"))?;
    set_safe_path(&mut output, &["port"], Value::from(target.port), &format!("tcpTargets[{index}].port"))?;
    if let Some(protocol) = &target.protocol {
        set_safe_path(&mut output, &["protocol"], Value::String(protocol.clone()), &format!("tcpTargets[{index}].protocol"))?;
    }
    if let Some(base_path) = &target.base_path {
        set_safe_path(&mut output, &["basePath"], Value::String(base_path.clone()), &format!("tcpTargets[{index}].basePath"))?;
    }
    if let Some(transport) = &target.transport {
        set_safe_path(&mut output, &["transport"], Value::String(transport.clone()), &format!("tcpTargets[{index}].transport"))?;
    }
    Ok(output)
}

fn extra_path_pattern(kind: &str) -> &'static Regex {
    static HTTP: OnceLock<Regex> = OnceLock::new();
    static TCP: OnceLock<Regex> = OnceLock::new();
    let cell = if kind == "http" { &HTTP } else { &TCP };
    cell.get_or_init(|| Regex::new(&format!(r"^{}\[(\d+)\]\.(.+)$", if kind == "http" { "httpRules" } else { "tcpTargets" })).expect("extra path pattern"))
}

fn extra_prefix_pattern(prefix: &str) -> &'static Regex {
    static SERVER: OnceLock<Regex> = OnceLock::new();
    static CACHE: OnceLock<Regex> = OnceLock::new();
    static CONIFG: OnceLock<Regex> = OnceLock::new();
    let (cell, source) = match prefix {
        "server" => (&SERVER, r"^server\.(.+)$"),
        "cache" => (&CACHE, r"^cache\.(.+)$"),
        _ => (&CONIFG, r"^conifg\.(.+)\.([^.]+)$"),
    };
    cell.get_or_init(|| Regex::new(source).expect("extra prefix pattern"))
}

fn add_legacy_extras(output: &mut Map<String, Value>, config: &AppConfig, conifg: &mut Map<String, Value>, canonical_http_indices: &HashSet<usize>) -> Result<()> {
    let mut canonical_http_extras: HashMap<usize, Map<String, Value>> = HashMap::new();
    let mut canonical_tcp_extras: HashMap<usize, Map<String, Value>> = HashMap::new();
    let Some(legacy) = config.legacy.as_ref() else { return Ok(()) };
    for (path_key, value) in &legacy.extra {
        let safe_value = copy_legacy_value(value, path_key, "config.js")?;
        if let Some(captures) = extra_prefix_pattern("server").captures(path_key) {
            if let Some(server) = output.get_mut("server").and_then(Value::as_object_mut) {
                let segments: Vec<&str> = captures[1].split('.').collect();
                set_safe_path(server, &segments, safe_value, path_key)?;
            }
            continue;
        }
        if let Some(captures) = extra_prefix_pattern("cache").captures(path_key) {
            if let Some(cache) = output.get_mut("cache").and_then(Value::as_object_mut) {
                let segments: Vec<&str> = captures[1].split('.').collect();
                set_safe_path(cache, &segments, safe_value, path_key)?;
            }
            continue;
        }
        if let Some(captures) = extra_prefix_pattern("conifg").captures(path_key) {
            if is_dangerous_key(&captures[1]) {
                return error("config.js", path_key, "dangerous path segment is not allowed");
            }
            if conifg.get(&captures[1]).is_some_and(Value::is_object) {
                let target = conifg.get_mut(&captures[1]).and_then(Value::as_object_mut).expect("checked");
                set_safe_path(target, &[&captures[2]], safe_value, path_key)?;
            }
            continue;
        }
        if let Some(captures) = extra_path_pattern("http").captures(path_key) {
            let index: usize = captures[1].parse().unwrap_or(0);
            let entry = canonical_http_extras.entry(index).or_default();
            set_safe_path(entry, &[&captures[2]], safe_value, path_key)?;
            continue;
        }
        if let Some(captures) = extra_path_pattern("tcp").captures(path_key) {
            let index: usize = captures[1].parse().unwrap_or(0);
            let entry = canonical_tcp_extras.entry(index).or_default();
            set_safe_path(entry, &[&captures[2]], safe_value, path_key)?;
            continue;
        }
        if !path_key.contains('.') {
            set_safe_path(output, &[path_key], safe_value, path_key)?;
        }
    }
    if !canonical_http_indices.is_empty() {
        let mut rules = Vec::new();
        for (index, rule) in config.http_rules.iter().enumerate() {
            if !canonical_http_indices.contains(&index) {
                continue;
            }
            let mut entry = export_http_rule(rule, index)?;
            if let Some(extras) = canonical_http_extras.get(&index) {
                for (key, value) in extras {
                    set_safe_path(&mut entry, &[key], value.clone(), &format!("httpRules[{index}].{key}"))?;
                }
            }
            rules.push(Value::Object(entry));
        }
        set_safe_path(output, &["HTTPRULES"], Value::Array(rules), "HTTPRULES")?;
    }
    if !canonical_tcp_extras.is_empty() {
        let mut targets = Vec::new();
        for (index, target) in config.tcp_targets.iter().enumerate() {
            let mut entry = export_tcp_target(target, index)?;
            if let Some(extras) = canonical_tcp_extras.get(&index) {
                for (key, value) in extras {
                    set_safe_path(&mut entry, &[key], value.clone(), &format!("tcpTargets[{index}].{key}"))?;
                }
            }
            targets.push(Value::Object(entry));
        }
        set_safe_path(output, &["tcpTargets"], Value::Array(targets), "tcpTargets")?;
    }
    Ok(())
}

pub fn legacy_export_object(config: &AppConfig) -> Result<Value> {
    let mut conifg = Map::new();
    let reqxml_targets: Vec<String> = config
        .tcp_targets
        .iter()
        .map(|target| format!("{}://{}:{}{}", target.protocol.as_deref().unwrap_or("http"), format_tcp_host(&target.host), target.port, target.base_path.as_deref().unwrap_or("")))
        .collect();
    if !reqxml_targets.is_empty() {
        let mut reqxml = Map::new();
        let target_value = if reqxml_targets.len() == 1 { Value::String(reqxml_targets[0].clone()) } else { Value::Array(reqxml_targets.into_iter().map(Value::String).collect()) };
        set_safe_path(&mut reqxml, &["target"], target_value, "conifg./reqxml.target")?;
        if config.tcp_targets.iter().any(|target| target.transport.as_deref() == Some("http")) {
            set_safe_path(&mut reqxml, &["useHttp"], Value::Bool(true), "conifg./reqxml.useHttp")?;
        }
        set_safe_path(&mut conifg, &["/reqxml"], Value::Object(reqxml), "conifg./reqxml")?;
    }
    let mut canonical_http_indices: HashSet<usize> = HashSet::new();
    if let Some(legacy) = config.legacy.as_ref() {
        for path_key in legacy.extra.keys() {
            if let Some(captures) = extra_path_pattern("http").captures(path_key) {
                canonical_http_indices.insert(captures[1].parse().unwrap_or(0));
            }
        }
    }
    for (index, rule) in config.http_rules.iter().enumerate() {
        if rule.match_.to_lowercase() == "/reqxml" {
            canonical_http_indices.insert(index);
        }
    }
    let mut output = Map::new();
    if let Some(project_path) = &config.project_path {
        set_safe_path(&mut output, &["path"], Value::String(project_path.clone()), "path")?;
    }
    for (index, rule) in config.http_rules.iter().enumerate() {
        if canonical_http_indices.contains(&index) {
            continue;
        }
        let field = format!("conifg.{}[{index}]", rule.match_);
        let mut entry = Map::new();
        set_safe_path(&mut entry, &["target"], Value::String(rule.target.clone()), &field)?;
        if let Some(rewrite) = &rule.rewrite {
            set_safe_path(&mut entry, &["rewrite"], Value::String(rewrite.clone()), &field)?;
        }
        set_safe_path(&mut entry, &["id"], Value::String(rule.id.clone()), &field)?;
        set_safe_path(&mut entry, &["name"], Value::String(rule.name.clone()), &field)?;
        set_safe_path(&mut entry, &["enabled"], Value::Bool(rule.enabled), &field)?;
        set_safe_path(&mut conifg, &[&rule.match_], Value::Object(entry), &field)?;
    }
    if !canonical_http_indices.is_empty() {
        let mut rules = Vec::new();
        for (index, rule) in config.http_rules.iter().enumerate() {
            if canonical_http_indices.contains(&index) {
                rules.push(Value::Object(export_http_rule(rule, index)?));
            }
        }
        set_safe_path(&mut output, &["HTTPRULES"], Value::Array(rules), "HTTPRULES")?;
    }
    set_safe_path(&mut output, &["server"], copy_legacy_value(&serde_json::to_value(&config.server).map_err(|error| ParseError { filename: "config.js".to_string(), field: "server".to_string(), message: error.to_string() })?, "server", "config.js")?, "server")?;
    set_safe_path(&mut output, &["local"], copy_legacy_value(&serde_json::to_value(&config.local_values).expect("map serializes"), "local", "config.js")?, "local")?;
    set_safe_path(&mut output, &["map"], copy_legacy_value(&serde_json::to_value(&config.map_values).expect("map serializes"), "map", "config.js")?, "map")?;
    set_safe_path(&mut output, &["account"], copy_legacy_value(&serde_json::to_value(&config.accounts).expect("accounts serialize"), "account", "config.js")?, "account")?;
    set_safe_path(&mut output, &["conifg"], Value::Object(conifg.clone()), "conifg")?;
    let targets: Vec<Value> = config.tcp_targets.iter().enumerate().map(|(index, target)| export_tcp_target(target, index).map(Value::Object)).collect::<Result<Vec<_>>>()?;
    set_safe_path(&mut output, &["tcpTargets"], Value::Array(targets), "tcpTargets")?;
    set_safe_path(&mut output, &["cache"], copy_legacy_value(&serde_json::to_value(&config.cache).expect("cache serializes"), "cache", "config.js")?, "cache")?;
    add_legacy_extras(&mut output, config, &mut conifg, &canonical_http_indices)?;
    Ok(Value::Object(output))
}

fn write_ini(values: &HashMap<String, String>) -> String {
    let mut lines: Vec<String> = values.iter().map(|(key, value)| format!("{}={}", key.to_uppercase(), value)).collect();
    lines.sort();
    lines.join("\n") + "\n"
}

pub async fn export_legacy_config(config: &AppConfig, directory: &Path) -> Result<()> {
    let value = serde_json::to_value(config).expect("config serializes");
    if let Some(field) = crate::validation::get_app_config_validation_error(&value) {
        return error("config.js", &field, "invalid internal configuration");
    }
    let normalized = if config.legacy.is_some() { config.clone() } else { AppConfig { legacy: Some(Default::default()), ..config.clone() } };
    let object = legacy_export_object(&normalized)?;
    let legacy_json = normalized.legacy.as_ref().and_then(|legacy| legacy.files.get("config.json")).cloned().unwrap_or_else(|| {
        serde_json::to_value(Map::from_iter([("cache".to_string(), serde_json::to_value(&normalized.cache).expect("cache serializes"))])).expect("object serializes")
    });
    if let Ok(meta) = tokio::fs::symlink_metadata(directory).await {
        if !meta.is_dir() || meta.file_type().is_symlink() {
            return error("directory", "path", "export directory must be a real directory");
        }
    } else {
        tokio::fs::create_dir_all(directory).await.map_err(|error| ParseError { filename: "directory".to_string(), field: "path".to_string(), message: format!("could not inspect export directory: {error}") })?;
    }
    for filename in ["config.js", "config.json", "sysconfig.ini"] {
        if let Ok(meta) = tokio::fs::symlink_metadata(directory.join(filename)).await {
            if !meta.is_file() || meta.file_type().is_symlink() {
                return error(filename, "file", "export target must be a regular file and cannot be a symlink");
            }
        }
    }
    crate::atomic_write(&directory.join("config.js"), format!("module.exports = {};\n", serde_json::to_string_pretty(&object).expect("object serializes")).as_bytes())
        .await
        .map_err(|error| ParseError { filename: "config.js".to_string(), field: "file".to_string(), message: format!("could not write legacy file: {error}") })?;
    crate::atomic_write(&directory.join("config.json"), format!("{}\n", serde_json::to_string_pretty(&legacy_json).expect("json serializes")).as_bytes())
        .await
        .map_err(|error| ParseError { filename: "config.json".to_string(), field: "file".to_string(), message: format!("could not write legacy file: {error}") })?;
    crate::atomic_write(&directory.join("sysconfig.ini"), write_ini(&normalized.local_values).as_bytes())
        .await
        .map_err(|error| ParseError { filename: "sysconfig.ini".to_string(), field: "file".to_string(), message: format!("could not write legacy file: {error}") })?;
    Ok(())
}
