import { contextBridge, ipcRenderer } from "electron";
import type { AppConfig, EncryptionDirectoryKind, ForwarderApi } from "../src/shared/contracts";

const IPC_CHANNELS = {
  getConfig: "config:get",
  saveConfig: "config:save",
  importLegacy: "config:import-legacy",
  exportConfig: "config:export",
  selectProjectDirectory: "config:select-project-directory",
  selectEncryptionDirectory: "encryption:select-directory",
  getEncryptionPreferences: "encryption:get-preferences",
  encryptDirectory: "encryption:run",
  start: "runtime:start",
  stop: "runtime:stop",
  status: "runtime:status",
  logs: "runtime:logs",
} as const;

const api: ForwarderApi = {
  getConfig: () => ipcRenderer.invoke(IPC_CHANNELS.getConfig),
  saveConfig: (config: AppConfig) => ipcRenderer.invoke(IPC_CHANNELS.saveConfig, config),
  importLegacy: () => ipcRenderer.invoke(IPC_CHANNELS.importLegacy),
  exportConfig: () => ipcRenderer.invoke(IPC_CHANNELS.exportConfig),
  selectProjectDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.selectProjectDirectory),
  selectEncryptionDirectory: (kind: EncryptionDirectoryKind) => ipcRenderer.invoke(IPC_CHANNELS.selectEncryptionDirectory, kind),
  getEncryptionPreferences: () => ipcRenderer.invoke(IPC_CHANNELS.getEncryptionPreferences),
  encryptDirectory: (inputDir: string, outputDir: string) => ipcRenderer.invoke(IPC_CHANNELS.encryptDirectory, inputDir, outputDir),
  start: () => ipcRenderer.invoke(IPC_CHANNELS.start),
  stop: () => ipcRenderer.invoke(IPC_CHANNELS.stop),
  status: () => ipcRenderer.invoke(IPC_CHANNELS.status),
  logs: () => ipcRenderer.invoke(IPC_CHANNELS.logs),
};

contextBridge.exposeInMainWorld("forwarder", api);
