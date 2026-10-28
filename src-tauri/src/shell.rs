use crate::config::{AppConfig, EncryptionPreferencesPatch, StoredValues, TcpTargetConfig};
use crate::config_store::ConfigStore;
use crate::encrypt_prefs::{read_encryption_preferences, save_encryption_preferences};
use crate::encryptor::{encrypt_directory, EncryptDirectoryOptions};
use crate::manual_request::{extract_manual_login_values, send_manual_request, ManualRequestOptions};
use crate::service_manager::{ForwardingServiceManager, ManagerEvent};
use crate::updater::{TauriUpdateBackend, UpdateService};
use crate::validation::{get_manual_request_config_validation_error, is_valid_app_config, is_valid_tcp_target_list};
use crate::workspace_store::ProxyWorkspaceStore;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::pin::Pin;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;
use tokio::sync::mpsc;

pub struct AppState {
    manager: Arc<ForwardingServiceManager>,
    user_data: PathBuf,
    encoder_path: PathBuf,
    version: String,
    updater: Arc<UpdateService>,
}

/// 与 Electron 版共享同一数据目录，老用户配置无缝迁移
fn legacy_data_dir() -> Result<PathBuf, String> {
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var_os("HOME").ok_or("HOME is not set")?;
        Ok(PathBuf::from(home).join("Library/Application Support/local-forwarder"))
    }
    #[cfg(target_os = "windows")]
    {
        let appdata = std::env::var_os("APPDATA").ok_or("APPDATA is not set")?;
        Ok(PathBuf::from(appdata).join("local-forwarder"))
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let home = std::env::var_os("HOME").ok_or("HOME is not set")?;
        Ok(PathBuf::from(home).join(".local-forwarder"))
    }
}

fn encoder_path() -> Result<PathBuf, String> {
    let protocol = crate::codec::protocol_directory().map_err(|error| error.0)?;
    let name = if cfg!(target_os = "macos") {
        "h5encode-mac-amd64"
    } else if cfg!(target_os = "windows") {
        "h5encode-win-x86.exe"
    } else {
        return Err(format!("Unsupported encryption encoder platform: {}", std::env::consts::OS));
    };
    Ok(protocol.join("encode").join(name))
}

fn err_value(message: impl Into<String>) -> Value {
    json!({ "ok": false, "error": message.into() })
}

fn value_to_string_map(value: &Value) -> Option<HashMap<String, String>> {
    let record = value.as_object()?;
    let mut output = HashMap::new();
    for (key, entry) in record {
        output.insert(key.clone(), entry.as_str()?.to_string());
    }
    Some(output)
}

#[tauri::command]
async fn get_config(state: State<'_, Arc<AppState>>) -> Result<Value, String> {
    let config = state.manager.get_config(None).await?;
    serde_json::to_value(config).map_err(|error| error.to_string())
}

#[tauri::command]
fn get_app_version(state: State<'_, Arc<AppState>>) -> String {
    state.version.clone()
}

#[tauri::command]
async fn get_update_state(state: State<'_, Arc<AppState>>) -> Result<Value, String> {
    Ok(json!(state.updater.get_state().await))
}

#[tauri::command]
async fn check_for_updates(state: State<'_, Arc<AppState>>) -> Result<Value, String> {
    if !state.updater.is_active() {
        return Ok(json!({ "ok": true, "skipped": true }));
    }
    let result = state.updater.check().await;
    Ok(json!({ "ok": result.ok, "error": result.error }))
}

#[tauri::command]
async fn download_update(state: State<'_, Arc<AppState>>) -> Result<Value, String> {
    if !state.updater.is_active() {
        return Ok(json!({ "ok": true, "skipped": true }));
    }
    let result = state.updater.download().await;
    Ok(json!({ "ok": result.ok, "error": result.error }))
}

#[tauri::command]
async fn install_update(state: State<'_, Arc<AppState>>) -> Result<Value, String> {
    if !state.updater.is_active() {
        return Ok(json!({ "ok": true, "skipped": true }));
    }
    let result = state.updater.install().await;
    Ok(json!({ "ok": result.ok, "error": result.error }))
}

