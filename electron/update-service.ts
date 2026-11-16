import { autoUpdater } from "electron-updater";
import type {
  UpdateInfoSnapshot,
  UpdateProgressSnapshot,
  UpdateState,
} from "../src/shared/contracts";

export interface UpdateAdapter {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  onCheckingForUpdate(listener: () => void): () => void;
  onUpdateAvailable(listener: (info: UpdateInfoSnapshot) => void): () => void;
  onUpdateNotAvailable(listener: () => void): () => void;
  onDownloadProgress(listener: (progress: UpdateProgressSnapshot) => void): () => void;
  onUpdateDownloaded(listener: (info: UpdateInfoSnapshot) => void): () => void;
  onError(listener: (error: unknown) => void): () => void;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(): void;
  openDownloadedUpdate?(): Promise<unknown>;
}

export interface UpdateServiceOptions {
  currentVersion: string;
  isPackaged: boolean;
  isSmokeMode: boolean;
  installMode?: "automatic" | "manual";
  updater?: UpdateAdapter;
  stopAll: () => Promise<{ ok: boolean; error?: string } | void>;
  onInstallStateChange?: (installing: boolean) => void;
  publish: (state: UpdateState) => void;
}

export interface UpdateService {
  getState(): UpdateState;
  startBackgroundCheck(): Promise<void>;
  check(): Promise<{ ok: boolean; error?: string }>;
  download(): Promise<{ ok: boolean; error?: string }>;
  install(): Promise<{ ok: boolean; error?: string }>;
  dispose(): void;
}

const FALLBACK_ERRORS = {
  check: "检查更新失败",
  download: "下载更新失败",
  install: "安装更新失败",
  openInstaller: "打开安装包失败",
} as const;

type UpdateOperation = keyof typeof FALLBACK_ERRORS;
type OperationResult = { ok: boolean; error?: string };

