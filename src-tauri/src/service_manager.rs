use crate::codec::TztCodec;
use crate::config::{AppConfig, LogEntry, ProxyInstance, ProxyInstanceSummary, ProxyWorkspace, RuntimeStatus, StoredValues, TcpTargetConfig};
use crate::file_cache::FileCache;
use crate::http_proxy::{start_http_proxy, HttpProxyOptions, HttpProxyPatch, ProxyEvent, RunningHttpProxy};
use crate::port_recovery::{is_auto_recoverable_port, recover_occupied_port};
use crate::tcp_bridge::TcpBridgePool;
use crate::validation::{get_app_config_validation_error, is_valid_app_config};
use crate::workspace_store::ProxyWorkspaceStore;
use std::collections::{HashMap, VecDeque};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, Mutex};

const LOG_BUFFER_LIMIT: usize = 2000;

#[derive(Debug, Clone)]
pub enum ManagerEvent {
    ValuesChanged,
}

#[derive(Debug)]
enum ServiceEvent {
    LoginValues { instance_id: String, values: HashMap<String, String> },
    LocalValuesChanged,
    ValuesWritten { instance_id: String },
    PersistConfig { instance_id: String, config: Box<AppConfig> },
}

#[derive(Debug, Clone, PartialEq)]
pub enum RuntimeState {
    Stopped,
    Starting,
    Running,
    Stopping,
    Error,
}

impl RuntimeState {
    fn as_str(&self) -> &'static str {
        match self {
            RuntimeState::Stopped => "stopped",
            RuntimeState::Starting => "starting",
            RuntimeState::Running => "running",
            RuntimeState::Stopping => "stopping",
            RuntimeState::Error => "error",
        }
    }
}

pub struct ForwardingService {
    config: AppConfig,
    instance_id: String,
    state: RuntimeState,
    error: Option<String>,
    log_buffer: Arc<std::sync::Mutex<VecDeque<LogEntry>>>,
    runtime: Option<ServiceRuntime>,
    events: mpsc::UnboundedSender<ServiceEvent>,
}

struct ServiceRuntime {
    proxy: RunningHttpProxy,
    bridge: Arc<TcpBridgePool>,
    drain: tokio::task::JoinHandle<()>,
}

impl ForwardingService {
    fn new(config: AppConfig, instance_id: String, events: mpsc::UnboundedSender<ServiceEvent>) -> Self {
        Self { config, instance_id, state: RuntimeState::Stopped, error: None, log_buffer: Arc::new(std::sync::Mutex::new(VecDeque::new())), runtime: None, events }
    }

    fn append_log(&self, level: &str, message: impl Into<String>) {
        let mut buffer = self.log_buffer.lock().expect("log buffer poisoned");
        buffer.push_back(LogEntry::new(level, message));
        while buffer.len() > LOG_BUFFER_LIMIT {
            buffer.pop_front();
        }
    }

    pub fn status(&self) -> RuntimeStatus {
        match self.runtime.as_ref() {
            Some(runtime) => {
                let stats = runtime.proxy.state().stats();
                RuntimeStatus { state: self.state.as_str().to_string(), request_count: stats.request_count, tcp_connections: runtime.proxy.tcp_connections(), error: self.error.clone() }
            }
            None => RuntimeStatus { state: self.state.as_str().to_string(), request_count: 0, tcp_connections: 0, error: self.error.clone() },
        }
    }

    pub fn get_config(&mut self) -> AppConfig {
        self.merge_live_values();
        self.config.clone()
    }

    fn merge_live_values(&mut self) {
        if let Some(runtime) = self.runtime.as_ref() {
            let values = runtime.proxy.state().get_values();
            self.config.local_values = values.local_values;
            self.config.map_values = values.map_values;
            if let Some(legacy) = self.config.legacy.as_mut() {
                legacy.files = values.file_values.into_iter().map(|(key, value)| (key, serde_json::Value::String(value))).collect();
            }
        }
    }

    pub async fn start(&mut self) -> Result<RuntimeStatus, String> {
        if matches!(self.state, RuntimeState::Running | RuntimeState::Starting) {
            return Ok(self.status());
        }
        if let Some(field) = get_app_config_validation_error(&serde_json::to_value(&self.config).map_err(|error| error.to_string())?) {
            self.state = RuntimeState::Error;
            self.error = Some(format!("Invalid configuration: {field}"));
            self.append_log("error", self.error.clone().unwrap_or_default());
            return Err(self.error.clone().unwrap_or_default());
        }
        self.state = RuntimeState::Starting;
        self.error = None;
        match self.start_internal().await {
            Ok(status) => Ok(status),
            Err(error) => {
                self.state = RuntimeState::Error;
                self.error = Some(error.clone());
                self.append_log("error", &error);
                Err(error)
            }
        }
    }

