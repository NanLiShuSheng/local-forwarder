use crate::config::{AppConfig, ProxyInstance, ProxyWorkspace};
use crate::local_cache::parse_local_cache_text;
use crate::validation::is_valid_proxy_workspace;
use std::collections::HashMap;
use std::path::PathBuf;

#[derive(Debug)]
pub struct WorkspaceError(pub String);

impl std::fmt::Display for WorkspaceError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl std::error::Error for WorkspaceError {}

type Result<T> = std::result::Result<T, WorkspaceError>;

pub fn create_default_workspace(config: &AppConfig) -> ProxyWorkspace {
    let instance = ProxyInstance {
        id: "default".to_string(),
        name: "默认代理".to_string(),
        config: AppConfig { local_values: Default::default(), ..config.clone() },
        login_cache: Some(config.local_values.clone()),
    };
    let shared_values = parse_local_cache_text(config.local_text.as_deref().unwrap_or("")).unwrap_or_default();
    ProxyWorkspace { version: 1, selected_instance_id: instance.id.clone(), shared_values: Some(shared_values), instances: vec![instance] }
}

fn migrate_workspace(mut workspace: ProxyWorkspace) -> ProxyWorkspace {
    let shared = workspace.shared_values.get_or_insert_with(HashMap::new);
    if shared.is_empty() {
        for instance in &workspace.instances {
            if let Some(text) = instance.config.local_text.as_deref() {
                if let Ok(values) = parse_local_cache_text(text) {
                    shared.extend(values);
                }
            }
        }
    }
    for instance in &mut workspace.instances {
        let legacy_values = instance.login_cache.clone().unwrap_or_else(|| instance.config.local_values.clone());
        instance.config.local_values = HashMap::new();
        instance.login_cache = Some(legacy_values);
    }
    workspace
}

pub struct ProxyWorkspaceStore {
    file_path: PathBuf,
}

impl ProxyWorkspaceStore {
    pub fn new(file_path: impl Into<PathBuf>) -> Self {
        Self { file_path: file_path.into() }
    }

    pub async fn load<F, Fut>(&self, fallback: F) -> Result<ProxyWorkspace>
    where
        F: FnOnce() -> Fut,
        Fut: std::future::Future<Output = Result<AppConfig>>,
    {
        let text = match tokio::fs::read_to_string(&self.file_path).await {
            Ok(text) => text,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                let migrated = create_default_workspace(&fallback().await?);
                self.save(&migrated).await?;
                return Ok(migrated);
            }
            Err(error) => return Err(WorkspaceError(error.to_string())),
        };
        let parsed: serde_json::Value = serde_json::from_str(&text).map_err(|error| WorkspaceError(format!("Invalid proxy workspace: {error}")))?;
        if !is_valid_proxy_workspace(&parsed) {
            return Err(WorkspaceError("Invalid proxy workspace".to_string()));
        }
        let workspace: ProxyWorkspace = serde_json::from_value(parsed).map_err(|error| WorkspaceError(format!("Invalid proxy workspace: {error}")))?;
        let migrated = migrate_workspace(workspace);
        self.save(&migrated).await?;
        Ok(migrated)
    }

    pub async fn save(&self, workspace: &ProxyWorkspace) -> Result<()> {
        let value = serde_json::to_value(workspace).map_err(|error| WorkspaceError(error.to_string()))?;
        if !is_valid_proxy_workspace(&value) {
            return Err(WorkspaceError("Invalid proxy workspace".to_string()));
        }
        let content = format!("{}\n", serde_json::to_string_pretty(&value).map_err(|error| WorkspaceError(error.to_string()))?);
        crate::atomic_write(&self.file_path, content.as_bytes()).await.map_err(|error| WorkspaceError(error.to_string()))
    }
}
