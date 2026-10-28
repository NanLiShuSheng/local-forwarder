use crate::config::{UpdateInfoSnapshot, UpdateProgressSnapshot, UpdateState};
use std::pin::Pin;
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};
use tauri_plugin_updater::UpdaterExt;

const BACKGROUND_CHECK_DELAY: std::time::Duration = std::time::Duration::from_secs(10);

const FALLBACK_CHECK: &str = "检查更新失败";
const FALLBACK_DOWNLOAD: &str = "下载更新失败";
const FALLBACK_INSTALL: &str = "安装更新失败";

type StopAllFn = Arc<dyn Fn() -> Pin<Box<dyn std::future::Future<Output = Result<(), String>> + Send>> + Send + Sync>;

/// 更新后端抽象：真实实现走 tauri-plugin-updater，测试用假实现驱动状态机
#[async_trait::async_trait]
pub trait UpdateBackend: Send + Sync {
    /// 检查更新；有更新时后端自行保存更新句柄供 download/install 使用
    async fn check(&self) -> Result<Option<UpdateInfoSnapshot>, String>;
    async fn download(&self, on_progress: &(dyn Fn(u64, Option<u64>) + Sync)) -> Result<(), String>;
    async fn install(&self) -> Result<(), String>;
}

pub struct UpdateService {
    inner: Arc<Mutex<UpdateInner>>,
    backend: Arc<dyn UpdateBackend>,
    publish: mpsc::UnboundedSender<UpdateState>,
    current_version: String,
    active: bool,
    stop_all: StopAllFn,
    op_lock: Mutex<()>,
}

struct UpdateInner {
    state: UpdateState,
    disposed: bool,
}

/// 真实后端：tauri-plugin-updater
pub struct TauriUpdateBackend {
    app: tauri::AppHandle,
    pending: Mutex<Option<tauri_plugin_updater::Update>>,
    downloaded: Mutex<Option<Vec<u8>>>,
}

impl TauriUpdateBackend {
    pub fn new(app: tauri::AppHandle) -> Self {
        Self { app, pending: Mutex::new(None), downloaded: Mutex::new(None) }
    }
}

#[async_trait::async_trait]
impl UpdateBackend for TauriUpdateBackend {
    async fn check(&self) -> Result<Option<UpdateInfoSnapshot>, String> {
        let updater = self.app.updater().map_err(|error| error.to_string())?;
        let update = updater.check().await.map_err(|error| error.to_string())?;
        let Some(update) = update else { return Ok(None) };
        let snapshot = UpdateInfoSnapshot {
            version: update.version.clone(),
            release_date: update.date.map(|date| date.to_string()),
            release_notes: update.body.clone(),
        };
        *self.pending.lock().await = Some(update);
        Ok(Some(snapshot))
    }

    async fn download(&self, on_progress: &(dyn Fn(u64, Option<u64>) + Sync)) -> Result<(), String> {
        let mut transferred = 0u64;
        let bytes = {
            let update = self.pending.lock().await;
            let Some(update) = update.as_ref() else { return Err("no pending update".to_string()) };
            update
                .download(
                    |chunk_length, content_length| {
                        transferred += chunk_length as u64;
                        on_progress(transferred, content_length);
                    },
                    || {},
                )
                .await
                .map_err(|error| error.to_string())?
        };
        *self.downloaded.lock().await = Some(bytes);
        Ok(())
    }

    async fn install(&self) -> Result<(), String> {
        let update = self.pending.lock().await;
        let Some(update) = update.as_ref() else { return Err("no pending update".to_string()) };
        let bytes = self.downloaded.lock().await.take();
        let Some(bytes) = bytes else { return Err("no downloaded update".to_string()) };
        update.install(bytes).map_err(|error| error.to_string())?;
        self.app.restart();
    }
}

pub struct OperationResult {
    pub ok: bool,
    pub error: Option<String>,
}

impl UpdateService {
    pub fn new(
        current_version: String,
        active: bool,
        backend: Arc<dyn UpdateBackend>,
        stop_all: StopAllFn,
        publish: mpsc::UnboundedSender<UpdateState>,
    ) -> Arc<Self> {
        Arc::new(Self {
            inner: Arc::new(Mutex::new(UpdateInner {
                state: UpdateState { state: "idle".to_string(), current_version: current_version.clone(), update: None, progress: None, error: None },
                disposed: false,
            })),
            backend,
            publish,
            current_version,
            active,
            stop_all,
            op_lock: Mutex::new(()),
        })
    }