    async fn start_internal(&mut self) -> Result<RuntimeStatus, String> {
        let timeout = Duration::from_millis(self.config.server.timeout_ms);
        let root_dir = if self.config.cache.root_dir.is_empty() {
            std::env::temp_dir().join("local-forwarder-cache").to_string_lossy().into_owned()
        } else {
            self.config.cache.root_dir.clone()
        };
        let cache = Arc::new(FileCache::new(root_dir).map_err(|error| error.0)?);
        let codec = TztCodec::new().map_err(|error| error.0)?;
        let bridge = Arc::new(TcpBridgePool::with_codec(codec, timeout, timeout));
        let cache_codec = if self.config.cache.decrypt_enabled { Some(Arc::new(Mutex::new(TztCodec::new().map_err(|error| error.0)?))) } else { None };
        let (log_tx, mut log_rx) = mpsc::unbounded_channel::<LogEntry>();
        let (event_tx, mut event_rx) = mpsc::unbounded_channel::<ProxyEvent>();
        let build_options = || HttpProxyOptions {
            bind_host: self.config.server.bind_host.clone(),
            port: self.config.server.port,
            timeout,
            project_path: self.config.project_path.clone(),
            rules: self.config.http_rules.clone(),
            accounts: self.config.accounts.clone(),
            tcp_targets: self.config.tcp_targets.clone(),
            bridge: bridge.clone(),
            cache: Some(cache.clone()),
            cache_config: Some(self.config.cache.clone()),
            cache_codec: cache_codec.clone(),
            local_values: self.config.local_values.clone(),
            map_values: self.config.map_values.clone(),
            file_values: self
                .config
                .legacy
                .as_ref()
                .map(|legacy| legacy.files.iter().filter_map(|(key, value)| value.as_str().map(|text| (key.clone(), text.to_string()))).collect())
                .unwrap_or_default(),
            log_tx: Some(log_tx.clone()),
            event_tx: Some(event_tx.clone()),
        };
        let proxy = match start_http_proxy(build_options()).await {
            Ok(proxy) => proxy,
            Err(first_error) => {
                if !(first_error.addr_in_use && is_auto_recoverable_port(self.config.server.port)) {
                    return Err(first_error.message);
                }
                recover_occupied_port(self.config.server.port).await?;
                start_http_proxy(build_options()).await.map_err(|error| error.message)?
            }
        };
        let address = format!("{}:{}", proxy.host, proxy.port);
        self.state = RuntimeState::Running;
        self.append_log("info", format!("Forwarding service started on {address}"));

        let buffer = self.log_buffer.clone();
        let logging_enabled = self.config.server.logging_enabled;
        let instance_id = self.instance_id.clone();
        let events = self.events.clone();
        let drain = tokio::spawn(async move {
            loop {
                tokio::select! {
                    entry = log_rx.recv() => {
                        let Some(entry) = entry else { break };
                        if !logging_enabled && entry.level != "error" {
                            continue;
                        }
                        let mut buffer = buffer.lock().expect("log buffer poisoned");
                        buffer.push_back(entry);
                        while buffer.len() > LOG_BUFFER_LIMIT {
                            buffer.pop_front();
                        }
                    }
                    event = event_rx.recv() => {
                        let Some(event) = event else { break };
                        let mapped = match event {
                            ProxyEvent::LoginValuesCaptured(values) => ServiceEvent::LoginValues { instance_id: instance_id.clone(), values },
                            ProxyEvent::LocalValuesChanged(_) => ServiceEvent::LocalValuesChanged,
                            ProxyEvent::ValuesWritten => ServiceEvent::ValuesWritten { instance_id: instance_id.clone() },
                        };
                        let _ = events.send(mapped);
                    }
                }
            }
        });
        self.runtime = Some(ServiceRuntime { proxy, bridge, drain });
        Ok(self.status())
    }

    pub async fn stop(&mut self) -> Result<RuntimeStatus, String> {
        if self.state == RuntimeState::Stopped {
            return Ok(self.status());
        }
        self.state = RuntimeState::Stopping;
        self.persist_runtime_values();
        if let Some(runtime) = self.runtime.take() {
            runtime.drain.abort();
            runtime.proxy.stop();
            runtime.bridge.close().await;
        }
        self.state = RuntimeState::Stopped;
        self.error = None;
        Ok(self.status())
    }

