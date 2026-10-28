use serde_json::{Map, Value};
use std::collections::HashSet;

fn has_only_keys(value: &Map<String, Value>, required: &[&str], optional: &[&str]) -> bool {
    let allowed: HashSet<&str> = required.iter().chain(optional.iter()).copied().collect();
    required.iter().all(|key| value.contains_key(*key)) && value.keys().all(|key| allowed.contains(key.as_str()))
}

fn is_integer_in_range(value: &Value, min: i64, max: i64) -> bool {
    match value {
        Value::Number(number) => number
            .as_i64()
            .or_else(|| number.as_u64().and_then(|v| i64::try_from(v).ok()))
            .is_some_and(|n| n >= min && n <= max),
        _ => false,
    }
}

fn is_non_empty_string(value: &Value) -> bool {
    value.as_str().is_some_and(|text| !text.is_empty())
}

pub fn get_manual_request_config_validation_error(value: &Value) -> Option<String> {
    let Some(object) = value.as_object() else { return Some("request".to_string()) };
    if !has_only_keys(object, &["host", "port", "paramsText"], &["transport"]) {
        return Some("request".to_string());
    }
    if !object.get("host").and_then(Value::as_str).is_some_and(|host| !host.trim().is_empty()) {
        return Some("request.host".to_string());
    }
    if !is_integer_in_range(object.get("port").unwrap_or(&Value::Null), 1, 65535) {
        return Some("request.port".to_string());
    }
    if !object.get("paramsText").is_some_and(Value::is_string) {
        return Some("request.paramsText".to_string());
    }
    if let Some(transport) = object.get("transport") {
        if transport.as_str() != Some("tzt") && transport.as_str() != Some("http") {
            return Some("request.transport".to_string());
        }
    }
    None
}

fn get_string_tool_config_validation_error(value: &Value) -> Option<String> {
    let Some(object) = value.as_object() else { return Some("stringTool".to_string()) };
    if !has_only_keys(object, &["inputText", "outputText", "operation", "findText", "replaceText"], &[]) {
        return Some("stringTool".to_string());
    }
    for field in ["inputText", "outputText", "findText", "replaceText"] {
        if !object.get(field).is_some_and(Value::is_string) {
            return Some(format!("stringTool.{field}"));
        }
    }
    let operation = object.get("operation").and_then(Value::as_str).unwrap_or("");
    if !["replace", "remove", "uppercase", "lowercase", "url-encode", "url-decode", "json-format"].contains(&operation) {
        return Some("stringTool.operation".to_string());
    }
    None
}

fn invalid_http_target_field(target: &str, field: &str) -> Option<String> {
    if target.is_empty() {
        return Some(field.to_string());
    }
    if !target.to_lowercase().starts_with("http://") && !target.to_lowercase().starts_with("https://") {
        return None;
    }
    if url::Url::parse(target).is_err() {
        return Some(format!("{field}.port"));
    }
    let authority = target.split("://").nth(1)?.split(['/', '?', '#']).next()?;
    let host_port = &authority[authority.rfind('@').map_or(0, |index| index + 1)..];
    let explicit_port: Option<&str> = if host_port.starts_with('[') {
        match host_port.find(']') {
            Some(closing) if host_port.as_bytes().get(closing + 1) == Some(&b':') => Some(&host_port[closing + 2..]),
            _ => None,
        }
    } else {
        host_port.rfind(':').map(|colon| &host_port[colon + 1..])
    };
    if let Some(port_text) = explicit_port {
        if !port_text.bytes().all(|byte| byte.is_ascii_digit()) || port_text.parse::<u32>().is_ok_and(|port| !(1..=65535).contains(&port)) || port_text.parse::<u32>().is_err() {
            return Some(format!("{field}.port"));
        }
    }
    None
}