    pub async fn get_state(&self) -> UpdateState {
        self.inner.lock().await.state.clone()
    }

    pub fn is_active(&self) -> bool {
        self.active
    }

    async fn set_state(&self, next: UpdateState) {
        let mut inner = self.inner.lock().await;
        if inner.disposed || inner.state == next {
            return;
        }
        inner.state = next.clone();
        let _ = self.publish.send(next);
    }

    async fn set_error(&self, message: &str) {
        let current = self.get_state().await;
        self.set_state(UpdateState {
            state: "error".to_string(),
            current_version: self.current_version.clone(),
            update: current.update,
            progress: None,
            error: Some(message.to_string()),
        })
        .await;
    }

    fn base_state(&self, state: &str, update: Option<UpdateInfoSnapshot>) -> UpdateState {
        UpdateState { state: state.to_string(), current_version: self.current_version.clone(), update, progress: None, error: None }
    }

    pub async fn check(&self) -> OperationResult {
        if !self.active {
            return OperationResult { ok: true, error: None };
        }
        let _guard = self.op_lock.lock().await;
        self.set_state(self.base_state("checking", None)).await;
        match self.backend.check().await {
            Ok(Some(update)) => {
                self.set_state(self.base_state("available", Some(update))).await;
                OperationResult { ok: true, error: None }
            }
            Ok(None) => {
                self.set_state(self.base_state("not-available", None)).await;
                OperationResult { ok: true, error: None }
            }
            Err(_) => {
                self.set_error(FALLBACK_CHECK).await;
                OperationResult { ok: false, error: Some(FALLBACK_CHECK.to_string()) }
            }
        }
    }

    pub async fn download(&self) -> OperationResult {
        if !self.active {
            return OperationResult { ok: true, error: None };
        }
        let _guard = self.op_lock.lock().await;
        let current = self.get_state().await;
        let Some(update) = current.update.clone() else {
            self.set_error(FALLBACK_DOWNLOAD).await;
            return OperationResult { ok: false, error: Some(FALLBACK_DOWNLOAD.to_string()) };
        };
        self.set_state(self.base_state("downloading", Some(update.clone()))).await;
        let publish = self.publish.clone();
        let current_version = self.current_version.clone();
        let update_for_progress = update.clone();
        let on_progress = move |transferred: u64, total: Option<u64>| {
            let percent = match total {
                Some(total) if total > 0 => (transferred as f64 / total as f64) * 100.0,
                _ => 0.0,
            };
            let _ = publish.send(UpdateState {
                state: "downloading".to_string(),
                current_version: current_version.clone(),
                update: Some(update_for_progress.clone()),
                progress: Some(UpdateProgressSnapshot {
                    percent: percent.clamp(0.0, 100.0),
                    transferred,
                    total: total.unwrap_or(0),
                    bytes_per_second: 0,
                }),
                error: None,
            });
        };
        match self.backend.download(&on_progress).await {
            Ok(()) => {
                self.set_state(self.base_state("downloaded", Some(update))).await;
                OperationResult { ok: true, error: None }
            }
            Err(_) => {
                self.set_error(FALLBACK_DOWNLOAD).await;
                OperationResult { ok: false, error: Some(FALLBACK_DOWNLOAD.to_string()) }
            }
        }
    }

    pub async fn install(&self) -> OperationResult {
        if !self.active {
            return OperationResult { ok: true, error: None };
        }
        let _guard = self.op_lock.lock().await;
        if self.get_state().await.state != "downloaded" {
            self.set_error(FALLBACK_INSTALL).await;
            return OperationResult { ok: false, error: Some(FALLBACK_INSTALL.to_string()) };
        }
        if (self.stop_all)().await.is_err() {
            self.set_error(FALLBACK_INSTALL).await;
            return OperationResult { ok: false, error: Some(FALLBACK_INSTALL.to_string()) };
        }
        match self.backend.install().await {
            Ok(()) => OperationResult { ok: true, error: None },
            Err(_) => {
                self.set_error(FALLBACK_INSTALL).await;
                OperationResult { ok: false, error: Some(FALLBACK_INSTALL.to_string()) }
            }
        }
    }

    pub fn start_background_check(self: &Arc<Self>) {
        if !self.active {
            return;
        }
        let service = self.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(BACKGROUND_CHECK_DELAY).await;
            let inner = service.inner.lock().await;
            let disposed = inner.disposed;
            drop(inner);
            if !disposed {
                let _ = service.check().await;
            }
        });
    }

    pub async fn dispose(&self) {
        self.inner.lock().await.disposed = true;
    }
}
