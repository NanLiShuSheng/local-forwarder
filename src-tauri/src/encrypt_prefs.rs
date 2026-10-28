use crate::config::{EncryptionPreferences, EncryptionPreferencesPatch};
use std::path::Path;

const HISTORY_LIMIT: usize = 10;

fn normalize_history(history: Vec<String>) -> Vec<String> {
    let mut seen = Vec::new();
    for entry in history {
        if entry.trim().is_empty() || seen.contains(&entry) {
            continue;
        }
        seen.push(entry);
        if seen.len() == HISTORY_LIMIT {
            break;
        }
    }
    seen
}

fn add_to_history(history: &[String], value: &str) -> Vec<String> {
    let mut next = vec![value.to_string()];
    next.extend(history.iter().cloned());
    normalize_history(next)
}

async fn normalize_existing_directory(value: &str) -> String {
    if value.is_empty() {
        return String::new();
    }
    match tokio::fs::metadata(value).await {
        Ok(meta) if meta.is_dir() => value.to_string(),
        _ => String::new(),
    }
}

pub async fn read_encryption_preferences(preferences_path: &Path) -> Result<EncryptionPreferences, String> {
    let text = match tokio::fs::read_to_string(preferences_path).await {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(EncryptionPreferences::default()),
        Err(error) => return Err(error.to_string()),
    };
    let parsed: EncryptionPreferences = serde_json::from_str(&text).unwrap_or_default();
    let input_dir = normalize_existing_directory(&parsed.input_dir).await;
    let output_dir = normalize_existing_directory(&parsed.output_dir).await;
    Ok(EncryptionPreferences {
        input_history: add_to_history(&normalize_history(parsed.input_history), &input_dir),
        output_history: add_to_history(&normalize_history(parsed.output_history), &output_dir),
        input_dir,
        output_dir,
    })
}

pub async fn save_encryption_preferences(preferences_path: &Path, patch: &EncryptionPreferencesPatch) -> Result<EncryptionPreferences, String> {
    let current = read_encryption_preferences(preferences_path).await?;
    let next = EncryptionPreferences {
        input_dir: patch.input_dir.clone().unwrap_or_else(|| current.input_dir.clone()),
        output_dir: patch.output_dir.clone().unwrap_or_else(|| current.output_dir.clone()),
        input_history: patch.input_dir.as_deref().map_or_else(|| current.input_history.clone(), |dir| add_to_history(&current.input_history, dir)),
        output_history: patch.output_dir.as_deref().map_or_else(|| current.output_history.clone(), |dir| add_to_history(&current.output_history, dir)),
    };
    if let Some(parent) = preferences_path.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(|error| error.to_string())?;
    }
    let content = serde_json::to_string_pretty(&next).map_err(|error| error.to_string())?;
    crate::atomic_write(preferences_path, content.as_bytes()).await.map_err(|error| error.to_string())?;
    Ok(next)
}
