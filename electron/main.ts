import { app, BrowserWindow, dialog, ipcMain } from "electron";
import path from "node:path";
import { encryptDirectory } from "../src/core/encryption/encryptor";
import { readEncryptionPreferences, saveEncryptionPreferences } from "../src/core/encryption/preferences";
import type { AppConfig, EncryptionMode, LogEntry, ProxyInstanceSummary, UpdateState } from "../src/shared/contracts";
import { ConfigStore } from "../src/core/config/config-store";
import { createDefaultConfig } from "../src/core/config/model";
import { ForwardingServiceManager } from "../src/core/runtime/forwarding-service-manager";
import { ProxyWorkspaceStore } from "../src/core/runtime/proxy-workspace-store";
import { getEncryptionEncoderPath, getEncryptionPreferencesPath, getPreloadPath, getRendererIndexPath } from "./paths";
import { createRendererSecurityPolicy, type RendererSecurityPolicy } from "./security";
import { createSaveConfigHandler, createTrustedIpcHandler, type IpcHandler } from "./ipc";
import { extractManualLoginValues, sendManualRequest } from "../src/core/request/manual-request";
import { getManualRequestConfigValidationError, isValidManualRequestConfig } from "../src/shared/validation";
import { createElectronUpdateAdapter, createUpdateService, type UpdateService } from "./update-service";

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

const smokeMode = process.argv.includes("--smoke");
let manager: ForwardingServiceManager;
let configStore: ConfigStore;
let workspaceStore: ProxyWorkspaceStore;
let updateService: UpdateService | undefined;
let quitting = false;

function registerIpcHandler(
  policy: RendererSecurityPolicy,
  channel: string,
  handler: IpcHandler,
): void {
  ipcMain.handle(channel, createTrustedIpcHandler(policy, handler));
}

function registerIpcHandlers(policy: RendererSecurityPolicy): void {
  registerIpcHandler(policy, IPC_CHANNELS.getConfig, () => manager.getConfig());
  registerIpcHandler(policy, IPC_CHANNELS.getAppVersion, () => app.getVersion());
  registerIpcHandler(policy, IPC_CHANNELS.getUpdateState, () => updateService?.getState());
  registerIpcHandler(policy, IPC_CHANNELS.checkForUpdates, () => updateService?.check() ?? { ok: true, skipped: true });
  registerIpcHandler(policy, IPC_CHANNELS.downloadUpdate, () => updateService?.download() ?? { ok: true, skipped: true });
  registerIpcHandler(policy, IPC_CHANNELS.installUpdate, () => updateService?.install() ?? { ok: true, skipped: true });
  registerIpcHandler(
    policy,
    IPC_CHANNELS.saveConfig,
    createSaveConfigHandler(async (config) => {
      try {
        await manager.saveConfig(config);
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : "could not save configuration" };
      }
    }),
  );
  registerIpcHandler(policy, IPC_CHANNELS.getSharedValues, () => manager.getSharedValues());
  registerIpcHandler(policy, IPC_CHANNELS.saveSharedValues, async (_event, values) => {
    if (!isStringRecord(values)) return { ok: false, error: "本地变量格式无效" };
    try {
      await manager.saveSharedValues(values);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "本地变量保存失败" };
    }
  });
  registerIpcHandler(policy, IPC_CHANNELS.getLoginCache, () => manager.getLoginCache());
  registerIpcHandler(policy, IPC_CHANNELS.saveLoginCache, async (_event, values) => {
    if (!isStringRecord(values)) return { ok: false, error: "登录缓存格式无效" };
    try {
      await manager.saveLoginCache(values);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "登录缓存保存失败" };
    }
  });
  registerIpcHandler(policy, IPC_CHANNELS.listProxyInstances, (): ProxyInstanceSummary[] => manager.list());
  registerIpcHandler(policy, IPC_CHANNELS.selectProxyInstance, async (_event, id) => {
    if (typeof id !== "string" || id.length === 0) return { ok: false, error: "代理实例参数无效" };
    try {
      await manager.select(id);
      return { ok: true, instanceId: id };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "代理实例切换失败" };
    }
  });
  registerIpcHandler(policy, IPC_CHANNELS.createProxyInstance, async () => {
    try {
      return { ok: true, instance: await manager.create() };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "新增代理实例失败" };
    }
  });
  registerIpcHandler(policy, IPC_CHANNELS.duplicateProxyInstance, async () => {
    try {
      return { ok: true, instance: await manager.duplicate() };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "复制代理实例失败" };
    }
  });
  registerIpcHandler(policy, IPC_CHANNELS.renameProxyInstance, async (_event, id, name) => {
    if (typeof id !== "string" || id.length === 0 || typeof name !== "string") return { ok: false, error: "代理名称参数无效" };
    try {
      await manager.rename(id, name);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "代理名称保存失败" };
    }
  });
  registerIpcHandler(policy, IPC_CHANNELS.deleteProxyInstance, async (_event, id) => {
    if (typeof id !== "string" || id.length === 0) return { ok: false, error: "代理实例参数无效" };
    try {
      await manager.remove(id);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "删除代理实例失败" };
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
      return await readEncryptionPreferences(getEncryptionPreferencesPath(app.getPath("userData")));
    } catch {
      return { inputDir: "", outputDir: "", inputHistory: [], outputHistory: [] };
    }
  });
  registerIpcHandler(policy, IPC_CHANNELS.saveEncryptionPreferences, async (_event, patch) => {
    if (typeof patch !== "object" || patch === null || Array.isArray(patch)) return { ok: false, error: "加密目录参数无效" };
    const value = patch as Record<string, unknown>;
    if (Object.keys(value).some((key) => key !== "inputDir" && key !== "outputDir")) return { ok: false, error: "加密目录参数无效" };
    if (value.inputDir !== undefined && typeof value.inputDir !== "string") return { ok: false, error: "加密前目录参数无效" };
    if (value.outputDir !== undefined && typeof value.outputDir !== "string") return { ok: false, error: "加密后目录参数无效" };
    try {
      const preferences = await saveEncryptionPreferences(
        getEncryptionPreferencesPath(app.getPath("userData")),
        { inputDir: value.inputDir as string | undefined, outputDir: value.outputDir as string | undefined },
      );
      return { ok: true, preferences };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "保存加密目录失败" };
    }
  });
  registerIpcHandler(policy, IPC_CHANNELS.encryptDirectory, async (_event, inputDir, outputDir, mode) => {
    if (typeof inputDir !== "string" || typeof outputDir !== "string" || !inputDir || !outputDir) {
      return { ok: false, error: "请选择加密前和加密后文件夹目录" };
    }
    if (mode !== "full" && mode !== "incremental") return { ok: false, error: "加密模式无效" };
    try {
      const result = await encryptDirectory({
        inputDir,
        outputDir,
        mode: mode as EncryptionMode,
        encoderPath: getEncryptionEncoderPath(__dirname, app.isPackaged, process.resourcesPath),
        onProgress: (progress) => {
          for (const window of BrowserWindow.getAllWindows()) window.webContents.send(IPC_CHANNELS.encryptionProgress, progress);
        },
      });
      return { ok: true, ...result };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "加密失败" };
    }
  });
  registerIpcHandler(policy, IPC_CHANNELS.sendRequest, async (_event, payload) => {
    if (!isValidManualRequestConfig(payload)) {
      return { ok: false, error: `Invalid request payload: ${getManualRequestConfigValidationError(payload) ?? "request"}` };
    }
    try {
      const result = await sendManualRequest({ ...payload, timeoutMs: manager.getConfig().server.timeoutMs });
      if (result.body !== undefined) {
        const loginValues = extractManualLoginValues(payload.paramsText, result.body);
        if (loginValues !== undefined) manager.mergeLocalValues(loginValues);
      }
      return { ok: true, ...result };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "请求失败" };
    }
  });
  registerIpcHandler(policy, IPC_CHANNELS.start, (_event, id) => {
    if (id !== undefined && (typeof id !== "string" || id.length === 0)) throw new Error("代理实例参数无效");
    return manager.start(id);
  });
  registerIpcHandler(policy, IPC_CHANNELS.stop, (_event, id) => {
    if (id !== undefined && (typeof id !== "string" || id.length === 0)) throw new Error("代理实例参数无效");
    return manager.stop(id);
  });
  registerIpcHandler(policy, IPC_CHANNELS.startAll, async () => {
    try {
      await manager.startAll();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "一键开启失败" };
    }
  });
  registerIpcHandler(policy, IPC_CHANNELS.stopAll, async () => {
    try {
      await manager.stopAll();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "一键关闭失败" };
    }
  });
  registerIpcHandler(policy, IPC_CHANNELS.status, () => {
    if (smokeMode) {
      console.log("forwarder-ready");
      setTimeout(() => app.quit(), 0);
    }
    return manager.status();
  });
  registerIpcHandler(policy, IPC_CHANNELS.logs, (): LogEntry[] => manager.getLogs());
  registerIpcHandler(policy, IPC_CHANNELS.clearLogs, () => {
    try {
      manager.clearLogs();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "日志清空失败" };
    }
  });
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.values(value).every((entry) => typeof entry === "string");
}