    fn persist_runtime_values(&mut self) {
        self.merge_live_values();
        let _ = self.events.send(ServiceEvent::PersistConfig { instance_id: self.instance_id.clone(), config: Box::new(self.config.clone()) });
    }

    pub fn save_config(&mut self, mut next: AppConfig) -> Result<(), String> {
        let value = serde_json::to_value(&next).map_err(|error| error.to_string())?;
        if !is_valid_app_config(&value) {
            return Err(format!("Invalid configuration: {}", get_app_config_validation_error(&value).unwrap_or_else(|| "unknown field".to_string())));
        }
        if self.state == RuntimeState::Running {
            // 运行中的代理拥有这些值；渲染端的旧快照不得覆盖
            if let Some(runtime) = self.runtime.as_ref() {
                let live = runtime.proxy.state().get_values();
                next.local_values = live.local_values;
                next.map_values = live.map_values;
                if let Some(legacy) = next.legacy.as_mut() {
                    legacy.files = live.file_values.into_iter().map(|(key, value)| (key, serde_json::Value::String(value))).collect();
                }
            }
            if !is_hot_swappable_config_change(&self.config, &next) {
                return Err("stop the service before changing configuration".to_string());
            }
            if let Some(runtime) = self.runtime.as_ref() {
                runtime.proxy.state().update_options(HttpProxyPatch {
                    tcp_targets: Some(next.tcp_targets.clone()),
                    project_path: if next.project_path != self.config.project_path { Some(next.project_path.clone()) } else { None },
                    map_values: None,
                    file_values: None,
                });
            }
        }
        self.config = next;
        let _ = self.events.send(ServiceEvent::PersistConfig { instance_id: self.instance_id.clone(), config: Box::new(self.config.clone()) });
        Ok(())
    }

    pub fn set_runtime_values(&mut self, values: HashMap<String, String>) {
        self.config.local_values = values.clone();
        if let Some(runtime) = self.runtime.as_ref() {
            runtime.proxy.state().set_local_values(values);
        }
    }

    pub fn set_stored_values(&mut self, stored: &StoredValues) {
        if let Some(runtime) = self.runtime.as_ref() {
            runtime.proxy.state().update_options(HttpProxyPatch {
                tcp_targets: None,
                project_path: None,
                map_values: Some(stored.map_values.clone()),
                file_values: Some(stored.file_values.clone()),
            });
        }
        self.config.map_values = stored.map_values.clone();
        if let Some(legacy) = self.config.legacy.as_mut() {
            legacy.files = stored.file_values.iter().map(|(key, value)| (key.clone(), serde_json::Value::String(value.clone()))).collect();
        }
        self.persist_runtime_values();
    }

    pub fn apply_tcp_targets(&self, targets: Vec<TcpTargetConfig>) {
        if let Some(runtime) = self.runtime.as_ref() {
            runtime.proxy.state().update_options(HttpProxyPatch { tcp_targets: Some(targets), project_path: None, map_values: None, file_values: None });
        }
    }

    pub fn get_logs(&self) -> Vec<LogEntry> {
        self.log_buffer.lock().expect("log buffer poisoned").iter().cloned().collect()
    }

    pub fn clear_logs(&self) {
        self.log_buffer.lock().expect("log buffer poisoned").clear();
    }
}

// request/stringTool 只影响 UI 工具（手动请求/字符串工具），不影响运行中的代理
const HOT_SWAPPABLE_IGNORED_KEYS: [&str; 10] = ["tcpTargets", "forwardingAddressHistory", "launchPath", "cardTargetId", "localValues", "mapValues", "legacy", "projectPath", "request", "stringTool"];

fn is_hot_swappable_config_change(current: &AppConfig, next: &AppConfig) -> bool {
    let strip = |config: &AppConfig| {
        let mut value = serde_json::to_value(config).unwrap_or_default();
        if let Some(object) = value.as_object_mut() {
            for key in HOT_SWAPPABLE_IGNORED_KEYS {
                object.shift_remove(key);
            }
        }
        value.to_string()
    };
    strip(current) == strip(next)
}

struct ManagerInner {
    workspace: ProxyWorkspace,
    services: HashMap<String, ForwardingService>,
}