#[tauri::command]
async fn save_config(state: State<'_, Arc<AppState>>, config: Value) -> Result<Value, String> {
    if !is_valid_app_config(&config) {
        return Ok(err_value("Invalid configuration payload"));
    }
    let config: AppConfig = serde_json::from_value(config).map_err(|error| error.to_string())?;
    match state.manager.save_config(config).await {
        Ok(()) => Ok(json!({ "ok": true })),
        Err(error) => Ok(err_value(error)),
    }
}

#[tauri::command]
async fn get_shared_values(state: State<'_, Arc<AppState>>) -> Result<Value, String> {
    Ok(json!(state.manager.get_shared_values().await))
}

#[tauri::command]
async fn save_shared_values(state: State<'_, Arc<AppState>>, values: Value) -> Result<Value, String> {
    let Some(values) = value_to_string_map(&values) else { return Ok(err_value("本地变量格式无效")) };
    match state.manager.save_shared_values(values).await {
        Ok(()) => Ok(json!({ "ok": true })),
        Err(error) => Ok(err_value(error)),
    }
}

#[tauri::command]
async fn get_login_cache(state: State<'_, Arc<AppState>>) -> Result<Value, String> {
    Ok(json!(state.manager.get_login_cache(None).await?))
}

#[tauri::command]
async fn save_login_cache(state: State<'_, Arc<AppState>>, values: Value) -> Result<Value, String> {
    let Some(values) = value_to_string_map(&values) else { return Ok(err_value("登录缓存格式无效")) };
    match state.manager.save_login_cache(values, None).await {
        Ok(()) => Ok(json!({ "ok": true })),
        Err(error) => Ok(err_value(error)),
    }
}

#[tauri::command]
async fn save_stored_values(state: State<'_, Arc<AppState>>, values: Value) -> Result<Value, String> {
    let Some(map_values) = values.get("mapValues").and_then(value_to_string_map) else { return Ok(err_value("缓存格式无效")) };
    let Some(file_values) = values.get("fileValues").and_then(value_to_string_map) else { return Ok(err_value("缓存格式无效")) };
    match state.manager.save_stored_values(StoredValues { map_values, file_values }, None).await {
        Ok(()) => Ok(json!({ "ok": true })),
        Err(error) => Ok(err_value(error)),
    }
}

#[tauri::command]
async fn apply_forwarding_targets(state: State<'_, Arc<AppState>>, targets: Value) -> Result<Value, String> {
    if !is_valid_tcp_target_list(&targets) {
        return Ok(err_value("转发地址无效"));
    }
    let targets: Vec<TcpTargetConfig> = serde_json::from_value(targets).map_err(|error| error.to_string())?;
    match state.manager.apply_forwarding_targets(targets, None).await {
        Ok(()) => Ok(json!({ "ok": true })),
        Err(error) => Ok(err_value(error)),
    }
}

#[tauri::command]
async fn list_proxy_instances(state: State<'_, Arc<AppState>>) -> Result<Value, String> {
    Ok(json!(state.manager.list().await))
}

#[tauri::command]
async fn select_proxy_instance(state: State<'_, Arc<AppState>>, id: String) -> Result<Value, String> {
    if id.is_empty() {
        return Ok(err_value("代理实例参数无效"));
    }
    match state.manager.select(&id).await {
        Ok(()) => Ok(json!({ "ok": true, "instanceId": id })),
        Err(error) => Ok(err_value(error)),
    }
}

#[tauri::command]
async fn create_proxy_instance(state: State<'_, Arc<AppState>>) -> Result<Value, String> {
    match state.manager.create().await {
        Ok(instance) => Ok(json!({ "ok": true, "instance": instance })),
        Err(error) => Ok(err_value(error)),
    }
}

#[tauri::command]
async fn duplicate_proxy_instance(state: State<'_, Arc<AppState>>) -> Result<Value, String> {
    match state.manager.duplicate().await {
        Ok(instance) => Ok(json!({ "ok": true, "instance": instance })),
        Err(error) => Ok(err_value(error)),
    }
}

#[tauri::command]
async fn rename_proxy_instance(state: State<'_, Arc<AppState>>, id: String, name: String) -> Result<Value, String> {
    if id.is_empty() {
        return Ok(err_value("代理名称参数无效"));
    }
    match state.manager.rename(&id, &name).await {
        Ok(()) => Ok(json!({ "ok": true })),
        Err(error) => Ok(err_value(error)),
    }
}

