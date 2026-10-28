use forwarder_core::legacy::{export_legacy_config, import_legacy_config, parse_legacy_config_js, parse_sys_config};
use serde_json::json;
use std::path::PathBuf;

fn fixture_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/legacy")
}

#[tokio::test]
async fn imports_legacy_config_and_normalizes_keys_case_insensitively() {
    let config = import_legacy_config(&fixture_dir()).await.unwrap();
    assert_eq!(config.server.port, 83);
    assert_eq!(config.local_values.get("TOKEN").map(String::as_str), Some("fixture-token"));
    assert_eq!(config.map_values.get("FIXTURE_KEY").map(String::as_str), Some("fixture-value"));
    assert_eq!(config.http_rules[0].match_, "/qdymanage");
    assert_eq!(config.tcp_targets[0].host, "127.0.0.1");
    assert_eq!(config.tcp_targets[0].port, 9100);
    assert_eq!(config.accounts.get("ptjy").and_then(|a| a.get("password")).map(String::as_str), Some("fixture-password"));
    let extra = &config.legacy.as_ref().unwrap().extra;
    assert_eq!(extra.get("unknownfixturefield").and_then(|v| v.as_str()), Some("preserve-me"));
    assert_eq!(extra.get("server.unknown").and_then(|v| v.as_str()), Some("server-preserved"));
    assert_eq!(extra.get("cache.unknown"), Some(&json!({ "value": "cache-preserved" })));
    assert_eq!(extra.get("conifg./qdymanage.unknown_rule").and_then(|v| v.as_str()), Some("rule-preserved"));
    assert_eq!(extra.get("unknownjsonfield"), Some(&json!({ "preserve": true })));
    assert_eq!(
        config.legacy.as_ref().unwrap().files.get("config.json"),
        Some(&json!({ "server": { "port": 83 }, "localValues": { "JSON_VALUE": "fixture-json" }, "unknownJsonField": { "preserve": true } }))
    );
}

#[tokio::test]
async fn imports_generated_local_login_cache() {
    let config = parse_legacy_config_js(
        r#"let _local = "\nTOKEN = cached-token\nSessionNo = 4\n";
        const values = Object.fromEntries(_local.split(/\n/).filter(Boolean).map((line) => line.split(" = ")));
        module.exports = { path: "/fixture/project", local: values };"#,
        "config.js",
    )
    .unwrap();
    assert_eq!(config.project_path.as_deref(), Some("/fixture/project"));
    assert_eq!(config.local_values.get("TOKEN").map(String::as_str), Some("cached-token"));
    assert_eq!(config.local_values.get("SESSIONNO").map(String::as_str), Some("4"));
}

#[test]
fn sys_config_parses_comments_duplicates_and_sections() {
    let parsed = parse_sys_config("# comment\ntoken = old\nTOKEN = new ; comment\nFlag=on", "sysconfig.ini").unwrap();
    assert_eq!(parsed.get("TOKEN").map(String::as_str), Some("new"));
    assert_eq!(parsed.get("FLAG").map(String::as_str), Some("on"));
    let parsed = parse_sys_config("[config]\nTOKEN = old\n[config]\nTOKEN = new\nFlag=on", "sysconfig.ini").unwrap();
    assert_eq!(parsed.get("TOKEN").map(String::as_str), Some("new"));
    assert!(parse_sys_config("[config", "sysconfig.ini").is_err());
    assert!(parse_sys_config("__proto__ = x", "sysconfig.ini").is_err());
}

#[tokio::test]
async fn export_then_import_roundtrips_key_fields() {
    let imported = import_legacy_config(&fixture_dir()).await.unwrap();
    let out_dir = tempfile::tempdir().unwrap();
    export_legacy_config(&imported, out_dir.path()).await.unwrap();
    let reimported = import_legacy_config(out_dir.path()).await.unwrap();
    assert_eq!(reimported.server.port, imported.server.port);
    assert_eq!(reimported.local_values.get("TOKEN").map(String::as_str), imported.local_values.get("TOKEN").map(String::as_str));
    assert_eq!(reimported.tcp_targets[0].host, imported.tcp_targets[0].host);
    assert_eq!(reimported.tcp_targets[0].port, imported.tcp_targets[0].port);
    assert_eq!(reimported.accounts.get("ptjy").and_then(|a| a.get("password")).map(String::as_str), Some("fixture-password"));
}

#[tokio::test]
async fn eval_sandbox_rejects_huge_allocations_and_bad_code() {
    assert!(parse_legacy_config_js("module.exports = { a: 'x'.repeat(9000000) }", "config.js").is_err());
    assert!(parse_legacy_config_js("while(true){}", "config.js").is_err());
    assert!(parse_legacy_config_js("module.exports = () => 1", "config.js").is_err());
}
