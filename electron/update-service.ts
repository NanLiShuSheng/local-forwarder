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
}

export interface UpdateServiceOptions {
  currentVersion: string;
  isPackaged: boolean;
  isSmokeMode: boolean;
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

const BACKGROUND_CHECK_DELAY_MS = 10_000;
const FALLBACK_ERRORS = {
  check: "检查更新失败",
  download: "下载更新失败",
  install: "安装更新失败",
} as const;

type UpdateOperation = keyof typeof FALLBACK_ERRORS;
type OperationResult = { ok: boolean; error?: string };

export function createUpdateService(options: UpdateServiceOptions): UpdateService {
  const updater = options.updater;
  const active = options.isPackaged && !options.isSmokeMode && updater !== undefined;
  let state: UpdateState = {
    state: "idle",
    currentVersion: options.currentVersion,
  };
  let disposed = false;
  let backgroundStarted = false;
  let backgroundTimer: ReturnType<typeof setTimeout> | undefined;
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
    removeListeners.push(updater.onError(() => {
      setError(currentOperation);
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
      setError("install");
      return Promise.resolve({ ok: false, error: FALLBACK_ERRORS.install });
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
        .catch(() => {
          setError(operation);
          return { ok: false, error: FALLBACK_ERRORS[operation] };
        });
    } catch {
      setError(operation);
      return Promise.resolve({ ok: false, error: FALLBACK_ERRORS[operation] });
    }
  }

  function startBackgroundCheck(): Promise<void> {
    if (!active || backgroundStarted || disposed) return Promise.resolve();
    backgroundStarted = true;
    backgroundTimer = setTimeout(() => {
      backgroundTimer = undefined;
      void check();
    }, BACKGROUND_CHECK_DELAY_MS);
    backgroundTimer.unref?.();
    return Promise.resolve();
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    if (backgroundTimer !== undefined) clearTimeout(backgroundTimer);
    backgroundTimer = undefined;
    for (const removeListener of removeListeners.splice(0)) removeListener();
  }

  function setError(operation: UpdateOperation): void {
    setState({
      state: "error",
      currentVersion: options.currentVersion,
      update: state.update,
      error: FALLBACK_ERRORS[operation],
    });
  }

  function setState(next: UpdateState): void {
    if (disposed || statesEqual(state, next)) return;
    state = cloneState(next);
    options.publish(getState());
  }

  return { getState, startBackgroundCheck, check, download, install, dispose };
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