#[tauri::command]
async fn delete_proxy_instance(state: State<'_, Arc<AppState>>, id: String) -> Result<Value, String> {
    if id.is_empty() {
        return Ok(err_value("代理实例参数无效"));
    }
    match state.manager.remove(&id).await {
        Ok(()) => Ok(json!({ "ok": true })),
        Err(error) => Ok(err_value(error)),
    }
}

#[tauri::command]
fn select_project_directory(app: AppHandle) -> Value {
    let picked = app.dialog().file().blocking_pick_folder();
    match picked.and_then(|path| path.as_path().map(|path| path.to_string_lossy().into_owned())) {
        Some(path) => json!({ "ok": true, "path": path }),
        None => json!({ "ok": false, "canceled": true }),
    }
}

#[tauri::command]
async fn select_encryption_directory(state: State<'_, Arc<AppState>>, app: AppHandle, kind: String) -> Result<Value, String> {
    if kind != "input" && kind != "output" {
        return Ok(err_value("目录类型无效"));
    }
    let picked = app.dialog().file().blocking_pick_folder();
    let Some(path) = picked.and_then(|path| path.as_path().map(|path| path.to_string_lossy().into_owned())) else {
        return Ok(json!({ "ok": false, "canceled": true }));
    };
    let patch = if kind == "input" {
        EncryptionPreferencesPatch { input_dir: Some(path.clone()), output_dir: None }
    } else {
        EncryptionPreferencesPatch { input_dir: None, output_dir: Some(path.clone()) }
    };
    match save_encryption_preferences(&state.user_data.join("encryption-preferences.json"), &patch).await {
        Ok(preferences) => Ok(json!({ "ok": true, "path": path, "preferences": preferences })),
        Err(error) => Ok(err_value(error)),
    }
}

#[tauri::command]
async fn get_encryption_preferences(state: State<'_, Arc<AppState>>) -> Result<Value, String> {
    let preferences = read_encryption_preferences(&state.user_data.join("encryption-preferences.json")).await.unwrap_or_default();
    Ok(json!(preferences))
}

#[tauri::command]
async fn save_encryption_preferences_cmd(state: State<'_, Arc<AppState>>, patch: Value) -> Result<Value, String> {
    let Some(object) = patch.as_object() else { return Ok(err_value("加密目录参数无效")) };
    if object.keys().any(|key| key != "inputDir" && key != "outputDir") {
        return Ok(err_value("加密目录参数无效"));
    }
    let patch: EncryptionPreferencesPatch = serde_json::from_value(patch).map_err(|error| error.to_string())?;
    match save_encryption_preferences(&state.user_data.join("encryption-preferences.json"), &patch).await {
        Ok(preferences) => Ok(json!({ "ok": true, "preferences": preferences })),
        Err(error) => Ok(err_value(error)),
    }
}

#[tauri::command]
async fn encrypt_directory_cmd(state: State<'_, Arc<AppState>>, app: AppHandle, input_dir: String, output_dir: String, mode: String) -> Result<Value, String> {
    if input_dir.is_empty() || output_dir.is_empty() {
        return Ok(err_value("请选择加密前和加密后文件夹目录"));
    }
    if mode != "full" && mode != "incremental" {
        return Ok(err_value("加密模式无效"));
    }
    let handle = app.clone();
    let on_progress = move |progress| {
        let _ = handle.emit("encryption:progress", progress);
    };
    let outcome = encrypt_directory(EncryptDirectoryOptions {
        input_dir: std::path::Path::new(&input_dir),
        output_dir: std::path::Path::new(&output_dir),
        encoder_path: &state.encoder_path,
        encoder_args: &[],
        mode: &mode,
        state_path: None,
        temp_root: None,
        on_progress: Some(&on_progress),
    })
    .await;
    match outcome {
        Ok(result) => {
            let mut envelope = serde_json::to_value(result).map_err(|error| error.to_string())?;
            envelope.as_object_mut().expect("result object").insert("ok".to_string(), Value::Bool(true));
            Ok(envelope)
        }
        Err(error) => Ok(err_value(error.0)),
    }
}

