import { contextBridge, ipcRenderer } from "electron";
import type { AppConfig, EncryptionDirectoryKind, EncryptionMode, EncryptionPreferencesPatch, EncryptionProgress, ForwarderApi, UpdateState } from "../src/shared/contracts";

const IPC_CHANNELS = {
  getConfig: "config:get",
  getAppVersion: "app:version:get",
  getUpdateState: "update:state:get",
  checkForUpdates: "update:check",
  downloadUpdate: "update:download",
  installUpdate: "update:install",
  updateState: "update:state",
  saveConfig: "config:save",
  getSharedValues: "values:shared:get",
  saveSharedValues: "values:shared:save",
  getLoginCache: "values:login:get",
  saveLoginCache: "values:login:save",
  selectProjectDirectory: "config:select-project-directory",
  selectEncryptionDirectory: "encryption:select-directory",
  getEncryptionPreferences: "encryption:get-preferences",
  saveEncryptionPreferences: "encryption:save-preferences",
  encryptDirectory: "encryption:run",
  encryptionProgress: "encryption:progress",
  sendRequest: "request:send",
  listProxyInstances: "proxy-instances:list",
  selectProxyInstance: "proxy-instances:select",
  createProxyInstance: "proxy-instances:create",
  duplicateProxyInstance: "proxy-instances:duplicate",
  renameProxyInstance: "proxy-instances:rename",
  deleteProxyInstance: "proxy-instances:delete",
  start: "runtime:start",
  stop: "runtime:stop",
  startAll: "runtime:start-all",
  stopAll: "runtime:stop-all",
  status: "runtime:status",
  logs: "runtime:logs",
  clearLogs: "runtime:logs:clear",
} as const;

const api: ForwarderApi = {
  getConfig: () => ipcRenderer.invoke(IPC_CHANNELS.getConfig),
  getAppVersion: () => ipcRenderer.invoke(IPC_CHANNELS.getAppVersion),
  getUpdateState: () => ipcRenderer.invoke(IPC_CHANNELS.getUpdateState),
  checkForUpdates: () => ipcRenderer.invoke(IPC_CHANNELS.checkForUpdates),
  downloadUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.downloadUpdate),
  installUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.installUpdate),
  onUpdateState: (listener: (state: UpdateState) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: UpdateState) => listener(state);
    ipcRenderer.on(IPC_CHANNELS.updateState, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.updateState, handler);
  },
  saveConfig: (config: AppConfig) => ipcRenderer.invoke(IPC_CHANNELS.saveConfig, config),
  getSharedValues: () => ipcRenderer.invoke(IPC_CHANNELS.getSharedValues),
  saveSharedValues: (values) => ipcRenderer.invoke(IPC_CHANNELS.saveSharedValues, values),
  getLoginCache: () => ipcRenderer.invoke(IPC_CHANNELS.getLoginCache),
  saveLoginCache: (values) => ipcRenderer.invoke(IPC_CHANNELS.saveLoginCache, values),
  listProxyInstances: () => ipcRenderer.invoke(IPC_CHANNELS.listProxyInstances),
  selectProxyInstance: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.selectProxyInstance, id),
  createProxyInstance: () => ipcRenderer.invoke(IPC_CHANNELS.createProxyInstance),
  duplicateProxyInstance: () => ipcRenderer.invoke(IPC_CHANNELS.duplicateProxyInstance),
  renameProxyInstance: (id: string, name: string) => ipcRenderer.invoke(IPC_CHANNELS.renameProxyInstance, id, name),
  deleteProxyInstance: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.deleteProxyInstance, id),
  selectProjectDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.selectProjectDirectory),
  selectEncryptionDirectory: (kind: EncryptionDirectoryKind) => ipcRenderer.invoke(IPC_CHANNELS.selectEncryptionDirectory, kind),
  getEncryptionPreferences: () => ipcRenderer.invoke(IPC_CHANNELS.getEncryptionPreferences),
  saveEncryptionPreferences: (patch: EncryptionPreferencesPatch) => ipcRenderer.invoke(IPC_CHANNELS.saveEncryptionPreferences, patch),
  encryptDirectory: (inputDir: string, outputDir: string, mode: EncryptionMode) => ipcRenderer.invoke(IPC_CHANNELS.encryptDirectory, inputDir, outputDir, mode),
  onEncryptionProgress: (listener: (progress: EncryptionProgress) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: EncryptionProgress) => listener(progress);
    ipcRenderer.on(IPC_CHANNELS.encryptionProgress, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.encryptionProgress, handler);
  },
  sendRequest: (request) => ipcRenderer.invoke(IPC_CHANNELS.sendRequest, request),
  start: (id?: string) => ipcRenderer.invoke(IPC_CHANNELS.start, id),
  stop: (id?: string) => ipcRenderer.invoke(IPC_CHANNELS.stop, id),
  startAll: () => ipcRenderer.invoke(IPC_CHANNELS.startAll),
  stopAll: () => ipcRenderer.invoke(IPC_CHANNELS.stopAll),
  status: () => ipcRenderer.invoke(IPC_CHANNELS.status),
  logs: () => ipcRenderer.invoke(IPC_CHANNELS.logs),
  clearLogs: () => ipcRenderer.invoke(IPC_CHANNELS.clearLogs),
};

contextBridge.exposeInMainWorld("forwarder", api);
