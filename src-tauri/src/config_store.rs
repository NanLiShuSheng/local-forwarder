use crate::config::{create_default_config, AppConfig};
use crate::validation::get_app_config_validation_error;
use std::path::PathBuf;

const MAX_INPUT_BYTES: usize = 1_048_576;
const MAX_OUTPUT_BYTES: usize = 1_000_000;

#[derive(Debug)]
pub struct StoreError {
    pub filename: String,
    pub field: String,
    pub message: String,
}

impl std::fmt::Display for StoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}: {}", self.filename, self.field, self.message)
    }
}

impl std::error::Error for StoreError {}

fn store_error(filename: &str, field: &str, message: impl Into<String>) -> StoreError {
    StoreError { filename: filename.to_string(), field: field.to_string(), message: message.into() }
}

pub fn parse_internal_json(text: &str, filename: &str) -> Result<AppConfig, StoreError> {
    if text.len() > MAX_INPUT_BYTES {
        return Err(store_error(filename, "file", "input is too large"));
    }
    let parsed: serde_json::Value = serde_json::from_str(text).map_err(|error| store_error(filename, "root", format!("invalid JSON: {error}")))?;
    if let Some(field) = get_app_config_validation_error(&parsed) {
        return Err(store_error(filename, &field, "invalid internal configuration"));
    }
    let mut config: AppConfig = serde_json::from_value(parsed).map_err(|error| store_error(filename, "root", format!("invalid internal configuration: {error}")))?;
    if config.legacy.is_none() {
        config.legacy = create_default_config().legacy;
    }
    Ok(config)
}

pub fn export_internal_json(config: &AppConfig) -> Result<String, StoreError> {
    let value = serde_json::to_value(config).map_err(|error| store_error("internal.json", "root", error.to_string()))?;
    if let Some(field) = get_app_config_validation_error(&value) {
        return Err(store_error("internal.json", &field, "invalid internal configuration"));
    }
    let serialized = serde_json::to_string_pretty(&value).map_err(|_error| store_error("internal.json", "root", "could not serialize internal configuration"))?;
    if serialized.len() > MAX_OUTPUT_BYTES {
        return Err(store_error("internal.json", "legacy", "internal configuration exceeds maximum serialized size"));
    }
    Ok(format!("{serialized}\n"))
}

pub struct ConfigStore {
    file_path: PathBuf,
}

impl ConfigStore {
    pub fn new(file_path: impl Into<PathBuf>) -> Self {
        Self { file_path: file_path.into() }
    }

    pub async fn load(&self) -> Result<AppConfig, StoreError> {
        let filename = self.filename();
        let text = tokio::fs::read_to_string(&self.file_path)
            .await
            .map_err(|error| store_error(&filename, "file", format!("could not read internal config: {error}")))?;
        parse_internal_json(&text, &filename)
    }

    pub async fn save(&self, config: &AppConfig) -> Result<(), StoreError> {
        let filename = self.filename();
        let content = export_internal_json(config).map_err(|mut error| {
            error.filename = filename.clone();
            error
        })?;
        crate::atomic_write(&self.file_path, content.as_bytes())
            .await
            .map_err(|error| store_error(&filename, "file", format!("could not save internal config: {error}")))
    }

    fn filename(&self) -> String {
        self.file_path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_else(|| "internal.json".to_string())
    }
}
