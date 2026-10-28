use serde::Deserialize;
use serde::Serialize;
use serde_json::{Map, Value};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ForwardRule {
    pub id: String,
    pub name: String,
    #[serde(rename = "match")]
    pub match_: String,
    pub target: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rewrite: Option<String>,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TcpTargetConfig {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub protocol: Option<String>,
    #[serde(rename = "basePath")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transport: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CacheConfig {
    #[serde(rename = "rootDir")]
    pub root_dir: String,
    #[serde(rename = "downloadTarget")]
    pub download_target: String,
    #[serde(rename = "decryptEnabled")]
    pub decrypt_enabled: bool,
    #[serde(rename = "autoDownload")]
    pub auto_download: bool,
}

pub type Accounts = HashMap<String, HashMap<String, String>>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerConfig {
    #[serde(rename = "bindHost")]
    pub bind_host: String,
    pub port: u16,
    #[serde(rename = "timeoutMs")]
    pub timeout_ms: u64,
    #[serde(rename = "loggingEnabled")]
    pub logging_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManualRequestConfig {
    pub host: String,
    pub port: u16,
    #[serde(rename = "paramsText")]
    pub params_text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transport: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StringToolConfig {
    #[serde(rename = "inputText")]
    pub input_text: String,
    #[serde(rename = "outputText")]
    pub output_text: String,
    pub operation: String,
    #[serde(rename = "findText")]
    pub find_text: String,
    #[serde(rename = "replaceText")]
    pub replace_text: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct LegacyData {
    pub files: Map<String, Value>,
    pub extra: Map<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub server: ServerConfig,
    #[serde(rename = "httpRules")]
    pub http_rules: Vec<ForwardRule>,
    #[serde(rename = "tcpTargets")]
    pub tcp_targets: Vec<TcpTargetConfig>,
    #[serde(rename = "localValues")]
    pub local_values: HashMap<String, String>,
    #[serde(rename = "mapValues")]
    pub map_values: HashMap<String, String>,
    pub accounts: Accounts,
    pub cache: CacheConfig,
    #[serde(rename = "projectPath")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_path: Option<String>,
    #[serde(rename = "localText")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub local_text: Option<String>,
    #[serde(rename = "launchPath")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub launch_path: Option<String>,
    #[serde(rename = "cardTargetId")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub card_target_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request: Option<ManualRequestConfig>,
    #[serde(rename = "stringTool")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub string_tool: Option<StringToolConfig>,
    #[serde(rename = "forwardingAddressHistory")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub forwarding_address_history: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub legacy: Option<LegacyData>,
}

pub fn create_default_config() -> AppConfig {
    AppConfig {
        server: ServerConfig { bind_host: "127.0.0.1".to_string(), port: 8080, timeout_ms: 30_000, logging_enabled: true },
        http_rules: vec![],
        tcp_targets: vec![
            TcpTargetConfig { id: "hq".to_string(), name: "hq".to_string(), host: "123.60.102.92".to_string(), port: 7778, protocol: None, base_path: None, transport: None },
            TcpTargetConfig { id: "jy".to_string(), name: "jy".to_string(), host: "123.103.83.98".to_string(), port: 17772, protocol: None, base_path: None, transport: None },
            TcpTargetConfig { id: "zx".to_string(), name: "zx".to_string(), host: "123.103.83.98".to_string(), port: 17772, protocol: None, base_path: None, transport: None },
        ],
        local_values: HashMap::new(),
        map_values: HashMap::new(),
        accounts: HashMap::new(),
        cache: CacheConfig { root_dir: String::new(), download_target: String::new(), decrypt_enabled: false, auto_download: false },
        project_path: None,
        local_text: None,
        launch_path: None,
        card_target_id: None,
        request: Some(ManualRequestConfig { host: "127.0.0.1".to_string(), port: 8080, params_text: String::new(), transport: None }),
        string_tool: Some(StringToolConfig {
            input_text: String::new(),
            output_text: String::new(),
            operation: "replace".to_string(),
            find_text: String::new(),
            replace_text: String::new(),
        }),
        forwarding_address_history: Some(serde_json::json!({ "hq": [], "jy": [], "zx": [] })),
        legacy: Some(LegacyData::default()),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyInstance {
    pub id: String,
    pub name: String,
    pub config: AppConfig,
    #[serde(rename = "loginCache")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub login_cache: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyWorkspace {
    pub version: u32,
    #[serde(rename = "selectedInstanceId")]
    pub selected_instance_id: String,
    #[serde(rename = "sharedValues")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shared_values: Option<HashMap<String, String>>,
    pub instances: Vec<ProxyInstance>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RuntimeStatus {
    pub state: String,
    #[serde(rename = "requestCount")]
    pub request_count: u64,
    #[serde(rename = "tcpConnections")]
    pub tcp_connections: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LogEntry {
    pub timestamp: String,
    pub level: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub direction: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub protocol: Option<String>,
    #[serde(rename = "ruleId")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rule_id: Option<String>,
    #[serde(rename = "statusCode")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status_code: Option<u16>,
    #[serde(rename = "durationMs")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
    #[serde(rename = "requestType")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_type: Option<String>,
    #[serde(rename = "requestPath")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_path: Option<String>,
    #[serde(rename = "requestParams")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_params: Option<String>,
    #[serde(rename = "responseData")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub response_data: Option<String>,
}

impl LogEntry {
    pub fn new(level: &str, message: impl Into<String>) -> Self {
        Self {
            timestamp: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            level: level.to_string(),
            message: message.into(),
            direction: None,
            protocol: None,
            rule_id: None,
            status_code: None,
            duration_ms: None,
            request_type: None,
            request_path: None,
            request_params: None,
            response_data: None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ProxyInstanceSummary {
    pub id: String,
    pub name: String,
    pub selected: bool,
    #[serde(rename = "bindHost")]
    pub bind_host: String,
    pub port: u16,
    pub target: String,
    #[serde(rename = "cardTarget")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub card_target: Option<String>,
    #[serde(rename = "loginCacheCount")]
    pub login_cache_count: usize,
    pub status: RuntimeStatus,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct EncryptionPreferences {
    #[serde(rename = "inputDir")]
    pub input_dir: String,
    #[serde(rename = "outputDir")]
    pub output_dir: String,
    #[serde(rename = "inputHistory")]
    pub input_history: Vec<String>,
    #[serde(rename = "outputHistory")]
    pub output_history: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncryptionPreferencesPatch {
    #[serde(rename = "inputDir")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input_dir: Option<String>,
    #[serde(rename = "outputDir")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct EncryptionProgress {
    pub mode: String,
    pub phase: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    pub current: usize,
    pub total: usize,
    #[serde(rename = "processedFiles")]
    pub processed_files: usize,
    #[serde(rename = "skippedFiles")]
    pub skipped_files: usize,
    #[serde(rename = "removedFiles")]
    pub removed_files: usize,
    #[serde(rename = "relativePath")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub relative_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredValues {
    #[serde(rename = "mapValues")]
    pub map_values: HashMap<String, String>,
    #[serde(rename = "fileValues")]
    pub file_values: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ValuesSnapshot {
    #[serde(rename = "localValues")]
    pub local_values: HashMap<String, String>,
    #[serde(rename = "mapValues")]
    pub map_values: HashMap<String, String>,
    #[serde(rename = "fileValues")]
    pub file_values: HashMap<String, String>,
}
