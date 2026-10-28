use crate::codec::TztCodec;
use flate2::read::GzDecoder;
use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

#[derive(Debug)]
pub struct CacheError(pub String);

impl std::fmt::Display for CacheError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl std::error::Error for CacheError {}

impl From<std::io::Error> for CacheError {
    fn from(error: std::io::Error) -> Self {
        CacheError(error.to_string())
    }
}

impl From<crate::codec::CodecError> for CacheError {
    fn from(error: crate::codec::CodecError) -> Self {
        CacheError(error.0)
    }
}

type Result<T> = std::result::Result<T, CacheError>;

#[derive(Debug, Clone, PartialEq)]
pub enum CacheSource {
    Cache,
    Download,
}

#[derive(Debug, Clone)]
pub struct CacheResult {
    pub source: CacheSource,
    pub data: Vec<u8>,
}

pub struct FileCache {
    root_dir: PathBuf,
    locks: Mutex<HashMap<PathBuf, Arc<tokio::sync::OnceCell<CacheResult>>>>,
}

impl FileCache {
    pub fn new(root_dir: impl Into<PathBuf>) -> Result<Self> {
        let root_dir = root_dir.into();
        if root_dir.as_os_str().is_empty() {
            return Err(CacheError("cache rootDir is required".to_string()));
        }
        Ok(Self {
            root_dir: crate::normalize_lexical(&std::path::absolute(&root_dir).unwrap_or(root_dir)),
            locks: Mutex::new(HashMap::new()),
        })
    }

    pub fn resolve(&self, relative_path: &str) -> Result<PathBuf> {
        if relative_path.is_empty() {
            return Err(CacheError("cache path is required".to_string()));
        }
        let candidate = crate::normalize_lexical(&self.root_dir.join(relative_path));
        if candidate != self.root_dir && !candidate.starts_with(&self.root_dir) {
            return Err(CacheError("path is outside cache root".to_string()));
        }
        Ok(candidate)
    }

    pub async fn get(&self, relative_path: &str) -> Result<Option<Vec<u8>>> {
        let filename = self.resolve(relative_path)?;
        match tokio::fs::metadata(&filename).await {
            Ok(meta) if meta.is_file() => Ok(Some(tokio::fs::read(&filename).await?)),
            Ok(_) => Ok(None),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error.into()),
        }
    }

    pub async fn write(&self, relative_path: &str, data: &[u8]) -> Result<()> {
        let filename = self.resolve(relative_path)?;
        if let Some(parent) = filename.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.subsec_nanos()).unwrap_or(0);
        let temporary = filename.with_extension(format!("tmp-{}-{nonce:x}", std::process::id()));
        let write_result = async {
            let mut options = std::fs::OpenOptions::new();
            write_options(&mut options);
            let mut file = options.open(&temporary)?;
            std::io::Write::write_all(&mut file, data)?;
            tokio::fs::rename(&temporary, &filename).await?;
            Ok::<(), CacheError>(())
        }
        .await;
        if write_result.is_err() {
            let _ = tokio::fs::remove_file(&temporary).await;
        }
        write_result
    }

    pub async fn get_or_download<F, Fut>(&self, relative_path: &str, downloader: F) -> Result<CacheResult>
    where
        F: FnOnce() -> Fut,
        Fut: std::future::Future<Output = Result<Vec<u8>>>,
    {
        let normalized = self.resolve(relative_path)?;
        if let Some(data) = self.get(relative_path).await? {
            return Ok(CacheResult { source: CacheSource::Cache, data });
        }
        let cell = self
            .locks
            .lock()
            .expect("locks poisoned")
            .entry(normalized.clone())
            .or_insert_with(|| Arc::new(tokio::sync::OnceCell::new()))
            .clone();
        let initialized = cell
            .get_or_try_init(|| async {
                // 等待期间其他下载可能已落盘，双检避免重复下载
                if let Some(data) = self.get(relative_path).await? {
                    return Ok(CacheResult { source: CacheSource::Cache, data });
                }
                let data = downloader().await?;
                self.write(relative_path, &data).await?;
                Ok(CacheResult { source: CacheSource::Download, data })
            })
            .await;
        match initialized {
            Ok(result) => Ok(result.clone()),
            Err(error) => {
                let mut locks = self.locks.lock().expect("locks poisoned");
                if locks.get(&normalized).is_some_and(|current| Arc::ptr_eq(current, &cell)) {
                    locks.remove(&normalized);
                }
                Err(error)
            }
        }
    }

    pub async fn remove(&self, relative_path: &str) -> Result<()> {
        match tokio::fs::remove_file(self.resolve(relative_path)?).await {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error.into()),
        }
    }
}

#[cfg(unix)]
fn write_options(options: &mut std::fs::OpenOptions) -> &mut std::fs::OpenOptions {
    use std::os::unix::fs::OpenOptionsExt;
    options.write(true).create_new(true).mode(0o600)
}

#[cfg(not(unix))]
fn write_options(options: &mut std::fs::OpenOptions) -> &mut std::fs::OpenOptions {
    options.write(true).create_new(true)
}

pub fn decode_cached_resource(relative_path: &str, data: &[u8], codec: &mut TztCodec, decrypt_enabled: bool) -> Result<Vec<u8>> {
    if !decrypt_enabled || !relative_path.to_lowercase().ends_with(".d") {
        return Ok(data.to_vec());
    }
    let original_name = &relative_path[..relative_path.len() - 2];
    let extension = Path::new(original_name).extension().map(|ext| ext.to_string_lossy().to_lowercase()).unwrap_or_default();
    if ![".js", ".html", ".htm", ".css"].contains(&extension.as_str()) {
        return Ok(data.to_vec());
    }
    if data.len() < 4 {
        return Err(CacheError(format!("Invalid encrypted resource: {relative_path}")));
    }
    let decrypted = codec.rc4(&data[..data.len() - 4], "file")?;
    let basename = Path::new(original_name).file_name().map(|name| name.to_string_lossy().to_lowercase());
    if basename.as_deref() == Some("tzt.js") {
        let mut decoded = Vec::new();
        GzDecoder::new(&decrypted[..])
            .read_to_end(&mut decoded)
            .map_err(|error| CacheError(format!("Invalid gzip resource: {relative_path}: {error}")))?;
        return Ok(decoded);
    }
    Ok(decrypted)
}

pub fn rewrite_legacy_navigation_script(relative_path: &str, data: &[u8]) -> Vec<u8> {
    if !relative_path.contains("TZT.js") {
        return data.to_vec();
    }
    String::from_utf8_lossy(data)
        .replace(
            "window.onJsOverrideUrlLoading = function(str, checkFlag){",
            "window.onJsOverrideUrlLoading = function (str,  checkFlag) {str = str.replace('http:/','').replace('http%3A%2F','');",
        )
        .replace("window.MyWebView.onJsOverrideUrlLoading(str)", "window.location.href = str;")
        .into_bytes()
}