pub struct ForwardingServiceManager {
    inner: Arc<Mutex<ManagerInner>>,
    workspace_store: Arc<ProxyWorkspaceStore>,
    default_cache_root: Option<String>,
    subscribers: Arc<std::sync::Mutex<Vec<mpsc::UnboundedSender<ManagerEvent>>>>,
    events: mpsc::UnboundedSender<ServiceEvent>,
}

impl ForwardingServiceManager {
    /// 必须在 tokio 运行时内调用（内部会 spawn 中央事件循环）。
    pub fn new(workspace: ProxyWorkspace, workspace_store: Arc<ProxyWorkspaceStore>, default_cache_root: Option<String>) -> Arc<Self> {
        let (events, event_rx) = mpsc::unbounded_channel::<ServiceEvent>();
        let normalized = normalize_workspace(workspace);
        let mut services = HashMap::new();
        for instance in &normalized.instances {
            services.insert(instance.id.clone(), ForwardingService::new(runtime_config(&normalized, instance), instance.id.clone(), events.clone()));
        }
        let manager = Arc::new(Self {
            inner: Arc::new(Mutex::new(ManagerInner { workspace: normalized, services })),
            workspace_store,
            default_cache_root,
            subscribers: Arc::new(std::sync::Mutex::new(Vec::new())),
            events,
        });
        let inner_for_loop = manager.inner.clone();
        let store_for_loop = manager.workspace_store.clone();
        let subscribers_for_loop = manager.subscribers.clone();
        // JoinHandle 丢弃后任务继续运行（与应用同寿命）
        tokio::spawn(async move {
            let mut event_rx = event_rx;
            while let Some(event) = event_rx.recv().await {
                let notify = {
                    let mut inner = inner_for_loop.lock().await;
                    match event {
                        ServiceEvent::LoginValues { instance_id, values } => {
                            if let Some(instance) = inner.workspace.instances.iter_mut().find(|instance| instance.id == instance_id) {
                                instance.login_cache.get_or_insert_with(HashMap::new).extend(values);
                            }
                            apply_runtime_values(&mut inner, &instance_id);
                            true
                        }
                        ServiceEvent::LocalValuesChanged => true,
                        ServiceEvent::ValuesWritten { instance_id } => {
                            // 对齐 TS onValuesWritten：先把运行中的实时值并回配置，再持久化
                            let config = inner.services.get_mut(&instance_id).map(|service| {
                                service.merge_live_values();
                                service.config.clone()
                            });
                            if let Some(config) = config {
                                if let Some(instance) = inner.workspace.instances.iter_mut().find(|instance| instance.id == instance_id) {
                                    instance.config = AppConfig { local_values: HashMap::new(), ..config };
                                }
                            }
                            if let Err(error) = store_for_loop.save(&inner.workspace).await {
                                eprintln!("workspace save failed: {error}");
                            }
                            true
                        }
                        ServiceEvent::PersistConfig { instance_id, config } => {
                            if let Some(instance) = inner.workspace.instances.iter_mut().find(|instance| instance.id == instance_id) {
                                instance.config = AppConfig { local_values: HashMap::new(), ..*config };
                            }
                            if let Err(error) = store_for_loop.save(&inner.workspace).await {
                                eprintln!("workspace save failed: {error}");
                            }
                            false
                        }
                    }
                };
                if notify {
                    let subscribers = subscribers_for_loop.lock().expect("subscribers poisoned");
                    for subscriber in subscribers.iter() {
                        let _ = subscriber.send(ManagerEvent::ValuesChanged);
                    }
                }
            }
        });
        manager
    }

    pub fn subscribe(&self) -> mpsc::UnboundedReceiver<ManagerEvent> {
        let (tx, rx) = mpsc::unbounded_channel();
        self.subscribers.lock().expect("subscribers poisoned").push(tx);
        rx
    }

    pub async fn selected_instance_id(&self) -> String {
        self.inner.lock().await.workspace.selected_instance_id.clone()
    }

    pub async fn select(&self, id: &str) -> Result<(), String> {
        let mut inner = self.inner.lock().await;
        require_instance(&inner.workspace, id)?;
        inner.workspace.selected_instance_id = id.to_string();
        self.persist(&inner).await
    }

    pub async fn list(&self) -> Vec<ProxyInstanceSummary> {
        let inner = self.inner.lock().await;
        inner.workspace.instances.iter().map(|instance| summary(&inner, instance)).collect()
    }

