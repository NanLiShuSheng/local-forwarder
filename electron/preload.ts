import { contextBridge, ipcRenderer } from "electron";
import type { AppConfig, EncryptionDirectoryKind, EncryptionMode, EncryptionPreferences, ForwarderApi } from "../src/shared/contracts";

const IPC_CHANNELS = {
  getConfig: "config:get",
  saveConfig: "config:save",
  importLegacy: "config:import-legacy",
  exportConfig: "config:export",
  selectProjectDirectory: "config:select-project-directory",
  selectEncryptionDirectory: "encryption:select-directory",
  getEncryptionPreferences: "encryption:get-preferences",
  saveEncryptionPreferences: "encryption:save-preferences",
  encryptDirectory: "encryption:run",
  sendRequest: "request:send",
  listProxyInstances: "proxy-instances:list",
  selectProxyInstance: "proxy-instances:select",
  createProxyInstance: "proxy-instances:create",
  duplicateProxyInstance: "proxy-instances:duplicate",
  start: "runtime:start",
  stop: "runtime:stop",
  status: "runtime:status",
  logs: "runtime:logs",
  clearLogs: "runtime:logs:clear",
} as const;

const api: ForwarderApi = {
  getConfig: () => ipcRenderer.invoke(IPC_CHANNELS.getConfig),
  saveConfig: (config: AppConfig) => ipcRenderer.invoke(IPC_CHANNELS.saveConfig, config),
  listProxyInstances: () => ipcRenderer.invoke(IPC_CHANNELS.listProxyInstances),
  selectProxyInstance: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.selectProxyInstance, id),
  createProxyInstance: () => ipcRenderer.invoke(IPC_CHANNELS.createProxyInstance),
  duplicateProxyInstance: () => ipcRenderer.invoke(IPC_CHANNELS.duplicateProxyInstance),
  importLegacy: () => ipcRenderer.invoke(IPC_CHANNELS.importLegacy),
  exportConfig: () => ipcRenderer.invoke(IPC_CHANNELS.exportConfig),
  selectProjectDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.selectProjectDirectory),
  selectEncryptionDirectory: (kind: EncryptionDirectoryKind) => ipcRenderer.invoke(IPC_CHANNELS.selectEncryptionDirectory, kind),
  getEncryptionPreferences: () => ipcRenderer.invoke(IPC_CHANNELS.getEncryptionPreferences),
  saveEncryptionPreferences: (patch: Partial<EncryptionPreferences>) => ipcRenderer.invoke(IPC_CHANNELS.saveEncryptionPreferences, patch),
  encryptDirectory: (inputDir: string, outputDir: string, mode: EncryptionMode) => ipcRenderer.invoke(IPC_CHANNELS.encryptDirectory, inputDir, outputDir, mode),
  sendRequest: (request) => ipcRenderer.invoke(IPC_CHANNELS.sendRequest, request),
  start: () => ipcRenderer.invoke(IPC_CHANNELS.start),
  stop: () => ipcRenderer.invoke(IPC_CHANNELS.stop),
  status: () => ipcRenderer.invoke(IPC_CHANNELS.status),
  logs: () => ipcRenderer.invoke(IPC_CHANNELS.logs),
  clearLogs: () => ipcRenderer.invoke(IPC_CHANNELS.clearLogs),
};

contextBridge.exposeInMainWorld("forwarder", api);