export function createUpdateService(options: UpdateServiceOptions): UpdateService {
  const updater = options.updater;
  const active = options.isPackaged && !options.isSmokeMode && updater !== undefined;
  const installMode = options.installMode ?? "automatic";
  let state: UpdateState = {
    state: "idle",
    currentVersion: options.currentVersion,
    ...(installMode === "manual" ? { installMode } : {}),
  };
  let disposed = false;
  let backgroundStarted = false;
  let checkPromise: Promise<OperationResult> | undefined;
  let downloadPromise: Promise<OperationResult> | undefined;
  let installPromise: Promise<OperationResult> | undefined;
  let currentOperation: UpdateOperation = "check";
  const removeListeners: Array<() => void> = [];

  if (updater !== undefined) {
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
  }

  if (active) {
    removeListeners.push(updater.onCheckingForUpdate(() => {
      setState({ state: "checking", currentVersion: options.currentVersion });
    }));
    removeListeners.push(updater.onUpdateAvailable((update) => {
      setState({ state: "available", currentVersion: options.currentVersion, update });
    }));
    removeListeners.push(updater.onUpdateNotAvailable(() => {
      setState({ state: "not-available", currentVersion: options.currentVersion });
    }));
    removeListeners.push(updater.onDownloadProgress((progress) => {
      setState({
        state: "downloading",
        currentVersion: options.currentVersion,
        update: state.update,
        progress: clampProgress(progress),
      });
    }));
    removeListeners.push(updater.onUpdateDownloaded((update) => {
      setState({ state: "downloaded", currentVersion: options.currentVersion, update });
    }));
    removeListeners.push(updater.onError((error) => {
      setError(currentOperation, error);
    }));
  }

  function getState(): UpdateState {
    return cloneState(state);
  }

  function check(): Promise<OperationResult> {
    if (!active) return Promise.resolve({ ok: true });
    if (checkPromise !== undefined) return checkPromise;
    currentOperation = "check";
    setState({ state: "checking", currentVersion: options.currentVersion });
    checkPromise = runAdapterOperation("check", () => updater.checkForUpdates());
    checkPromise = checkPromise.finally(() => {
      checkPromise = undefined;
    });
    return checkPromise;
  }

  function download(): Promise<OperationResult> {
    if (!active) return Promise.resolve({ ok: true });
    if (downloadPromise !== undefined) return downloadPromise;
    currentOperation = "download";
    setState({
      state: "downloading",
      currentVersion: options.currentVersion,
      update: state.update,
    });
    downloadPromise = runAdapterOperation("download", () => updater.downloadUpdate());
    downloadPromise = downloadPromise.finally(() => {
      downloadPromise = undefined;
    });
    return downloadPromise;
  }

  function install(): Promise<OperationResult> {
    if (!active) return Promise.resolve({ ok: true });
    if (installPromise !== undefined) return installPromise;
    if (state.state !== "downloaded") {
      const operation = installMode === "manual" ? "openInstaller" : "install";
      return Promise.resolve({ ok: false, error: setError(operation) });
    }

    if (installMode === "manual") {
      currentOperation = "openInstaller";
      installPromise = Promise.resolve()
        .then(async () => {
          if (state.state !== "downloaded" || updater.openDownloadedUpdate === undefined) {
            return { ok: false, error: setError("openInstaller") };
          }
          try {
            await updater.openDownloadedUpdate();
          } catch (error) {
            return { ok: false, error: setError("openInstaller", error) };
          }
          setState({ ...state, installerOpened: true });
          return { ok: true };
        })
        .finally(() => {
          installPromise = undefined;
        });
      return installPromise;
    }

    currentOperation = "install";
    let installLockHeld = false;
    const releaseInstallLock = () => {
      if (!installLockHeld) return;
      installLockHeld = false;
      options.onInstallStateChange?.(false);
    };
    options.onInstallStateChange?.(true);
    installLockHeld = true;
    installPromise = Promise.resolve()
      .then(async () => {
        let result: { ok: boolean; error?: string } | void;
        try {
          result = await options.stopAll();
        } catch {
          releaseInstallLock();
          return { ok: false, error: FALLBACK_ERRORS.install };
        }
        if (result !== undefined && !result.ok) {
          releaseInstallLock();
          return { ok: false, error: FALLBACK_ERRORS.install };
        }
        if (state.state !== "downloaded") {
          releaseInstallLock();
          return { ok: false, error: FALLBACK_ERRORS.install };
        }
        try {
          updater.quitAndInstall();
        } catch (error) {
          releaseInstallLock();
          throw error;
        }
        return { ok: true };
      })
      .catch(() => {
        releaseInstallLock();
        setError("install");
        return { ok: false, error: FALLBACK_ERRORS.install };
      })
      .finally(() => {
        installPromise = undefined;
      });
    return installPromise;
  }

  function runAdapterOperation(operation: UpdateOperation, action: () => Promise<unknown>): Promise<OperationResult> {
    try {
      return Promise.resolve(action())
        .then(() => ({ ok: true }))
        .catch((error: unknown) => {
          return { ok: false, error: setError(operation, error) };
        });
    } catch (error) {
      return Promise.resolve({ ok: false, error: setError(operation, error) });
    }
  }

  function startBackgroundCheck(): Promise<void> {
    if (!active || backgroundStarted || disposed) return Promise.resolve();
    backgroundStarted = true;
    void check();
    return Promise.resolve();
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    for (const removeListener of removeListeners.splice(0)) removeListener();
  }

  function setError(operation: UpdateOperation, error?: unknown): string {
    const message = describeUpdateFailure(operation, error);
    setState({
      state: "error",
      currentVersion: options.currentVersion,
      update: state.update,
      error: message,
    });
    return message;
  }

  function setState(next: UpdateState): void {
    const normalized = installMode === "manual" ? { ...next, installMode } : next;
    if (disposed || statesEqual(state, normalized)) return;
    state = cloneState(normalized);
    options.publish(getState());
  }

  return { getState, startBackgroundCheck, check, download, install, dispose };
}

const ACTIONABLE_UPDATE_ERRORS: ReadonlyArray<readonly [RegExp, string]> = [
  [/ERR_UPDATER_CHANNEL_FILE_NOT_FOUND|latest\.yml.*not found|Cannot find latest\.yml/i, "服务器上缺少 latest.yml，或更新地址配置错误"],
  [/ERR_UPDATER_LATEST_VERSION_NOT_FOUND/i, "无法获取最新版本，请检查更新地址和网络"],
  [/ERR_UPDATER_INVALID_UPDATE_INFO/i, "latest.yml 格式无效"],
  [/ERR_UPDATER_NO_CHECKSUM/i, "latest.yml 缺少校验值"],
  [/ERR_UPDATER_INVALID_VERSION/i, "更新包版本号无效"],
  [/ERR_UPDATER_INVALID_SIGNATURE/i, "更新包签名校验失败"],
  [/ERR_MANUAL_UPDATE_NOT_FOUND/i, "尚未发布 Mac 更新包"],
  [/ERR_MANUAL_UPDATE_MANIFEST|ERR_MANUAL_UPDATE_ARCH/i, "Mac 更新元数据无效或缺少当前架构安装包"],
  [/ERR_MANUAL_UPDATE_CHECKSUM/i, "安装包 SHA-512 校验失败"],
  [/ERR_MANUAL_UPDATE_DOWNLOAD/i, "安装包下载失败"],
  [/ERR_MANUAL_UPDATE_OPEN/i, "无法打开安装包"],
  [/ERR_NAME_NOT_RESOLVED|ENOTFOUND/i, "更新服务器域名无法解析"],
  [/ERR_CONNECTION_TIMED_OUT|ETIMEDOUT|TIMED_OUT/i, "连接更新服务器超时"],
  [/ERR_CONNECTION_REFUSED|ECONNREFUSED/i, "更新服务器拒绝连接"],
  [/ERR_INTERNET_DISCONNECTED|ENETUNREACH|EAI_AGAIN/i, "网络不可用，请检查网络连接"],
  [/ERR_CERT_|CERT_|certificate/i, "HTTPS 证书校验失败"],
];

