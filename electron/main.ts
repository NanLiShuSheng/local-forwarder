import { app, BrowserWindow, dialog, ipcMain } from "electron";
import path from "node:path";
import { encryptDirectory } from "../src/core/encryption/encryptor";
import { readEncryptionPreferences, saveEncryptionPreferences } from "../src/core/encryption/preferences";
import type { AppConfig, LogEntry } from "../src/shared/contracts";
import { ConfigStore } from "../src/core/config/config-store";
import { createDefaultConfig } from "../src/core/config/model";
import { ForwardingService } from "../src/core/runtime/forwarding-service";
import { getEncryptionEncoderPath, getEncryptionPreferencesPath, getPreloadPath, getRendererIndexPath } from "./paths";
import { createRendererSecurityPolicy, type RendererSecurityPolicy } from "./security";
import { createSaveConfigHandler, createTrustedIpcHandler, type IpcHandler } from "./ipc";

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

const smokeMode = process.argv.includes("--smoke");
let service: ForwardingService;
let configStore: ConfigStore;
let quitting = false;

function registerIpcHandler(
  policy: RendererSecurityPolicy,
  channel: string,
  handler: IpcHandler,
): void {
  ipcMain.handle(channel, createTrustedIpcHandler(policy, handler));
}

function registerIpcHandlers(policy: RendererSecurityPolicy): void {
  registerIpcHandler(policy, IPC_CHANNELS.getConfig, () => service.getConfig());
  registerIpcHandler(
    policy,
    IPC_CHANNELS.saveConfig,
    createSaveConfigHandler(async (config) => {
      try {
        await service.saveConfig(config);
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : "could not save configuration" };
      }
    }),
  );
  registerIpcHandler(policy, IPC_CHANNELS.importLegacy, async () => {
    const selected = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    if (selected.canceled || selected.filePaths[0] === undefined) return { ok: false, error: "import canceled" };
    try {
      const imported = await configStore.importLegacy(selected.filePaths[0]);
      await service.stop();
      service = createService(imported);
      await configStore.save(imported);
      return { ok: true, config: imported };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "could not import legacy configuration" };
    }
  });
  registerIpcHandler(policy, IPC_CHANNELS.exportConfig, async () => {
    const selected = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
    if (selected.canceled || selected.filePaths[0] === undefined) return { ok: false, error: "export canceled" };
    try {
      await configStore.exportLegacy(service.getConfig(), selected.filePaths[0]);
      return { ok: true, path: selected.filePaths[0] };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "could not export configuration" };
    }
  });
  registerIpcHandler(policy, IPC_CHANNELS.selectProjectDirectory, async () => {
    const selected = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    if (selected.canceled || selected.filePaths[0] === undefined) return { ok: false, canceled: true };
    return { ok: true, path: selected.filePaths[0] };
  });
  registerIpcHandler(policy, IPC_CHANNELS.selectEncryptionDirectory, async (_event, kind) => {
    if (kind !== "input" && kind !== "output") return { ok: false, error: "目录类型无效" };
    const selected = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
      title: kind === "input" ? "选择加密前文件夹目录" : "选择加密后文件夹目录",
    });
    if (selected.canceled || selected.filePaths[0] === undefined) return { ok: false, canceled: true };
    try {
      const preferences = await saveEncryptionPreferences(
        getEncryptionPreferencesPath(app.getPath("userData")),
        kind === "input" ? { inputDir: selected.filePaths[0] } : { outputDir: selected.filePaths[0] },
      );
      return { ok: true, path: selected.filePaths[0], preferences };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "保存加密目录失败" };
    }
  });
  registerIpcHandler(policy, IPC_CHANNELS.getEncryptionPreferences, async () => {
    try {
      return readEncryptionPreferences(getEncryptionPreferencesPath(app.getPath("userData")));
    } catch {
      return { inputDir: "", outputDir: "" };
    }
  });
  registerIpcHandler(policy, IPC_CHANNELS.encryptDirectory, async (_event, inputDir, outputDir) => {
    if (typeof inputDir !== "string" || typeof outputDir !== "string" || !inputDir || !outputDir) {
      return { ok: false, error: "请选择加密前和加密后文件夹目录" };
    }
    try {
      const result = await encryptDirectory({
        inputDir,
        outputDir,
        encoderPath: getEncryptionEncoderPath(__dirname, app.isPackaged, process.resourcesPath),
      });
      return { ok: true, ...result };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "加密失败" };
    }
  });
  registerIpcHandler(policy, IPC_CHANNELS.start, () => service.start());
  registerIpcHandler(policy, IPC_CHANNELS.stop, () => service.stop());
  registerIpcHandler(policy, IPC_CHANNELS.status, () => {
    if (smokeMode) {
      console.log("forwarder-ready");
      setTimeout(() => app.quit(), 0);
    }
    return service.status();
  });
  registerIpcHandler(policy, IPC_CHANNELS.logs, (): LogEntry[] => service.getLogs());
}

function createService(config: AppConfig): ForwardingService {
  return new ForwardingService({ config, configStore });
}

async function loadService(): Promise<void> {
  const filePath = path.join(app.getPath("userData"), "config.json");
  configStore = new ConfigStore(filePath);
  let config: AppConfig;
  try {
    config = await configStore.load();
  } catch (error) {
    if ((error as { cause?: { code?: string } }).cause?.code !== "ENOENT") throw error;
    config = createDefaultConfig();
    config.cache.rootDir = path.join(app.getPath("userData"), "cache");
    await configStore.save(config);
  }
  service = createService(config);
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
  void loadService().then(() => {
    registerIpcHandlers(rendererSecurityPolicy);
    createWindow(rendererSecurityPolicy);
  }).catch((error) => {
    dialog.showErrorBox("Local Forwarder", error instanceof Error ? error.message : "could not load configuration");
    app.quit();
  });

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

app.on("before-quit", (event) => {
  if (quitting || service === undefined || service.status().state === "stopped") return;
  event.preventDefault();
  quitting = true;
  void service.stop().finally(() => app.quit());
});