#[tauri::command]
async fn send_request(state: State<'_, Arc<AppState>>, payload: Value) -> Result<Value, String> {
    if let Some(field) = get_manual_request_config_validation_error(&payload) {
        return Ok(err_value(format!("Invalid request payload: {field}")));
    }
    let timeout_ms = state.manager.get_config(None).await?.server.timeout_ms;
    let options = ManualRequestOptions {
        host: payload.get("host").and_then(Value::as_str).unwrap_or_default().to_string(),
        port: payload.get("port").and_then(Value::as_u64).unwrap_or_default() as u16,
        params_text: payload.get("paramsText").and_then(Value::as_str).unwrap_or_default().to_string(),
        timeout: std::time::Duration::from_millis(timeout_ms),
        transport: payload.get("transport").and_then(Value::as_str).map(str::to_string),
    };
    match send_manual_request(&options).await {
        Ok(result) => {
            if let Some(values) = extract_manual_login_values(&options.params_text, &result.body) {
                let _ = state.manager.merge_login_cache(values, None).await;
            }
            Ok(json!({ "ok": true, "statusCode": result.status_code, "statusMessage": result.status_message, "body": result.body, "durationMs": result.duration_ms }))
        }
        Err(error) => Ok(err_value(error)),
    }
}

#[tauri::command]
async fn start(state: State<'_, Arc<AppState>>, id: Option<String>) -> Result<Value, String> {
    state.manager.start(id.as_deref()).await.map(|status| json!(status))
}

#[tauri::command]
async fn stop(state: State<'_, Arc<AppState>>, id: Option<String>) -> Result<Value, String> {
    state.manager.stop(id.as_deref()).await.map(|status| json!(status))
}

#[tauri::command]
async fn start_all(state: State<'_, Arc<AppState>>) -> Result<Value, String> {
    match state.manager.start_all().await {
        Ok(()) => Ok(json!({ "ok": true })),
        Err(error) => Ok(err_value(error)),
    }
}

#[tauri::command]
async fn stop_all(state: State<'_, Arc<AppState>>) -> Result<Value, String> {
    state.manager.stop_all().await;
    Ok(json!({ "ok": true }))
}

#[tauri::command]
async fn status(state: State<'_, Arc<AppState>>, id: Option<String>) -> Result<Value, String> {
    state.manager.status(id.as_deref()).await.map(|status| json!(status))
}

#[tauri::command]
async fn logs(state: State<'_, Arc<AppState>>, id: Option<String>) -> Result<Value, String> {
    state.manager.get_logs(id.as_deref()).await.map(|entries| json!(entries))
}

#[tauri::command]
async fn clear_logs(state: State<'_, Arc<AppState>>, id: Option<String>) -> Result<Value, String> {
    state.manager.clear_logs(id.as_deref()).await?;
    Ok(json!({ "ok": true }))
}

#[tauri::command]
async fn open_external(app: AppHandle, url: String) -> Result<Value, String> {
    let Ok(parsed) = url::Url::parse(&url) else { return Ok(err_value("地址无效")) };
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Ok(err_value("仅支持 http/https 地址"));
    }
    match app.opener().open_url(url, None::<&str>) {
        Ok(()) => Ok(json!({ "ok": true })),
        Err(error) => Ok(err_value(error.to_string())),
    }
}

struct Bootstrap {
    manager: Arc<ForwardingServiceManager>,
    user_data: PathBuf,
    encoder_path: PathBuf,
    version: String,
}

async fn setup_state() -> Result<Bootstrap, String> {
    let user_data = legacy_data_dir()?;
    let config_store = Arc::new(ConfigStore::new(user_data.join("config.json")));
    let workspace_store = Arc::new(ProxyWorkspaceStore::new(user_data.join("proxy-instances.json")));
    let workspace = workspace_store
        .load(|| {
            let store = config_store.clone();
            let user_data = user_data.clone();
            async move {
                let mut config = match store.load().await {
                    Ok(config) => config,
                    Err(_) => {
                        let config = crate::config::create_default_config();
                        store.save(&config).await.map_err(|error| crate::workspace_store::WorkspaceError(error.to_string()))?;
                        config
                    }
                };
                if config.cache.root_dir.is_empty() {
                    config.cache.root_dir = user_data.join("cache").join("default").to_string_lossy().into_owned();
                }
                Ok(config)
            }
        })
        .await
        .map_err(|error| error.0)?;
    let manager = ForwardingServiceManager::new(workspace, workspace_store, Some(user_data.join("cache").to_string_lossy().into_owned()));
    Ok(Bootstrap {
        manager,
        encoder_path: encoder_path()?,
        user_data,
        version: env!("CARGO_PKG_VERSION").to_string(),
    })
}