    pub async fn create(&self) -> Result<ProxyInstanceSummary, String> {
        let mut inner = self.inner.lock().await;
        let id = new_id(&inner.workspace);
        let mut config = crate::config::create_default_config();
        if let Some(selected) = inner.workspace.instances.iter().find(|instance| instance.id == inner.workspace.selected_instance_id) {
            config.server.bind_host = selected.config.server.bind_host.clone();
        }
        config.server.port = next_port(&inner.workspace);
        if let Some(first) = inner.workspace.instances.first() {
            config.tcp_targets = first.config.tcp_targets.clone();
            config.forwarding_address_history = first.config.forwarding_address_history.clone();
        }
        self.assign_cache_root(&mut config, &id);
        let name = format!("代理实例 {}", inner.workspace.instances.len() + 1);
        inner.workspace.instances.push(ProxyInstance { id: id.clone(), name, config, login_cache: Some(HashMap::new()) });
        inner.workspace.selected_instance_id = id.clone();
        let instance = inner.workspace.instances.iter().find(|instance| instance.id == id).expect("just added").clone();
        let initial_config = runtime_config(&inner.workspace, &instance);
        inner.services.insert(id.clone(), ForwardingService::new(initial_config, id.clone(), self.events.clone()));
        let result = summary(&inner, &instance);
        self.persist(&inner).await?;
        Ok(result)
    }

    pub async fn duplicate(&self) -> Result<ProxyInstanceSummary, String> {
        let mut inner = self.inner.lock().await;
        let source = require_instance(&inner.workspace, &inner.workspace.selected_instance_id)?.clone();
        let id = new_id(&inner.workspace);
        let mut config = source.config.clone();
        config.server.port = next_port(&inner.workspace);
        self.assign_cache_root(&mut config, &id);
        inner.workspace.instances.push(ProxyInstance { id: id.clone(), name: format!("{} 副本", source.name), config, login_cache: Some(HashMap::new()) });
        inner.workspace.selected_instance_id = id.clone();
        let instance = inner.workspace.instances.iter().find(|instance| instance.id == id).expect("just added").clone();
        let initial_config = runtime_config(&inner.workspace, &instance);
        inner.services.insert(id.clone(), ForwardingService::new(initial_config, id.clone(), self.events.clone()));
        let result = summary(&inner, &instance);
        self.persist(&inner).await?;
        Ok(result)
    }

    pub async fn rename(&self, id: &str, name: &str) -> Result<(), String> {
        let normalized = name.trim();
        if normalized.is_empty() {
            return Err("代理名称不能为空".to_string());
        }
        let mut inner = self.inner.lock().await;
        let instance = require_instance_mut(&mut inner.workspace, id)?;
        instance.name = normalized.to_string();
        self.persist(&inner).await
    }

    pub async fn remove(&self, id: &str) -> Result<(), String> {
        let mut inner = self.inner.lock().await;
        if inner.workspace.instances.len() <= 1 {
            return Err("至少保留一个代理实例".to_string());
        }
        require_instance(&inner.workspace, id)?;
        if let Some(mut service) = inner.services.remove(id) {
            service.stop().await?;
        }
        inner.workspace.instances.retain(|instance| instance.id != id);
        if inner.workspace.selected_instance_id == id {
            inner.workspace.selected_instance_id = inner.workspace.instances.first().expect("at least one").id.clone();
        }
        self.persist(&inner).await
    }

    pub async fn get_config(&self, id: Option<&str>) -> Result<AppConfig, String> {
        let mut inner = self.inner.lock().await;
        let id = id.map(str::to_string).unwrap_or_else(|| inner.workspace.selected_instance_id.clone());
        Ok(require_service_mut(&mut inner, &id)?.get_config())
    }

    pub async fn save_config(&self, config: AppConfig) -> Result<(), String> {
        let mut inner = self.inner.lock().await;
        let instance = require_instance(&inner.workspace, &inner.workspace.selected_instance_id)?.clone();
        let runtime_values = runtime_values(&inner.workspace, &instance);
        {
            let service = require_service_mut(&mut inner, &instance.id)?;
            service.save_config(AppConfig { local_values: runtime_values, ..config })?;
        }
        self.sync_instance_config(&mut inner, &instance.id);
        self.persist(&inner).await
    }

    pub async fn start(&self, id: Option<&str>) -> Result<RuntimeStatus, String> {
        let mut inner = self.inner.lock().await;
        let id = id.map(str::to_string).unwrap_or_else(|| inner.workspace.selected_instance_id.clone());
        let instance = require_instance(&inner.workspace, &id)?.clone();
        assert_port_available(&inner, &instance)?;
        require_service_mut(&mut inner, &id)?.start().await
    }

