import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import {
  IPC_CHANNELS,
  type AppConfig,
  type LogEntry,
  type RuntimeStatus,
} from "../src/shared/contracts";

const stoppedStatus: RuntimeStatus = {
  state: "stopped",
  requestCount: 0,
  tcpConnections: 0,
};

const placeholderConfig: AppConfig = {
  server: {
    bindHost: "127.0.0.1",
    port: 8080,
    timeoutMs: 30000,
    loggingEnabled: true,
  },
  httpRules: [],
  tcpTargets: [],
  localValues: {},
  mapValues: {},
  accounts: {},
  cache: {
    rootDir: "",
    downloadTarget: "",
    decryptEnabled: false,
    autoDownload: false,
  },
};

const placeholderError = "This operation is not implemented in the application skeleton.";

function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.getConfig, () => placeholderConfig);
  ipcMain.handle(IPC_CHANNELS.saveConfig, () => ({ ok: false, error: placeholderError }));
  ipcMain.handle(IPC_CHANNELS.importLegacy, () => ({ ok: false, error: placeholderError }));
  ipcMain.handle(IPC_CHANNELS.exportConfig, () => ({ ok: false, error: placeholderError }));
  ipcMain.handle(IPC_CHANNELS.start, () => stoppedStatus);
  ipcMain.handle(IPC_CHANNELS.stop, () => stoppedStatus);
  ipcMain.handle(IPC_CHANNELS.status, () => stoppedStatus);
  ipcMain.handle(IPC_CHANNELS.logs, (): LogEntry[] => []);
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1200,
    height: 760,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  if (app.isPackaged) {
    void window.loadFile(path.join(__dirname, "../dist/index.html"));
  } else {
    void window.loadURL(process.env.VITE_DEV_SERVER_URL ?? "http://localhost:5173");
  }
}

app.whenReady().then(() => {
  registerIpcHandlers();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