function describeUpdateFailure(operation: UpdateOperation, error?: unknown): string {
  const fallback = FALLBACK_ERRORS[operation];
  if (error === undefined || error === null) return fallback;
  const value = error as { message?: unknown; code?: unknown; statusCode?: unknown };
  const text = [value.message, value.code].filter((part) => typeof part === "string").join(" ");
  for (const [pattern, message] of ACTIONABLE_UPDATE_ERRORS) {
    if (pattern.test(text)) return `${fallback}：${message}`;
  }
  if (typeof value.statusCode === "number") {
    return `${fallback}：服务器返回 HTTP ${value.statusCode}`;
  }
  if (typeof value.code === "string" && value.code.startsWith("ERR_UPDATER_")) {
    return `${fallback}：${value.code}`;
  }
  return fallback;
}

export function createElectronUpdateAdapter(): UpdateAdapter {
  return {
    get autoDownload() {
      return autoUpdater.autoDownload;
    },
    set autoDownload(value: boolean) {
      autoUpdater.autoDownload = value;
    },
    get autoInstallOnAppQuit() {
      return autoUpdater.autoInstallOnAppQuit;
    },
    set autoInstallOnAppQuit(value: boolean) {
      autoUpdater.autoInstallOnAppQuit = value;
    },
    onCheckingForUpdate(listener) {
      autoUpdater.on("checking-for-update", listener);
      return () => autoUpdater.removeListener("checking-for-update", listener);
    },
    onUpdateAvailable(listener) {
      const handler = (info: unknown) => listener(toUpdateInfoSnapshot(info));
      autoUpdater.on("update-available", handler);
      return () => autoUpdater.removeListener("update-available", handler);
    },
    onUpdateNotAvailable(listener) {
      autoUpdater.on("update-not-available", listener);
      return () => autoUpdater.removeListener("update-not-available", listener);
    },
    onDownloadProgress(listener) {
      const handler = (progress: UpdateProgressSnapshot) => listener(clampProgress(progress));
      autoUpdater.on("download-progress", handler);
      return () => autoUpdater.removeListener("download-progress", handler);
    },
    onUpdateDownloaded(listener) {
      const handler = (info: unknown) => listener(toUpdateInfoSnapshot(info));
      autoUpdater.on("update-downloaded", handler);
      return () => autoUpdater.removeListener("update-downloaded", handler);
    },
    onError(listener) {
      autoUpdater.on("error", listener);
      return () => autoUpdater.removeListener("error", listener);
    },
    checkForUpdates: () => autoUpdater.checkForUpdates(),
    downloadUpdate: () => autoUpdater.downloadUpdate(),
    quitAndInstall: () => autoUpdater.quitAndInstall(),
  };
}

function clampProgress(progress: UpdateProgressSnapshot): UpdateProgressSnapshot {
  return {
    percent: Math.max(0, Math.min(100, progress.percent)),
    transferred: progress.transferred,
    total: progress.total,
    bytesPerSecond: progress.bytesPerSecond,
  };
}

function toUpdateInfoSnapshot(info: unknown): UpdateInfoSnapshot {
  const value = info as {
    version?: unknown;
    releaseDate?: unknown;
    releaseNotes?: unknown;
  };
  const snapshot: UpdateInfoSnapshot = {
    version: typeof value.version === "string" ? value.version : "",
  };
  if (typeof value.releaseDate === "string") snapshot.releaseDate = value.releaseDate;
  if (typeof value.releaseNotes === "string") {
    snapshot.releaseNotes = value.releaseNotes;
  } else if (Array.isArray(value.releaseNotes)) {
    snapshot.releaseNotes = value.releaseNotes
      .map((note) => {
        if (typeof note === "string") return note;
        if (typeof note === "object" && note !== null && "note" in note && typeof note.note === "string") {
          return note.note;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return snapshot;
}

function statesEqual(left: UpdateState, right: UpdateState): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function cloneState(value: UpdateState): UpdateState {
  const copy: UpdateState = {
    ...value,
  };
  if (value.update !== undefined) copy.update = { ...value.update };
  else delete copy.update;
  if (value.progress !== undefined) copy.progress = { ...value.progress };
  else delete copy.progress;
  if (value.error === undefined) delete copy.error;
  return copy;
}