    pub async fn stop(&self, id: Option<&str>) -> Result<RuntimeStatus, String> {
        let mut inner = self.inner.lock().await;
        let id = id.map(str::to_string).unwrap_or_else(|| inner.workspace.selected_instance_id.clone());
        let status = require_service_mut(&mut inner, &id)?.stop().await?;
        self.sync_instance_config(&mut inner, &id);
        Ok(status)
    }

    pub async fn start_all(&self) -> Result<(), String> {
        let mut failures: Vec<String> = Vec::new();
        let ids: Vec<(String, String)> = {
            let inner = self.inner.lock().await;
            inner.workspace.instances.iter().map(|instance| (instance.id.clone(), instance.name.clone())).collect()
        };
        for (id, name) in ids {
            let state = { self.inner.lock().await.services.get(&id).map(|service| service.status().state) };
            if state.as_deref() == Some("running") || state.as_deref() == Some("starting") {
                continue;
            }
            if let Err(error) = self.start(Some(&id)).await {
                failures.push(format!("{name}：{error}"));
            }
        }
        if failures.is_empty() {
            Ok(())
        } else {
            Err(failures.join("；"))
        }
    }

    pub async fn stop_all(&self) {
        let ids: Vec<String> = self.inner.lock().await.services.keys().cloned().collect();
        for id in ids {
            let mut inner = self.inner.lock().await;
            if let Some(service) = inner.services.get_mut(&id) {
                if service.status().state != "stopped" {
                    let _ = service.stop().await;
                }
            }
        }
    }

    pub async fn status(&self, id: Option<&str>) -> Result<RuntimeStatus, String> {
        let inner = self.inner.lock().await;
        let id = id.map(str::to_string).unwrap_or_else(|| inner.workspace.selected_instance_id.clone());
        Ok(require_service(&inner, &id)?.status())
    }

    pub async fn get_logs(&self, id: Option<&str>) -> Result<Vec<LogEntry>, String> {
        let inner = self.inner.lock().await;
        let id = id.map(str::to_string).unwrap_or_else(|| inner.workspace.selected_instance_id.clone());
        Ok(require_service(&inner, &id)?.get_logs())
    }

    pub async fn clear_logs(&self, id: Option<&str>) -> Result<(), String> {
        let inner = self.inner.lock().await;
        let id = id.map(str::to_string).unwrap_or_else(|| inner.workspace.selected_instance_id.clone());
        require_service(&inner, &id)?.clear_logs();
        Ok(())
    }

    pub async fn get_shared_values(&self) -> HashMap<String, String> {
        self.inner.lock().await.workspace.shared_values.clone().unwrap_or_default()
    }

    pub async fn save_shared_values(&self, values: HashMap<String, String>) -> Result<(), String> {
        let mut inner = self.inner.lock().await;
        inner.workspace.shared_values = Some(values);
        let ids: Vec<String> = inner.workspace.instances.iter().map(|instance| instance.id.clone()).collect();
        for id in ids {
            apply_runtime_values(&mut inner, &id);
        }
        drop(inner);
        self.notify_values_changed();
        let inner = self.inner.lock().await;
        self.persist(&inner).await
    }

    pub async fn apply_forwarding_targets(&self, targets: Vec<TcpTargetConfig>, id: Option<&str>) -> Result<(), String> {
        let inner = self.inner.lock().await;
        let id = id.map(str::to_string).unwrap_or_else(|| inner.workspace.selected_instance_id.clone());
        require_service(&inner, &id)?.apply_tcp_targets(targets);
        Ok(())
    }

    pub async fn get_login_cache(&self, id: Option<&str>) -> Result<HashMap<String, String>, String> {
        let inner = self.inner.lock().await;
        let id = id.map(str::to_string).unwrap_or_else(|| inner.workspace.selected_instance_id.clone());
        Ok(require_instance(&inner.workspace, &id)?.login_cache.clone().unwrap_or_default())
    }

    pub async fn save_login_cache(&self, values: HashMap<String, String>, id: Option<&str>) -> Result<(), String> {
        let mut inner = self.inner.lock().await;
        let id = id.map(str::to_string).unwrap_or_else(|| inner.workspace.selected_instance_id.clone());
        let instance = require_instance_mut(&mut inner.workspace, &id)?;
        instance.login_cache = Some(values);
        apply_runtime_values(&mut inner, &id);
        drop(inner);
        self.notify_values_changed();
        let inner = self.inner.lock().await;
        self.persist(&inner).await
    }

