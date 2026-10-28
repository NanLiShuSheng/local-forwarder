pub mod codec;
pub mod config;
pub mod file_cache;
pub mod http_proxy;
pub mod routing;
pub mod tcp_bridge;

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
