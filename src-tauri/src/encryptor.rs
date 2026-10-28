use crate::config::EncryptionProgress;
use sha2::Digest;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

#[derive(Debug)]
pub struct EncryptError(pub String);

impl std::fmt::Display for EncryptError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl std::error::Error for EncryptError {}

impl From<std::io::Error> for EncryptError {
    fn from(error: std::io::Error) -> Self {
        EncryptError(error.to_string())
    }
}

type Result<T> = std::result::Result<T, EncryptError>;

#[derive(Debug, Clone, serde::Serialize)]
pub struct EncryptionFileResult {
    #[serde(rename = "relativePath")]
    pub relative_path: String,
    #[serde(rename = "outputPath")]
    pub output_path: String,
}

#[derive(Debug, serde::Serialize)]
pub struct EncryptionResult {
    pub mode: String,
    #[serde(rename = "totalFiles")]
    pub total_files: usize,
    #[serde(rename = "processedFiles")]
    pub processed_files: usize,
    #[serde(rename = "skippedFiles")]
    pub skipped_files: usize,
    #[serde(rename = "removedFiles")]
    pub removed_files: usize,
    pub files: Vec<EncryptionFileResult>,
    pub logs: Vec<String>,
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
struct EncryptionState {
    version: u32,
    #[serde(rename = "inputDir")]
    input_dir: String,
    #[serde(rename = "outputDir")]
    output_dir: String,
    #[serde(rename = "encoderHash")]
    encoder_hash: String,
    files: HashMap<String, String>,
}

pub fn default_encrypt_state_path(output_dir: &Path) -> PathBuf {
    output_dir.join(".encrypt-cache.json")
}

fn should_ignore(name: &str, is_dir: bool, is_file: bool) -> bool {
    name.starts_with('.') || (is_directory_ignored(name) && is_dir) || (is_file && name.ends_with(".map"))
}

fn is_directory_ignored(name: &str) -> bool {
    name == "node_modules"
}

pub fn collect_files(root_dir: &Path) -> Result<Vec<PathBuf>> {
    let mut files = Vec::new();
    collect_files_into(root_dir, &mut files)?;
    Ok(files)
}

fn collect_files_into(root_dir: &Path, files: &mut Vec<PathBuf>) -> Result<()> {
    for entry in std::fs::read_dir(root_dir)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let file_type = entry.file_type()?;
        if should_ignore(&name, file_type.is_dir(), file_type.is_file()) {
            continue;
        }
        let full_path = entry.path();
        if file_type.is_dir() {
            collect_files_into(&full_path, files)?;
        } else if file_type.is_file() {
            files.push(full_path);
        }
    }
    Ok(())
}

pub async fn run_encoder(encoder_path: &Path, encoder_args: &[String], source_path: &Path, output_path: &Path, temp_root: &Path) -> Result<()> {
    let temp_dir = tempfile::Builder::new().prefix("encode-work-").tempdir_in(temp_root)?;
    let temp_input = temp_dir.path().join(source_path.file_name().ok_or_else(|| EncryptError("source path has no filename".to_string()))?);
    let temp_output = PathBuf::from(format!("{}.d", temp_input.display()));
    let run = async {
        tokio::fs::copy(source_path, &temp_input).await?;
        let output = tokio::process::Command::new(encoder_path)
            .args(encoder_args)
            .arg(&temp_input)
            .output()
            .await?;
        if !output.status.success() {
            return Err(EncryptError(format!("encoder exited with {}: {}", output.status, String::from_utf8_lossy(&output.stderr))));
        }
        if tokio::fs::metadata(&temp_output).await.is_err() {
            return Err(EncryptError("encoded output was not produced".to_string()));
        }
        if let Some(parent) = output_path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        tokio::fs::copy(&temp_output, output_path).await?;
        Ok::<(), EncryptError>(())
    }
    .await;
    run.map_err(|error| EncryptError(format!("Failed to encrypt {:?}: {}", source_path, error.0)))
}