pub fn get_app_config_validation_error(value: &Value) -> Option<String> {
    let Some(object) = value.as_object() else { return Some("root".to_string()) };
    if !has_only_keys(
        object,
        &["server", "httpRules", "tcpTargets", "localValues", "mapValues", "accounts", "cache"],
        &["legacy", "projectPath", "localText", "launchPath", "cardTargetId", "request", "stringTool", "forwardingAddressHistory", "requestHistory"],
    ) {
        return Some("root".to_string());
    }

    let server = object.get("server").and_then(Value::as_object);
    let Some(server) = server else { return Some("server".to_string()) };
    if !has_only_keys(server, &["bindHost", "port", "timeoutMs", "loggingEnabled"], &[]) {
        return Some("server".to_string());
    }
    if !is_non_empty_string(server.get("bindHost").unwrap_or(&Value::Null)) {
        return Some("server.bindHost".to_string());
    }
    if !is_integer_in_range(server.get("port").unwrap_or(&Value::Null), 1, 65535) {
        return Some("server.port".to_string());
    }
    if !is_integer_in_range(server.get("timeoutMs").unwrap_or(&Value::Null), 0, i64::MAX) {
        return Some("server.timeoutMs".to_string());
    }
    if !server.get("loggingEnabled").is_some_and(Value::is_boolean) {
        return Some("server.loggingEnabled".to_string());
    }

    let Some(rules) = object.get("httpRules").and_then(Value::as_array) else { return Some("httpRules".to_string()) };
    let mut matches = HashSet::new();
    for (index, rule) in rules.iter().enumerate() {
        let prefix = format!("httpRules[{index}]");
        let Some(rule) = rule.as_object() else { return Some(prefix) };
        if !has_only_keys(rule, &["id", "name", "match", "target", "enabled"], &["rewrite"]) {
            return Some(prefix);
        }
        if !is_non_empty_string(rule.get("id").unwrap_or(&Value::Null)) {
            return Some(format!("{prefix}.id"));
        }
        if !is_non_empty_string(rule.get("name").unwrap_or(&Value::Null)) {
            return Some(format!("{prefix}.name"));
        }
        let match_value = rule.get("match").and_then(Value::as_str).unwrap_or("");
        if match_value.is_empty() {
            return Some(format!("{prefix}.match"));
        }
        if !matches.insert(match_value.to_string()) {
            return Some(format!("{prefix}.match"));
        }
        let Some(target) = rule.get("target").and_then(Value::as_str) else {
            return Some(format!("{prefix}.target"));
        };
        if let Some(error) = invalid_http_target_field(target, &format!("{prefix}.target")) {
            return Some(error);
        }
        if let Some(rewrite) = rule.get("rewrite") {
            if !rewrite.is_string() {
                return Some(format!("{prefix}.rewrite"));
            }
        }
        if !rule.get("enabled").is_some_and(Value::is_boolean) {
            return Some(format!("{prefix}.enabled"));
        }
    }

    let Some(targets) = object.get("tcpTargets").and_then(Value::as_array) else { return Some("tcpTargets".to_string()) };
    for (index, target) in targets.iter().enumerate() {
        let prefix = format!("tcpTargets[{index}]");
        let Some(target) = target.as_object() else { return Some(prefix) };
        if !has_only_keys(target, &["id", "name", "host", "port"], &["protocol", "basePath", "transport", "enabled"]) {
            return Some(prefix);
        }
        if !is_non_empty_string(target.get("id").unwrap_or(&Value::Null)) {
            return Some(format!("{prefix}.id"));
        }
        if !is_non_empty_string(target.get("name").unwrap_or(&Value::Null)) {
            return Some(format!("{prefix}.name"));
        }
        if !is_non_empty_string(target.get("host").unwrap_or(&Value::Null)) {
            return Some(format!("{prefix}.host"));
        }
        if !is_integer_in_range(target.get("port").unwrap_or(&Value::Null), 1, 65535) {
            return Some(format!("{prefix}.port"));
        }
        if let Some(protocol) = target.get("protocol") {
            if protocol.as_str() != Some("http") && protocol.as_str() != Some("https") {
                return Some(format!("{prefix}.protocol"));
            }
        }
        if let Some(base_path) = target.get("basePath") {
            if !base_path.as_str().is_some_and(|path| path.starts_with('/')) {
                return Some(format!("{prefix}.basePath"));
            }
        }
        if let Some(transport) = target.get("transport") {
            if transport.as_str() != Some("tcp") && transport.as_str() != Some("http") {
                return Some(format!("{prefix}.transport"));
            }
        }
        if let Some(enabled) = target.get("enabled") {
            if !enabled.is_boolean() {
                return Some(format!("{prefix}.enabled"));
            }
        }
    }

    if let Some(history) = object.get("forwardingAddressHistory") {
        if let Some(list) = history.as_array() {
            if list.len() > 10 {
                return Some("forwardingAddressHistory".to_string());
            }
            for (index, address) in list.iter().enumerate() {
                if !address.as_str().is_some_and(|text| !text.trim().is_empty()) {
                    return Some(format!("forwardingAddressHistory[{index}]"));
                }
            }
        } else if let Some(record) = history.as_object() {
            if !has_only_keys(record, &["hq", "jy", "zx"], &[]) {
                return Some("forwardingAddressHistory".to_string());
            }
            for key in ["hq", "jy", "zx"] {
                let Some(addresses) = record.get(key).and_then(Value::as_array) else {
                    return Some(format!("forwardingAddressHistory.{key}"));
                };
                if addresses.len() > 10 {
                    return Some(format!("forwardingAddressHistory.{key}"));
                }
                for (index, address) in addresses.iter().enumerate() {
                    if !address.as_str().is_some_and(|text| !text.trim().is_empty()) {
                        return Some(format!("forwardingAddressHistory.{key}[{index}]"));
                    }
                }
            }
        } else {
            return Some("forwardingAddressHistory".to_string());
        }
    }

    if let Some(history) = object.get("requestHistory") {
        let Some(list) = history.as_array() else { return Some("requestHistory".to_string()) };
        if list.len() > 10 {
            return Some("requestHistory".to_string());
        }
        for (index, address) in list.iter().enumerate() {
            if !address.as_str().is_some_and(|text| !text.trim().is_empty()) {
                return Some(format!("requestHistory[{index}]"));
            }
        }
    }

    for field in ["projectPath", "localText", "launchPath", "cardTargetId"] {
        if let Some(value) = object.get(field) {
            if !value.is_string() {
                return Some(field.to_string());
            }
        }
    }
    if let Some(request) = object.get("request") {
        if let Some(field) = get_manual_request_config_validation_error(request) {
            return Some(field);
        }
    }
    if let Some(string_tool) = object.get("stringTool") {
        if let Some(field) = get_string_tool_config_validation_error(string_tool) {
            return Some(field);
        }
    }

    for field in ["localValues", "mapValues"] {
        let Some(record) = object.get(field).and_then(Value::as_object) else { return Some(field.to_string()) };
        for (key, entry) in record {
            if !entry.is_string() {
                return Some(format!("{field}.{key}"));
            }
        }
    }
    let Some(accounts) = object.get("accounts").and_then(Value::as_object) else { return Some("accounts".to_string()) };
    for (account, fields) in accounts {
        let Some(fields) = fields.as_object() else { return Some(format!("accounts.{account}")) };
        for (key, entry) in fields {
            if !entry.is_string() {
                return Some(format!("accounts.{account}.{key}"));
            }
        }
    }

    let Some(cache) = object.get("cache").and_then(Value::as_object) else { return Some("cache".to_string()) };
    if !has_only_keys(cache, &["rootDir", "downloadTarget", "decryptEnabled", "autoDownload"], &[]) {
        return Some("cache".to_string());
    }
    if !cache.get("rootDir").is_some_and(Value::is_string) {
        return Some("cache.rootDir".to_string());
    }
    if !cache.get("downloadTarget").is_some_and(Value::is_string) {
        return Some("cache.downloadTarget".to_string());
    }
    if !cache.get("decryptEnabled").is_some_and(Value::is_boolean) {
        return Some("cache.decryptEnabled".to_string());
    }
    if !cache.get("autoDownload").is_some_and(Value::is_boolean) {
        return Some("cache.autoDownload".to_string());
    }
    if let Some(legacy) = object.get("legacy") {
        let valid = legacy
            .as_object()
            .is_some_and(|legacy| has_only_keys(legacy, &["files", "extra"], &[]) && legacy.get("files").is_some_and(Value::is_object) && legacy.get("extra").is_some_and(Value::is_object));
        if !valid {
            return Some("legacy".to_string());
        }
    }
    None
}