    pub async fn merge_login_cache(&self, values: HashMap<String, String>, id: Option<&str>) -> Result<(), String> {
        let mut inner = self.inner.lock().await;
        let id = id.map(str::to_string).unwrap_or_else(|| inner.workspace.selected_instance_id.clone());
        let instance = require_instance_mut(&mut inner.workspace, &id)?;
        instance.login_cache.get_or_insert_with(HashMap::new).extend(values);
        apply_runtime_values(&mut inner, &id);
        drop(inner);
        self.notify_values_changed();
        let inner = self.inner.lock().await;
        self.persist(&inner).await
    }

    pub async fn get_stored_values(&self, id: Option<&str>) -> Result<StoredValues, String> {
        let mut inner = self.inner.lock().await;
        let id = id.map(str::to_string).unwrap_or_else(|| inner.workspace.selected_instance_id.clone());
        let config = require_service_mut(&mut inner, &id)?.get_config();
        Ok(StoredValues {
            map_values: config.map_values.clone(),
            file_values: config.legacy.as_ref().map(|legacy| legacy.files.iter().filter_map(|(key, value)| value.as_str().map(|text| (key.clone(), text.to_string()))).collect()).unwrap_or_default(),
        })
    }

    pub async fn save_stored_values(&self, stored: StoredValues, id: Option<&str>) -> Result<(), String> {
        let mut inner = self.inner.lock().await;
        let id = id.map(str::to_string).unwrap_or_else(|| inner.workspace.selected_instance_id.clone());
        require_service_mut(&mut inner, &id)?.set_stored_values(&stored);
        drop(inner);
        self.notify_values_changed();
        Ok(())
    }

    fn assign_cache_root(&self, config: &mut AppConfig, id: &str) {
        if let Some(root) = self.default_cache_root.as_ref() {
            config.cache.root_dir = format!("{root}/{id}");
        } else if !config.cache.root_dir.is_empty() {
            config.cache.root_dir = format!("{}-{id}", config.cache.root_dir);
        }
    }

    fn notify_values_changed(&self) {
        let subscribers = self.subscribers.lock().expect("subscribers poisoned");
        for subscriber in subscribers.iter() {
            let _ = subscriber.send(ManagerEvent::ValuesChanged);
        }
    }

    /// 把运行中服务的实时配置（含捕获值）同步回工作区实例（localValues 剥离）。
    fn sync_instance_config(&self, inner: &mut ManagerInner, id: &str) {
        let config = inner.services.get_mut(id).map(|service| service.get_config());
        if let Some(config) = config {
            if let Some(instance) = inner.workspace.instances.iter_mut().find(|candidate| candidate.id == id) {
                instance.config = AppConfig { local_values: HashMap::new(), ..config };
            }
        }
    }

    async fn persist(&self, inner: &ManagerInner) -> Result<(), String> {
        self.workspace_store.save(&inner.workspace).await.map_err(|error| error.0)
    }
}

fn require_instance<'a>(workspace: &'a ProxyWorkspace, id: &str) -> Result<&'a ProxyInstance, String> {
    workspace.instances.iter().find(|instance| instance.id == id).ok_or_else(|| "代理实例不存在".to_string())
}

fn require_instance_mut<'a>(workspace: &'a mut ProxyWorkspace, id: &str) -> Result<&'a mut ProxyInstance, String> {
    workspace.instances.iter_mut().find(|instance| instance.id == id).ok_or_else(|| "代理实例不存在".to_string())
}

fn require_service<'a>(inner: &'a ManagerInner, id: &str) -> Result<&'a ForwardingService, String> {
    inner.services.get(id).ok_or_else(|| "代理实例不存在".to_string())
}

fn require_service_mut<'a>(inner: &'a mut ManagerInner, id: &str) -> Result<&'a mut ForwardingService, String> {
    inner.services.get_mut(id).ok_or_else(|| "代理实例不存在".to_string())
}

fn runtime_values(workspace: &ProxyWorkspace, instance: &ProxyInstance) -> HashMap<String, String> {
    let mut values = workspace.shared_values.clone().unwrap_or_default();
    values.extend(instance.login_cache.clone().unwrap_or_default());
    values
}

fn runtime_config(workspace: &ProxyWorkspace, instance: &ProxyInstance) -> AppConfig {
    AppConfig { local_values: runtime_values(workspace, instance), ..instance.config.clone() }
}

