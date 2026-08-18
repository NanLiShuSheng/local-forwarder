import { contextBridge, ipcRenderer } from "electron";
import {
  IPC_CHANNELS,
  type AppConfig,
  type ForwarderApi,
} from "../src/shared/contracts";

const api: ForwarderApi = {
  getConfig: () => ipcRenderer.invoke(IPC_CHANNELS.getConfig),
  saveConfig: (config: AppConfig) => ipcRenderer.invoke(IPC_CHANNELS.saveConfig, config),
  importLegacy: () => ipcRenderer.invoke(IPC_CHANNELS.importLegacy),
  exportConfig: () => ipcRenderer.invoke(IPC_CHANNELS.exportConfig),
  start: () => ipcRenderer.invoke(IPC_CHANNELS.start),
  stop: () => ipcRenderer.invoke(IPC_CHANNELS.stop),
  status: () => ipcRenderer.invoke(IPC_CHANNELS.status),
  logs: () => ipcRenderer.invoke(IPC_CHANNELS.logs),
};

contextBridge.exposeInMainWorld("forwarder", api);
