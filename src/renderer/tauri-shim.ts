import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AppConfig, EncryptionDirectoryKind, EncryptionMode, EncryptionPreferencesPatch, ForwarderApi, StoredValues, UpdateState, ValuesSnapshot } from "../shared/contracts";

type Listener<T> = (value: T) => void;

function subscribe<T>(channel: string, listener: Listener<T>): () => void {
  let unlisten: UnlistenFn | undefined;
  let disposed = false;
  void listen<T>(channel, (event) => listener(event.payload)).then((dispose) => {
    if (disposed) {
      dispose();
    } else {
      unlisten = dispose;
    }
  });
  return () => {
    disposed = true;
    if (unlisten !== undefined) unlisten();
  };
}

// Tauri 环境下用 invoke/listen 组装出与 Electron preload 相同的 window.forwarder
export function installTauriShim(): void {
  if (!("__TAURI__" in window)) return;
  const api: ForwarderApi = {
    getConfig: () => invoke("get_config"),
    getAppVersion: () => invoke("get_app_version"),
    getUpdateState: () => invoke("get_update_state"),
    checkForUpdates: () => invoke("check_for_updates"),
    downloadUpdate: () => invoke("download_update"),
    installUpdate: () => invoke("install_update"),
    onUpdateState: (listener: Listener<UpdateState>) => subscribe("update:state", listener),
    saveConfig: (config: AppConfig) => invoke("save_config", { config }),
    getSharedValues: () => invoke("get_shared_values"),
    saveSharedValues: (values) => invoke("save_shared_values", { values }),
    getLoginCache: () => invoke("get_login_cache"),
    saveLoginCache: (values) => invoke("save_login_cache", { values }),
    saveStoredValues: (values: StoredValues) => invoke("save_stored_values", { values }),
    applyForwardingTargets: (targets: AppConfig["tcpTargets"]) => invoke("apply_forwarding_targets", { targets }),
    listProxyInstances: () => invoke("list_proxy_instances"),
    selectProxyInstance: (id: string) => invoke("select_proxy_instance", { id }),
    createProxyInstance: () => invoke("create_proxy_instance"),
    duplicateProxyInstance: () => invoke("duplicate_proxy_instance"),
    renameProxyInstance: (id: string, name: string) => invoke("rename_proxy_instance", { id, name }),
    deleteProxyInstance: (id: string) => invoke("delete_proxy_instance", { id }),
    selectProjectDirectory: () => invoke("select_project_directory"),
    selectEncryptionDirectory: (kind: EncryptionDirectoryKind) => invoke("select_encryption_directory", { kind }),
    getEncryptionPreferences: () => invoke("get_encryption_preferences"),
    saveEncryptionPreferences: (patch: EncryptionPreferencesPatch) => invoke("save_encryption_preferences_cmd", { patch }),
    encryptDirectory: (inputDir: string, outputDir: string, mode: EncryptionMode) => invoke("encrypt_directory_cmd", { inputDir, outputDir, mode }),
    onEncryptionProgress: (listener) => subscribe("encryption:progress", listener),
    sendRequest: (request) => invoke("send_request", { payload: request }),
    start: (id?: string) => invoke("start", { id: id ?? null }),
    stop: (id?: string) => invoke("stop", { id: id ?? null }),
    startAll: () => invoke("start_all"),
    stopAll: () => invoke("stop_all"),
    status: () => invoke("status", {}),
    logs: () => invoke("logs", {}),
    clearLogs: () => invoke("clear_logs", {}),
    openExternal: (url: string) => invoke("open_external", { url }),
    onValuesChanged: (listener: Listener<ValuesSnapshot>) => subscribe("values:changed", listener),
  };
  (window as unknown as { forwarder: ForwarderApi }).forwarder = api;
}

installTauriShim();