async fn hash_file(path: &Path) -> Result<String> {
    let content = tokio::fs::read(path).await?;
    Ok(hex_encode(&sha2::Sha256::digest(&content)))
}

async fn hash_encoder(encoder_path: &Path, encoder_args: &[String]) -> Result<String> {
    let content = tokio::fs::read(encoder_path).await?;
    let mut hasher = sha2::Sha256::new();
    hasher.update(&content);
    hasher.update([0u8]);
    hasher.update(serde_json::to_string(encoder_args).map_err(|error| EncryptError(error.to_string()))?);
    Ok(hex_encode(&hasher.finalize()))
}

fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

async fn read_encrypt_state(state_path: &Path) -> Result<Option<EncryptionState>> {
    let text = match tokio::fs::read_to_string(state_path).await {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    let state: EncryptionState = match serde_json::from_str::<EncryptionState>(&text) {
        Ok(state) if state.version == 1 => state,
        _ => return Ok(None),
    };
    Ok(Some(state))
}

fn resolve_for_safety(target: &Path) -> Result<PathBuf> {
    let resolved = std::path::absolute(target)?;
    match resolved.canonicalize() {
        Ok(real) => Ok(real),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => match resolved.parent() {
            Some(parent) if parent != resolved => Ok(resolve_for_safety(parent)?.join(resolved.file_name().unwrap_or_default())),
            _ => Ok(resolved),
        },
        Err(error) => Err(error.into()),
    }
}

fn is_same_or_inside(parent: &Path, child: &Path) -> bool {
    child == parent || child.starts_with(parent)
}

fn safe_output_path(output_dir: &Path, relative_path: &str) -> Result<PathBuf> {
    let output_path = crate::normalize_lexical(&output_dir.join(format!("{relative_path}.d")));
    if !is_same_or_inside(output_dir, &output_path) {
        return Err(EncryptError(format!("Output path is outside output directory: {relative_path}")));
    }
    Ok(output_path)
}

pub struct EncryptDirectoryOptions<'a> {
    pub input_dir: &'a Path,
    pub output_dir: &'a Path,
    pub encoder_path: &'a Path,
    pub encoder_args: &'a [String],
    pub mode: &'a str,
    pub state_path: Option<PathBuf>,
    pub temp_root: Option<PathBuf>,
    pub on_progress: Option<&'a (dyn Fn(EncryptionProgress) + Sync)>,
}