fn spawn_values_bridge(app: &AppHandle, manager: Arc<ForwardingServiceManager>) {
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut events = manager.subscribe();
        while let Some(ManagerEvent::ValuesChanged) = events.recv().await {
            let stored = manager.get_stored_values(None).await.unwrap_or(StoredValues { map_values: HashMap::new(), file_values: HashMap::new() });
            let payload = json!({
                "sharedValues": manager.get_shared_values().await,
                "loginCache": manager.get_login_cache(None).await.unwrap_or_default(),
                "mapValues": stored.map_values,
                "fileValues": stored.file_values,
            });
            let _ = handle.emit("values:changed", payload);
        }
    });
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            get_config,
            get_app_version,
            get_update_state,
            check_for_updates,
            download_update,
            install_update,
            save_config,
            get_shared_values,
            save_shared_values,
            get_login_cache,
            save_login_cache,
            save_stored_values,
            apply_forwarding_targets,
            list_proxy_instances,
            select_proxy_instance,
            create_proxy_instance,
            duplicate_proxy_instance,
            rename_proxy_instance,
            delete_proxy_instance,
            select_project_directory,
            select_encryption_directory,
            get_encryption_preferences,
            save_encryption_preferences_cmd,
            encrypt_directory_cmd,
            send_request,
            start,
            stop,
            start_all,
            stop_all,
            status,
            logs,
            clear_logs,
            open_external,
        ])
        .on_window_event(|window, event| {
            // macOS 驻留行为：关窗=隐藏，App 留在 Dock；退出走 Cmd+Q
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .setup(|app| {
            let bootstrap = tauri::async_runtime::block_on(setup_state()).map_err(Box::<dyn std::error::Error>::from)?;
            let manager = bootstrap.manager.clone();
            let (publish_tx, mut publish_rx) = mpsc::unbounded_channel::<crate::config::UpdateState>();
            let manager_for_stop = manager.clone();
            let updater = UpdateService::new(
                bootstrap.version.clone(),
                true,
                Arc::new(TauriUpdateBackend::new(app.handle().clone())),
                Arc::new(move || {
                    let manager = manager_for_stop.clone();
                    Box::pin(async move {
                        manager.stop_all().await;
                        let instances = manager.list().await;
                        if instances.iter().all(|summary| summary.status.state == "stopped") {
                            Ok(())
                        } else {
                            Err("代理未完全停止".to_string())
                        }
                    }) as Pin<Box<dyn std::future::Future<Output = Result<(), String>> + Send>>
                }),
                publish_tx,
            );
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                while let Some(state) = publish_rx.recv().await {
                    let _ = handle.emit("update:state", state);
                }
            });
            updater.start_background_check();
            app.manage(Arc::new(AppState { manager: bootstrap.manager.clone(), user_data: bootstrap.user_data, encoder_path: bootstrap.encoder_path, version: bootstrap.version, updater }));
            spawn_values_bridge(app.handle(), manager);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building the Tauri application")
        .run(|app_handle, event| match event {
            tauri::RunEvent::Exit => {
                let state = app_handle.state::<Arc<AppState>>();
                let manager = state.manager.clone();
                tauri::async_runtime::block_on(async move { manager.stop_all().await });
            }
            tauri::RunEvent::Reopen { .. } => match app_handle.get_webview_window("main") {
                Some(window) => {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
                None => {
                    let _ = tauri::WebviewWindowBuilder::new(app_handle, "main", tauri::WebviewUrl::App("index.html".into()))
                        .title("Local Forwarder")
                        .inner_size(1200.0, 760.0)
                        .build();
                }
            }
            _ => {}
        });
}
