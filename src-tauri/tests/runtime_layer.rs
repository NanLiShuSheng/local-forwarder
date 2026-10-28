use forwarder_core::config::{create_default_config, EncryptionPreferencesPatch, StoredValues};
use forwarder_core::config_store::{export_internal_json, parse_internal_json, ConfigStore};
use forwarder_core::encrypt_prefs::{read_encryption_preferences, save_encryption_preferences};
use forwarder_core::encryptor::{encrypt_directory, EncryptDirectoryOptions};
use forwarder_core::local_cache::{format_local_cache_text, parse_local_cache_text};
use forwarder_core::manual_request::{extract_manual_login_values, format_tzt_response, parse_manual_request_params, send_manual_request, ManualRequestOptions};
use forwarder_core::service_manager::{ForwardingServiceManager, ManagerEvent};
use forwarder_core::workspace_store::{create_default_workspace, ProxyWorkspaceStore};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::time::Duration;

#[test]
fn validation_accepts_the_default_config() {
    let value = serde_json::to_value(create_default_config()).unwrap();
    assert!(forwarder_core::validation::is_valid_app_config(&value));
}

#[test]
fn validation_pinpoints_bad_fields() {
    let mut value = serde_json::to_value(create_default_config()).unwrap();
    value["server"]["port"] = json!(70000);
    assert_eq!(forwarder_core::validation::get_app_config_validation_error(&value).as_deref(), Some("server.port"));
    let mut value = serde_json::to_value(create_default_config()).unwrap();
    value["bogus"] = json!(1);
    assert_eq!(forwarder_core::validation::get_app_config_validation_error(&value).as_deref(), Some("root"));
    let mut value = serde_json::to_value(create_default_config()).unwrap();
    value["tcpTargets"][0]["basePath"] = json!("relative");
    assert_eq!(forwarder_core::validation::get_app_config_validation_error(&value).as_deref(), Some("tcpTargets[0].basePath"));
    let mut value = serde_json::to_value(create_default_config()).unwrap();
    value["requestHistory"] = json!(["127.0.0.1:8080", ""]);
    assert_eq!(forwarder_core::validation::get_app_config_validation_error(&value).as_deref(), Some("requestHistory[1]"));
}

#[tokio::test]
async fn config_store_roundtrips_and_rejects_corruption() {
    let dir = tempfile::tempdir().unwrap();
    let store = ConfigStore::new(dir.path().join("internal.json"));
    let mut config = create_default_config();
    config.server.port = 45142;
    store.save(&config).await.unwrap();
    let loaded = store.load().await.unwrap();
    assert_eq!(loaded.server.port, 45142);
    assert!(loaded.legacy.is_some());

    std::fs::write(dir.path().join("internal.json"), "{ not json").unwrap();
    assert!(store.load().await.is_err());
}

#[test]
fn internal_json_enforces_size_limits() {
    let config = create_default_config();
    let exported = export_internal_json(&config).unwrap();
    assert!(exported.ends_with('\n'));
    let parsed = parse_internal_json(&exported, "internal.json").unwrap();
    assert_eq!(parsed.server.port, 8080);
}

#[tokio::test]
async fn workspace_store_creates_default_then_roundtrips() {
    let dir = tempfile::tempdir().unwrap();
    let store = ProxyWorkspaceStore::new(dir.path().join("workspace.json"));
    let loaded = store.load(|| async { Ok(create_default_config()) }).await.unwrap();
    assert_eq!(loaded.instances.len(), 1);
    assert_eq!(loaded.instances[0].id, "default");
    let again = store.load(|| async { Ok(create_default_config()) }).await.unwrap();
    assert_eq!(again.selected_instance_id, "default");
}

#[test]
fn local_cache_parses_continuation_lines() {
    let values = parse_local_cache_text("TOKEN = abc\ncontinued line\n\nOTHER = 1").unwrap();
    assert_eq!(values.get("TOKEN").map(String::as_str), Some("abc\ncontinued line"));
    assert_eq!(values.get("OTHER").map(String::as_str), Some("1"));
    assert!(parse_local_cache_text("no separator here").is_err());
    assert_eq!(format_local_cache_text(&HashMap::from([("A".to_string(), "1".to_string())])), "A = 1");
}

#[test]
fn manual_request_params_parse_and_validate() {
    let params = parse_manual_request_params("; comment\nAction=100\n name = value ").unwrap();
    assert_eq!(params.get("Action").and_then(Value::as_str), Some("100"));
    assert_eq!(params.get("name").and_then(Value::as_str), Some("value"));
    assert!(parse_manual_request_params("missing-separator").is_err());
    assert!(parse_manual_request_params("=nokey").is_err());
}