fn apply_runtime_values(inner: &mut ManagerInner, instance_id: &str) {
    let Some(instance) = inner.workspace.instances.iter().find(|instance| instance.id == instance_id) else { return };
    let values = runtime_values(&inner.workspace, instance);
    if let Some(service) = inner.services.get_mut(instance_id) {
        service.set_runtime_values(values);
    }
}

fn normalize_workspace(workspace: ProxyWorkspace) -> ProxyWorkspace {
    ProxyWorkspace {
        version: 1,
        selected_instance_id: workspace.selected_instance_id,
        shared_values: Some(workspace.shared_values.unwrap_or_default()),
        instances: workspace
            .instances
            .into_iter()
            .map(|mut instance| {
                let login_cache = instance.login_cache.take().unwrap_or_else(|| instance.config.local_values.clone());
                instance.config.local_values = HashMap::new();
                instance.login_cache = Some(login_cache);
                instance
            })
            .collect(),
    }
}

fn is_wildcard_host(host: &str) -> bool {
    host == "0.0.0.0" || host == "::" || host == "[::]"
}

fn hosts_conflict(left: &str, right: &str) -> bool {
    left == right || is_wildcard_host(left) || is_wildcard_host(right)
}

fn assert_port_available(inner: &ManagerInner, instance: &ProxyInstance) -> Result<(), String> {
    for other in &inner.workspace.instances {
        if other.id == instance.id {
            continue;
        }
        let Some(service) = inner.services.get(&other.id) else { continue };
        let state = service.status().state;
        if (state == "running" || state == "starting") && other.config.server.port == instance.config.server.port && hosts_conflict(&other.config.server.bind_host, &instance.config.server.bind_host) {
            return Err(format!("端口 {} 已被{}占用", instance.config.server.port, other.name));
        }
    }
    Ok(())
}

fn next_port(workspace: &ProxyWorkspace) -> u16 {
    let ports: Vec<u16> = workspace.instances.iter().map(|instance| instance.config.server.port).collect();
    let mut candidate = if ports.is_empty() { 8080 } else { ports.iter().max().copied().unwrap_or(8080).max(8080) + 1 };
    while ports.contains(&candidate) {
        candidate += 1;
    }
    candidate
}

fn new_id(workspace: &ProxyWorkspace) -> String {
    loop {
        let id = format!("proxy-{}", uuid::Uuid::new_v4());
        if !workspace.instances.iter().any(|instance| instance.id == id) {
            return id;
        }
    }
}

const CARD_TARGET_LABELS: [&str; 3] = ["hq", "jy", "zx"];

fn card_target_for_config(config: &AppConfig) -> Option<String> {
    if let Some(card_target_id) = config.card_target_id.as_deref() {
        let index = config.tcp_targets.iter().position(|target| target.id == card_target_id)?;
        let target = &config.tcp_targets[index];
        return Some(format!("{} {}:{}", CARD_TARGET_LABELS.get(index).copied().unwrap_or(&target.name), target.host, target.port));
    }
    config.tcp_targets.get(2).map(|zx| format!("zx {}:{}", zx.host, zx.port))
}

fn target_for_config(config: &AppConfig) -> String {
    let jy = config.tcp_targets.iter().find(|target| target.id.eq_ignore_ascii_case("jy") || target.name.eq_ignore_ascii_case("jy"));
    let target = jy.or_else(|| config.tcp_targets.get(1)).or_else(|| config.tcp_targets.first());
    if let Some(target) = target {
        return format!("{}:{}", target.host, target.port);
    }
    config.http_rules.iter().find(|rule| rule.enabled).or_else(|| config.http_rules.first()).map(|rule| rule.target.clone()).unwrap_or_else(|| "未配置".to_string())
}

fn summary(inner: &ManagerInner, instance: &ProxyInstance) -> ProxyInstanceSummary {
    let config = &instance.config;
    ProxyInstanceSummary {
        id: instance.id.clone(),
        name: instance.name.clone(),
        selected: instance.id == inner.workspace.selected_instance_id,
        bind_host: config.server.bind_host.clone(),
        port: config.server.port,
        target: target_for_config(config),
        card_target: card_target_for_config(config),
        login_cache_count: instance.login_cache.as_ref().map(|cache| cache.len()).unwrap_or(0),
        status: inner.services.get(&instance.id).map(|service| service.status()).unwrap_or(RuntimeStatus { state: "stopped".to_string(), request_count: 0, tcp_connections: 0, error: None }),
    }
}
