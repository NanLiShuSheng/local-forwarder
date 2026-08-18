import { app, BrowserWindow, ipcMain } from "electron";
import type { AppConfig, LogEntry, RuntimeStatus } from "../src/shared/contracts";
import { getPreloadPath, getRendererIndexPath } from "./paths";
import { createRendererSecurityPolicy, type RendererSecurityPolicy } from "./security";
import { createSaveConfigHandler, createTrustedIpcHandler, type IpcHandler } from "./ipc";

const IPC_CHANNELS = {
  getConfig: "config:get",
  saveConfig: "config:save",
  importLegacy: "config:import-legacy",
  exportConfig: "config:export",
  start: "runtime:start",
  stop: "runtime:stop",
  status: "runtime:status",
  logs: "runtime:logs",
} as const;

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
const smokeMode = process.argv.includes("--smoke");

function registerIpcHandler(
  policy: RendererSecurityPolicy,
  channel: string,
  handler: IpcHandler,
): void {
  ipcMain.handle(channel, createTrustedIpcHandler(policy, handler));
}

function registerIpcHandlers(policy: RendererSecurityPolicy): void {
  registerIpcHandler(policy, IPC_CHANNELS.getConfig, () => placeholderConfig);
  registerIpcHandler(
    policy,
    IPC_CHANNELS.saveConfig,
    createSaveConfigHandler(() => ({ ok: false, error: placeholderError })),
  );
  registerIpcHandler(policy, IPC_CHANNELS.importLegacy, () => ({ ok: false, error: placeholderError }));
  registerIpcHandler(policy, IPC_CHANNELS.exportConfig, () => ({ ok: false, error: placeholderError }));
  registerIpcHandler(policy, IPC_CHANNELS.start, () => stoppedStatus);
  registerIpcHandler(policy, IPC_CHANNELS.stop, () => stoppedStatus);
  registerIpcHandler(policy, IPC_CHANNELS.status, () => {
    if (smokeMode) {
      setTimeout(() => app.quit(), 0);
    }
    return stoppedStatus;
  });
  registerIpcHandler(policy, IPC_CHANNELS.logs, (): LogEntry[] => []);
}

function createWindow(policy: RendererSecurityPolicy): void {
  const window = new BrowserWindow({
    width: 1200,
    height: 760,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: getPreloadPath(__dirname),
    },
  });

  window.webContents.on("will-navigate", (event, url) => {
    if (!policy.shouldAllowNavigation(url)) {
      event.preventDefault();
    }
  });
  window.webContents.setWindowOpenHandler(({ url }) => policy.windowOpenDecision(url));

  if (app.isPackaged || smokeMode) {
    void window.loadFile(getRendererIndexPath(__dirname));
  } else {
    void window.loadURL(process.env.VITE_DEV_SERVER_URL ?? "http://localhost:5173");
  }
}

const rendererSecurityPolicy = createRendererSecurityPolicy({
  mode: app.isPackaged || smokeMode ? "production" : "development",
  devServerUrl: process.env.VITE_DEV_SERVER_URL ?? "http://localhost:5173",
  rendererFilePath: getRendererIndexPath(__dirname),
});

app.whenReady().then(() => {
  registerIpcHandlers(rendererSecurityPolicy);
  createWindow(rendererSecurityPolicy);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(rendererSecurityPolicy);
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