#[test]
fn format_tzt_response_filters_wire_metadata_and_renames_grid() {
    let response = serde_json::json!({
        "Action": "100",
        "Grid0": ["row1", "row2"],
        "zzkeyByte": {"0": 1},
        "zzbytes": {"keylen": 1}
    });
    let text = format_tzt_response(response.as_object().unwrap());
    assert_eq!(text, "Action = 100\nGrid = row1\nrow2");
}

#[test]
fn extract_login_values_supports_json_and_text_forms() {
    let json = extract_manual_login_values("Action=100", "{\"Token\":\" t \"}");
    assert_eq!(json.as_ref().and_then(|values| values.get("TOKEN")).map(String::as_str), Some(" t "));
    let text = extract_manual_login_values("Action=100", "TOKEN = abc");
    assert_eq!(text.as_ref().and_then(|values| values.get("TOKEN")).map(String::as_str), Some("abc"));
    assert!(extract_manual_login_values("Action=999", "TOKEN = abc").is_none());
}

#[tokio::test]
async fn manual_request_http_transport_posts_form_to_reqxml() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut buf = Vec::new();
        let mut chunk = [0u8; 1024];
        loop {
            let read = socket.read(&mut chunk).await.unwrap_or(0);
            if read == 0 {
                break;
            }
            buf.extend_from_slice(&chunk[..read]);
            if buf.windows(4).any(|window| window == b"\r\n\r\n") {
                break;
            }
        }
        let body = "ok";
        let response = format!("HTTP/1.1 200 OK\r\ncontent-length: {}\r\n\r\n{}", body.len(), body);
        let _ = socket.write_all(response.as_bytes()).await;
    });
    let result = send_manual_request(&ManualRequestOptions {
        host: "127.0.0.1".to_string(),
        port,
        params_text: "Action=100".to_string(),
        timeout: Duration::from_secs(2),
        transport: Some("http".to_string()),
    })
    .await
    .unwrap();
    assert_eq!(result.status_code, Some(200));
    assert_eq!(result.body, "ok");
}

async fn manager_fixture() -> (tempfile::TempDir, std::sync::Arc<ForwardingServiceManager>) {
    let dir = tempfile::tempdir().unwrap();
    let store = std::sync::Arc::new(ProxyWorkspaceStore::new(dir.path().join("workspace.json")));
    let workspace = create_default_workspace(&create_default_config());
    (dir, ForwardingServiceManager::new(workspace, store, None))
}

#[tokio::test]
async fn manager_create_duplicate_rename_remove_flow() {
    let (_dir, manager) = manager_fixture().await;
    assert_eq!(manager.list().await.len(), 1);

    let created = manager.create().await.unwrap();
    assert_eq!(manager.list().await.len(), 2);
    assert_eq!(manager.selected_instance_id().await, created.id);
    assert!(created.port > 8080);
    assert_eq!(created.name, "代理实例 2");

    let duplicated = manager.duplicate().await.unwrap();
    assert_eq!(duplicated.name, "代理实例 2 副本");
    assert_ne!(duplicated.port, created.port);

    manager.rename(&created.id, "主力").await.unwrap();
    assert!(manager.rename(&created.id, "  ").await.is_err());

    manager.select(&created.id).await.unwrap();
    assert_eq!(manager.selected_instance_id().await, created.id);

    manager.remove(&duplicated.id).await.unwrap();
    assert_eq!(manager.list().await.len(), 2);

    // 持久化生效：重新加载能看到两个实例
    let dir = _dir.path().join("workspace.json");
    let store = ProxyWorkspaceStore::new(dir);
    let reloaded = store.load(|| async { Ok(create_default_config()) }).await.unwrap();
    assert_eq!(reloaded.instances.len(), 2);
    assert_eq!(reloaded.selected_instance_id, created.id);
}

#[tokio::test]
async fn manager_refuses_to_remove_the_last_instance() {
    let (_dir, manager) = manager_fixture().await;
    let only = manager.list().await[0].id.clone();
    assert!(manager.remove(&only).await.is_err());
}

#[tokio::test]
async fn manager_starts_and_stops_a_real_service() {
    let (_dir, manager) = manager_fixture().await;
    // 找一个空闲端口避免与机器上其他服务冲突
    let probe = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let free_port = probe.local_addr().unwrap().port();
    drop(probe);
    let mut config = manager.get_config(None).await.unwrap();
    config.server.port = free_port;
    config.cache.root_dir = _dir.path().join("cache").to_string_lossy().to_string();
    manager.save_config(config).await.unwrap();

    let status = manager.start(None).await.unwrap();
    assert_eq!(status.state, "running");
    let running = manager.status(None).await.unwrap();
    assert_eq!(running.state, "running");
    // 请求页地址/参数改动（request/stringTool）不影响运行中的代理，应当允许热更新
    let mut ui_config = manager.get_config(None).await.unwrap();
    ui_config.request.as_mut().expect("default request").host = "127.0.0.2".to_string();
    manager.save_config(ui_config).await.unwrap();
    let status = manager.stop(None).await.unwrap();
    assert_eq!(status.state, "stopped");
}