pub fn is_valid_app_config(value: &Value) -> bool {
    get_app_config_validation_error(value).is_none()
}

pub fn is_valid_tcp_target_list(value: &Value) -> bool {
    let Some(targets) = value.as_array() else { return false };
    targets.iter().all(|target| {
        let Some(target) = target.as_object() else { return false };
        if !is_non_empty_string(target.get("id").unwrap_or(&Value::Null)) {
            return false;
        }
        if target.get("name").is_none_or(|name| !name.is_string()) {
            return false;
        }
        if !is_non_empty_string(target.get("host").unwrap_or(&Value::Null)) {
            return false;
        }
        if !is_integer_in_range(target.get("port").unwrap_or(&Value::Null), 1, 65535) {
            return false;
        }
        if let Some(protocol) = target.get("protocol") {
            if protocol.as_str() != Some("http") && protocol.as_str() != Some("https") {
                return false;
            }
        }
        if let Some(transport) = target.get("transport") {
            if transport.as_str() != Some("tcp") && transport.as_str() != Some("http") {
                return false;
            }
        }
        if let Some(base_path) = target.get("basePath") {
            if !base_path.is_string() {
                return false;
            }
        }
        true
    })
}

pub fn is_valid_proxy_workspace(value: &Value) -> bool {
    let Some(workspace) = value.as_object() else { return false };
    if !has_only_keys(workspace, &["version", "selectedInstanceId", "instances"], &["sharedValues"]) {
        return false;
    }
    if workspace.get("version") != Some(&Value::from(1)) {
        return false;
    }
    let Some(selected_id) = workspace.get("selectedInstanceId").and_then(Value::as_str) else { return false };
    let Some(instances) = workspace.get("instances").and_then(Value::as_array) else { return false };
    if instances.is_empty() {
        return false;
    }
    if let Some(shared) = workspace.get("sharedValues") {
        let Some(shared) = shared.as_object() else { return false };
        if shared.values().any(|entry| !entry.is_string()) {
            return false;
        }
    }
    let mut ids = HashSet::new();
    for instance in instances {
        let Some(instance) = instance.as_object() else { return false };
        if !has_only_keys(instance, &["id", "name", "config"], &["loginCache"]) {
            return false;
        }
        let Some(id) = instance.get("id").and_then(Value::as_str) else { return false };
        if id.is_empty() || !ids.insert(id.to_string()) {
            return false;
        }
        if !instance.get("name").and_then(Value::as_str).is_some_and(|name| !name.trim().is_empty()) {
            return false;
        }
        let Some(config) = instance.get("config") else { return false };
        if !is_valid_app_config(config) {
            return false;
        }
        if let Some(login_cache) = instance.get("loginCache") {
            let Some(login_cache) = login_cache.as_object() else { return false };
            if login_cache.values().any(|entry| !entry.is_string()) {
                return false;
            }
        }
    }
    ids.contains(selected_id)
}