async function loadService(): Promise<void> {
  const filePath = path.join(app.getPath("userData"), "config.json");
  configStore = new ConfigStore(filePath);
  workspaceStore = new ProxyWorkspaceStore(path.join(app.getPath("userData"), "proxy-instances.json"));
  const workspace = await workspaceStore.load(async () => {
    let config: AppConfig;
    try {
      config = await configStore.load();
    } catch (error) {
      if ((error as { cause?: { code?: string } }).cause?.code !== "ENOENT") throw error;
      config = createDefaultConfig();
      await configStore.save(config);
    }
    if (config.cache.rootDir === "") {
      config.cache.rootDir = path.join(app.getPath("userData"), "cache", "default");
    }
    return config;
  });
  manager = new ForwardingServiceManager({
    workspace,
    workspaceStore,
    defaultCacheRoot: path.join(app.getPath("userData"), "cache"),
  });
}

function initializeUpdateService(): void {
  updateService = createUpdateService({
    currentVersion: app.getVersion(),
    isPackaged: app.isPackaged,
    isSmokeMode: smokeMode,
    updater: app.isPackaged && !smokeMode ? createElectronUpdateAdapter() : undefined,
    stopAll: async () => {
      try {
        await manager.stopAll();
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : "停止代理失败" };
      }
    },
    publish: (state: UpdateState) => {
      for (const window of BrowserWindow.getAllWindows()) window.webContents.send(IPC_CHANNELS.updateState, state);
    },
  });
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
    initializeUpdateService();
    registerIpcHandlers(rendererSecurityPolicy);
    createWindow(rendererSecurityPolicy);
    void updateService?.startBackgroundCheck();
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
  if (quitting || manager === undefined || manager.list().every((instance) => instance.status.state === "stopped")) return;
  event.preventDefault();
  quitting = true;
  void manager.stopAll().finally(() => app.quit());
});