#[tokio::test]
async fn manager_detects_port_conflicts_between_running_instances() {
    let (_dir, manager) = manager_fixture().await;
    let probe = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let free_port = probe.local_addr().unwrap().port();
    drop(probe);
    let mut config = manager.get_config(None).await.unwrap();
    config.server.port = free_port;
    config.cache.root_dir = _dir.path().join("cache-a").to_string_lossy().to_string();
    manager.save_config(config).await.unwrap();
    manager.start(None).await.unwrap();

    let second = manager.create().await.unwrap();
    let mut second_config = manager.get_config(Some(&second.id)).await.unwrap();
    second_config.server.port = free_port;
    manager.select(&second.id).await.unwrap();
    manager.save_config(second_config).await.unwrap();
    let failure = manager.start(Some(&second.id)).await.unwrap_err();
    assert!(failure.contains("占用"), "unexpected error: {failure}");
    manager.stop_all().await;
}

#[tokio::test]
async fn manager_notifies_subscribers_on_shared_values_save() {
    let (_dir, manager) = manager_fixture().await;
    let mut events = manager.subscribe();
    manager.save_shared_values(HashMap::from([("TOKEN".to_string(), "x".to_string())])).await.unwrap();
    let event = tokio::time::timeout(Duration::from_secs(2), events.recv()).await.unwrap();
    assert!(matches!(event, Some(ManagerEvent::ValuesChanged)));
    assert_eq!(manager.get_shared_values().await.get("TOKEN").map(String::as_str), Some("x"));
}

#[tokio::test]
async fn encryptor_full_then_incremental_skips_unchanged_files() {
    let dir = tempfile::tempdir().unwrap();
    let input = dir.path().join("input");
    let output = dir.path().join("output");
    std::fs::create_dir_all(&input).unwrap();
    std::fs::write(input.join("a.js"), "console.log(1)").unwrap();
    std::fs::write(input.join("b.css"), "body{}").unwrap();
    // 假编码器：把输入文件内容复制为 <input>.d
    let encoder = dir.path().join("fake-encoder.sh");
    std::fs::write(&encoder, "#!/bin/sh\ncat \"$1\" > \"$1.d\"\n").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&encoder, std::fs::Permissions::from_mode(0o755)).unwrap();
    }

    let first = encrypt_directory(EncryptDirectoryOptions {
        input_dir: &input,
        output_dir: &output,
        encoder_path: &encoder,
        encoder_args: &[],
        mode: "full",
        state_path: None,
        temp_root: None,
        on_progress: None,
    })
    .await
    .unwrap();
    assert_eq!(first.processed_files, 2);
    assert_eq!(std::fs::read_to_string(output.join("a.js.d")).unwrap(), "console.log(1)");

    let second = encrypt_directory(EncryptDirectoryOptions {
        input_dir: &input,
        output_dir: &output,
        encoder_path: &encoder,
        encoder_args: &[],
        mode: "incremental",
        state_path: None,
        temp_root: None,
        on_progress: None,
    })
    .await
    .unwrap();
    assert_eq!(second.skipped_files, 2);
    assert_eq!(second.processed_files, 0);
}

#[tokio::test]
async fn encryption_preferences_roundtrip_with_history() {
    let dir = tempfile::tempdir().unwrap();
    let prefs_path = dir.path().join("prefs.json");
    let saved = save_encryption_preferences(&prefs_path, &EncryptionPreferencesPatch { input_dir: Some(dir.path().to_string_lossy().into_owned()), output_dir: None }).await.unwrap();
    assert_eq!(saved.input_history.len(), 1);
    let loaded = read_encryption_preferences(&prefs_path).await.unwrap();
    assert_eq!(loaded.input_dir, dir.path().to_string_lossy());
    assert_eq!(loaded.input_history.len(), 1);
}

#[tokio::test]
async fn stored_values_flow_through_the_manager() {
    let (_dir, manager) = manager_fixture().await;
    manager
        .save_stored_values(StoredValues { map_values: HashMap::from([("K".to_string(), "V".to_string())]), file_values: HashMap::new() }, None)
        .await
        .unwrap();
    let stored = manager.get_stored_values(None).await.unwrap();
    assert_eq!(stored.map_values.get("K").map(String::as_str), Some("V"));
}
