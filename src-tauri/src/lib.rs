pub mod codec;
pub mod config;
pub mod config_store;
pub mod encrypt_prefs;
pub mod encryptor;
pub mod file_cache;
pub mod http_proxy;
pub mod local_cache;
pub mod manual_request;
pub mod port_recovery;
pub mod routing;
pub mod service_manager;
pub mod shell;
pub mod tcp_bridge;
pub mod validation;
pub mod workspace_store;

use std::path::{Path, PathBuf};

/// 纯词法归一化（不解符号链接）：与 Node path.resolve 的语义对齐。
pub(crate) fn normalize_lexical(path: &Path) -> PathBuf {
    let mut output = PathBuf::new();
    for component in path.components() {
        match component {
            std::path::Component::ParentDir => {
                output.pop();
            }
            std::path::Component::CurDir => {}
            other => output.push(other.as_os_str()),
        }
    }
    output
}

/// 原子写入（临时文件 + rename，0600）：配置/状态文件的统一写盘方式。
pub(crate) async fn atomic_write(path: &Path, data: &[u8]) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.subsec_nanos()).unwrap_or(0);
    let temporary = path.with_extension(format!("tmp-{}-{nonce:x}", std::process::id()));
    let result = async {
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temporary)?;
        std::io::Write::write_all(&mut file, data)?;
        tokio::fs::rename(&temporary, path).await?;
        Ok::<(), std::io::Error>(())
    }
    .await;
    if result.is_err() {
        let _ = tokio::fs::remove_file(&temporary).await;
    }
    result
}
