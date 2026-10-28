use serde::Deserialize;
use std::collections::HashMap;

#[derive(Debug, Clone, Deserialize)]
pub struct ForwardRule {
    pub id: String,
    pub name: String,
    #[serde(rename = "match")]
    pub match_: String,
    pub target: String,
    pub rewrite: Option<String>,
    pub enabled: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TcpTargetConfig {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub protocol: Option<String>,
    #[serde(rename = "basePath")]
    pub base_path: Option<String>,
    pub transport: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
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
