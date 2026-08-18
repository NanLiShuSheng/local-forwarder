import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent } from "electron";
import {
  IPC_CHANNELS,
  type AppConfig,
  type LogEntry,
  type RuntimeStatus,
} from "../src/shared/contracts";
import { getPreloadPath, getRendererIndexPath } from "./paths";
import { createRendererSecurityPolicy, type RendererSecurityPolicy } from "./security";
import { isValidAppConfig } from "../src/shared/validation";

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
const invalidConfigError = "Invalid configuration payload.";
const smokeMode = process.argv.includes("--smoke");

type IpcHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;

function registerIpcHandler(
  policy: RendererSecurityPolicy,
  channel: string,
  handler: IpcHandler,
): void {
  ipcMain.handle(channel, (event, ...args) => {
    if (!policy.isTrustedRendererUrl(event.senderFrame?.url ?? "")) {
      throw new Error("Blocked IPC call from an untrusted renderer.");
    }
    return handler(event, ...args);
  });
}

function registerIpcHandlers(policy: RendererSecurityPolicy): void {
  registerIpcHandler(policy, IPC_CHANNELS.getConfig, () => placeholderConfig);
  registerIpcHandler(policy, IPC_CHANNELS.saveConfig, (_event, payload) => {
    if (!isValidAppConfig(payload)) {
      return { ok: false, error: invalidConfigError };
    }
    return { ok: false, error: placeholderError };
  });
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
