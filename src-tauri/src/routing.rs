use crate::config::ForwardRule;
use regex::Regex;
use std::collections::HashMap;
use std::sync::OnceLock;

pub fn match_rule<'a>(url: &str, rules: &'a [ForwardRule]) -> Option<&'a ForwardRule> {
    let mut matched: Vec<&ForwardRule> = rules.iter().filter(|rule| rule.enabled && url.contains(&rule.match_)).collect();
    matched.sort_by(|left, right| right.match_.len().cmp(&left.match_.len()).then_with(|| left.id.cmp(&right.id)));
    matched.first().copied()
}

fn variable_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        Regex::new(r"\$\(([A-Za-z0-9_]+)\)|\(\$([A-Za-z0-9_]+)\)|\(%24([A-Za-z0-9_]+)\)|%28\$([A-Za-z0-9_]+)%29|%28%24([A-Za-z0-9_]+)%29")
            .expect("variable pattern is valid")
    })
}

pub fn substitute_variables(input: &str, local_values: &HashMap<String, String>) -> String {
    let mut values: HashMap<String, &str> = HashMap::new();
    for (key, value) in local_values {
        values.entry(key.to_lowercase()).or_insert(value);
    }
    variable_pattern()
        .replace_all(input, |captures: &regex::Captures| {
            let key = (1..=5).find_map(|index| captures.get(index));
            match key {
                Some(group) => values.get(group.as_str().to_lowercase().as_str()).map(|value| value.to_string()).unwrap_or_else(|| captures.get(0).expect("full match").as_str().to_string()),
                None => captures.get(0).expect("full match").as_str().to_string(),
            }
        })
        .into_owned()
}

fn substitute_request_url_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| Regex::new(r"(?i)\$\(url\)|\(\$url\)|%28\$url%29|%28%24url%29").expect("url pattern is valid"))
}

pub fn substitute_request_url(input: &str, request_url: &str) -> String {
    substitute_request_url_pattern().replace_all(input, request_url).into_owned()
}

#[derive(Debug, Clone, PartialEq)]
pub struct ParsedTarget {
    pub protocol: String,
    pub hostname: String,
    pub port: u16,
    pub pathname: String,
    pub search: String,
}

fn scheme_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| Regex::new(r"^([A-Za-z][A-Za-z0-9+.-]*):").expect("scheme pattern is valid"))
}

fn explicit_port(target: &str, protocol: &str) -> Option<String> {
    let remainder = &target[protocol.len() + 1..];
    if !remainder.starts_with("//") {
        return None;
    }
    let authority = remainder[2..].split(['/', '?', '#']).next().unwrap_or("");
    let host = &authority[authority.rfind('@').map_or(0, |index| index + 1)..];
    if host.starts_with('[') {
        let closing = host.find(']')?;
        return host[closing + 1..].strip_prefix(':').map(str::to_string);
    }
    host.rfind(':').map(|colon| host[colon + 1..].to_string())
}

pub fn parse_target(target: &str) -> Result<ParsedTarget, String> {
    let scheme = scheme_pattern().captures(target).ok_or_else(|| format!("Invalid target: missing protocol in {target}"))?;
    let raw_protocol = scheme.get(1).expect("scheme group").as_str();
    let protocol = raw_protocol.to_lowercase();
    if protocol != "http" && protocol != "https" && protocol != "tcp" {
        return Err(format!("Unsupported protocol: {protocol}"));
    }
    let authority_remainder = &target[scheme.get(0).expect("scheme match").as_str().len()..];
    if !authority_remainder.starts_with("//") {
        return Err(format!("Invalid target: authority is required in {target}"));
    }
    if authority_remainder.starts_with("///") {
        return Err(format!("Invalid target: host is required in {target}"));
    }
    if let Some(raw_port) = explicit_port(target, raw_protocol) {
        if !raw_port.bytes().all(|byte| byte.is_ascii_digit()) {
            return Err(format!("Invalid port in target: {target}"));
        }
        match raw_port.parse::<u16>() {
            Ok(port) if port >= 1 => {}
            _ => return Err(format!("Invalid port in target: {target}")),
        }
    }
    let parsed = url::Url::parse(target).map_err(|error| format!("Invalid target URL: {target}: {error}"))?;
    let hostname = parsed.host_str().unwrap_or("").to_string();
    if hostname.is_empty() {
        return Err(format!("Invalid target: host is required in {target}"));
    }
    let default_port = match protocol.as_str() {
        "https" => 443,
        _ => 80,
    };
    let port = match parsed.port() {
        Some(port) => port,
        None => default_port,
    };
    Ok(ParsedTarget {
        protocol,
        hostname,
        port,
        pathname: parsed.path().to_string(),
        search: parsed.query().map(|query| format!("?{query}")).unwrap_or_default(),
    })
}