pub async fn encrypt_directory(options: EncryptDirectoryOptions<'_>) -> Result<EncryptionResult> {
    let EncryptDirectoryOptions { input_dir, output_dir, encoder_path, encoder_args, mode, state_path, temp_root, on_progress } = options;
    if input_dir.as_os_str().is_empty() || output_dir.as_os_str().is_empty() {
        return Err(EncryptError("inputDir and outputDir are required".to_string()));
    }
    if encoder_path.as_os_str().is_empty() {
        return Err(EncryptError("encoderPath is required".to_string()));
    }
    if mode != "full" && mode != "incremental" {
        return Err(EncryptError(format!("Unsupported encryption mode: {mode}")));
    }
    if !tokio::fs::metadata(input_dir).await.map(|meta| meta.is_dir()).unwrap_or(false) {
        return Err(EncryptError(format!("Input directory does not exist: {}", input_dir.display())));
    }
    let resolved_input = resolve_for_safety(input_dir)?;
    let resolved_output = resolve_for_safety(output_dir)?;
    if is_same_or_inside(&resolved_input, &resolved_output) {
        return Err(EncryptError("Output directory must be outside the input directory".to_string()));
    }
    if tokio::fs::metadata(encoder_path).await.is_err() {
        return Err(EncryptError(format!("Encoder does not exist or is not executable: {}", encoder_path.display())));
    }
    tokio::fs::create_dir_all(output_dir).await?;

    let emit = |phase: &str, status: Option<&str>, current: usize, total: usize, processed: usize, skipped: usize, removed: usize, relative: Option<String>| {
        if let Some(callback) = on_progress {
            callback(EncryptionProgress {
                mode: mode.to_string(),
                phase: phase.to_string(),
                status: status.map(str::to_string),
                current,
                total,
                processed_files: processed,
                skipped_files: skipped,
                removed_files: removed,
                relative_path: relative,
            });
        }
    };

    emit("scanning", None, 0, 0, 0, 0, 0, None);
    let files = collect_files(input_dir)?;
    let encoder_hash = hash_encoder(encoder_path, encoder_args).await?;
    let state_path = state_path.unwrap_or_else(|| default_encrypt_state_path(output_dir));
    let previous_state = read_encrypt_state(&state_path).await?;
    let state_matches = previous_state
        .as_ref()
        .is_some_and(|state| state.input_dir == resolved_input.to_string_lossy() && state.output_dir == resolved_output.to_string_lossy() && state.encoder_hash == encoder_hash);
    let previous_files: HashMap<String, String> = if state_matches { previous_state.as_ref().map(|state| state.files.clone()).unwrap_or_default() } else { HashMap::new() };
    let temp_root = temp_root.unwrap_or_else(std::env::temp_dir);

    let mut current_relative: HashSet<String> = HashSet::new();
    for file in &files {
        current_relative.insert(file.strip_prefix(input_dir).unwrap_or(file).to_string_lossy().into_owned());
    }
    let mut next_files: HashMap<String, String> = HashMap::new();
    let mut result_files: Vec<EncryptionFileResult> = Vec::new();
    let mut logs: Vec<String> = Vec::new();
    let mut processed = 0usize;
    let mut skipped = 0usize;
    let mut removed = 0usize;

    emit("processing", None, 0, files.len(), processed, skipped, removed, None);

    if state_matches {
        for relative_path in previous_files.keys() {
            if current_relative.contains(relative_path) {
                continue;
            }
            let stale = safe_output_path(&resolved_output, relative_path)?;
            if tokio::fs::metadata(&stale).await.map(|meta| meta.is_file()).unwrap_or(false) {
                let _ = tokio::fs::remove_file(&stale).await;
                removed += 1;
                emit("processing", Some("removing"), 0, files.len(), processed, skipped, removed, Some(relative_path.clone()));
            }
        }
    }

    for file in &files {
        let relative_path = file.strip_prefix(input_dir).unwrap_or(file).to_string_lossy().into_owned();
        let output_path = safe_output_path(&resolved_output, &relative_path)?;
        let source_hash = hash_file(file).await?;
        next_files.insert(relative_path.clone(), source_hash.clone());
        let can_skip = mode == "incremental"
            && state_matches
            && previous_files.get(&relative_path).map(|hash| hash == &source_hash).unwrap_or(false)
            && tokio::fs::metadata(&output_path).await.map(|meta| meta.is_file()).unwrap_or(false);
        if can_skip {
            skipped += 1;
            emit("processing", Some("skipping"), processed + skipped, files.len(), processed, skipped, removed, Some(relative_path.clone()));
        } else {
            logs.push(format!("Encrypting {relative_path}"));
            run_encoder(encoder_path, encoder_args, file, &output_path, &temp_root).await?;
            processed += 1;
            emit("processing", Some("encrypting"), processed + skipped, files.len(), processed, skipped, removed, Some(relative_path.clone()));
        }
        result_files.push(EncryptionFileResult { relative_path, output_path: output_path.to_string_lossy().into_owned() });
    }

    let next_state = EncryptionState {
        version: 1,
        input_dir: resolved_input.to_string_lossy().into_owned(),
        output_dir: resolved_output.to_string_lossy().into_owned(),
        encoder_hash,
        files: next_files,
    };
    let content = serde_json::to_string_pretty(&next_state).map_err(|error| EncryptError(error.to_string()))?;
    crate::atomic_write(&state_path, content.as_bytes()).await?;
    emit("completed", Some("completed"), files.len(), files.len(), processed, skipped, removed, None);
    Ok(EncryptionResult {
        mode: mode.to_string(),
        total_files: result_files.len(),
        processed_files: processed,
        skipped_files: skipped,
        removed_files: removed,
        files: result_files,
        logs,
    })
}
