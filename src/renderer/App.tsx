import { useEffect, useRef, useState } from "react";
import type { AppConfig, EncryptionDirectoryKind, EncryptionMode, EncryptionPreferences, EncryptionPreferencesPatch, EncryptionProgress, EncryptionResult, LogEntry, ManualRequestConfig, ManualRequestResponse, ProxyInstanceSummary, RuntimeStatus, UpdateState } from "../shared/contracts";
import { AppearancePage } from "./components/AppearancePage";
import { ConfigPages, type Page } from "./components/ConfigPages";
import { LogPanel } from "./components/LogPanel";
import { JsonPreviewPage } from "./components/JsonPreviewPage";
import { RuleList } from "./components/RuleList";
import { ProxyInstancePanel } from "./components/ProxyInstancePanel";
import { ProxyInstanceSidebar } from "./components/ProxyInstanceSidebar";
import { UpdateCard } from "./components/UpdateCard";
import { ToastProvider, useToast } from "./components/ToastProvider";
import { createManualCheckTracker, createUpdateStateSynchronizer, resolveManualCheckResult } from "./update-state";
import { useTheme } from "./useTheme";

const initialStatus: RuntimeStatus = { state: "stopped", requestCount: 0, tcpConnections: 0 };
const initialUpdateState: UpdateState = { state: "idle", currentVersion: "" };
const initialEncryptionPreferences: EncryptionPreferences = { inputDir: "", outputDir: "", inputHistory: [], outputHistory: [] };
const initialConfig: AppConfig = { server: { bindHost: "127.0.0.1", port: 8080, timeoutMs: 30000, loggingEnabled: true }, httpRules: [], tcpTargets: [], localValues: {}, mapValues: {}, accounts: {}, cache: { rootDir: "", downloadTarget: "", decryptEnabled: false, autoDownload: false }, request: { host: "127.0.0.1", port: 8080, paramsText: "" }, stringTool: { inputText: "", outputText: "", operation: "replace", findText: "", replaceText: "" } };
type SidebarNavIconName = "runtime" | "request" | "string" | "json" | "local" | "values" | "encryption" | "logs" | "appearance";
const sidebarNavIconPaths: Record<SidebarNavIconName, string[]> = {
  runtime: ["M4 13a8 8 0 1 1 16 0", "M12 13l3.5-3.5", "M7 17h10"],
  request: ["M5 19 19 5", "M9 5h10v10"],
  string: ["M4 6h16", "M4 12h10", "M4 18h7"],
  json: ["M8 4c-2 0-3 1-3 3v2c0 2-1 3-2 3 1 0 2 1 2 3v2c0 2 1 3 3 3", "M16 4c2 0 3 1 3 3v2c0 2 1 3 2 3-1 0-2 1-2 3v2c0 2-1 3-3 3"],
  local: ["M5 4h14v16H5z", "M8 8h8", "M8 12h8", "M8 16h5"],
  values: ["M5 6c0-1.1 3.1-2 7-2s7 .9 7 2-3.1 2-7 2-7-.9-7-2Z", "M5 6v6c0 1.1 3.1 2 7 2s7-.9 7-2V6", "M5 12v6c0 1.1 3.1 2 7 2s7-.9 7-2v-6"],
  encryption: ["M7 10V7a5 5 0 0 1 10 0v3", "M5 10h14v10H5z", "M12 14v2"],
  logs: ["M5 6h14", "M5 12h14", "M5 18h14"],
  appearance: ["M5 6h14", "M8 4v4", "M5 12h14", "M15 10v4", "M5 18h14", "M11 16v4"],
};
const pages: Array<{ id: Page; label: string; icon: SidebarNavIconName }> = [{ id: "runtime", label: "概览", icon: "runtime" }, { id: "request", label: "请求", icon: "request" }, { id: "encryption", label: "加密", icon: "encryption" }, { id: "json", label: "JSON 可视化", icon: "json" }, { id: "logs", label: "日志", icon: "logs" }, { id: "string", label: "字符串", icon: "string" }, { id: "local", label: "本地变量", icon: "local" }, { id: "values", label: "登录缓存", icon: "values" }, { id: "appearance", label: "外观", icon: "appearance" }];

export function createVersionedLogReader(readLogs: () => Promise<LogEntry[]>, applyLogs: (logs: LogEntry[]) => void) {
  let version = 0;
  return {
    read: async () => {
      const requestVersion = ++version;
      const logs = await readLogs();
      if (requestVersion === version) applyLogs(logs);
    },
    invalidate: () => { version += 1; },
  };
}

function SidebarNavIcon({ name }: { name: SidebarNavIconName }) {
  return <svg className="sidebar-nav-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">{sidebarNavIconPaths[name].map((path) => <path key={path} d={path} />)}</svg>;
}

function AppContent() {
  const { mode, theme, setMode } = useTheme();
  const { notify, notifyError } = useToast();
  const [page, setPage] = useState<Page>("runtime");
  const [status, setStatus] = useState(initialStatus);
  const [instances, setInstances] = useState<ProxyInstanceSummary[]>([]);
  const [config, setConfig] = useState(initialConfig);
  const [sharedValues, setSharedValues] = useState<Record<string, string>>({});
  const [loginCache, setLoginCache] = useState<Record<string, string>>({});
  const [encryptionPreferences, setEncryptionPreferences] = useState(initialEncryptionPreferences);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [selectedLog, setSelectedLog] = useState<LogEntry>();
  const [bulkRuntimeAction, setBulkRuntimeAction] = useState<"start" | "stop">();
  const [jsonPrefill, setJsonPrefill] = useState<string>();
  const [appVersion, setAppVersion] = useState("");
  const [updateState, setUpdateState] = useState<UpdateState>(initialUpdateState);
  const [dismissedUpdateVersion, setDismissedUpdateVersion] = useState<string>();
  const manualCheckTrackerRef = useRef<ReturnType<typeof createManualCheckTracker> | undefined>(undefined);
  if (manualCheckTrackerRef.current === undefined) {
    manualCheckTrackerRef.current = createManualCheckTracker();
  }
  const manualCheckTracker = manualCheckTrackerRef.current;
  const updateStateSynchronizerRef = useRef<ReturnType<typeof createUpdateStateSynchronizer> | undefined>(undefined);
  if (updateStateSynchronizerRef.current === undefined) {
    updateStateSynchronizerRef.current = createUpdateStateSynchronizer(initialUpdateState, setUpdateState);
  }
  const updateStateSynchronizer = updateStateSynchronizerRef.current;
  const logReaderRef = useRef<ReturnType<typeof createVersionedLogReader> | null>(null);
  if (logReaderRef.current === null) logReaderRef.current = createVersionedLogReader(() => window.forwarder.logs(), setLogs);
  const readLogs = () => logReaderRef.current!.read();

  useEffect(() => {
    if (status.error !== undefined) notifyError(status.error, "代理运行失败");
  }, [notifyError, status.error]);

  useEffect(() => {
    let mounted = true;
    const initialSnapshot = updateStateSynchronizer.beginSnapshot();
    const unsubscribe = window.forwarder.onUpdateState((nextState) => {
      if (mounted) updateStateSynchronizer.receiveEvent(nextState);
    });
    void Promise.all([window.forwarder.getAppVersion(), window.forwarder.getUpdateState()]).then(([version, nextState]) => {
      if (!mounted) return;
      setAppVersion(version);
      updateStateSynchronizer.receiveSnapshot(initialSnapshot, nextState);
    }).catch((cause) => {
      if (mounted) notifyError(cause, "无法加载更新状态");
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [notifyError]);

  useEffect(() => {
    const requestId = manualCheckTracker.current();
    if (requestId === undefined) return;
    if (!manualCheckTracker.canResolve(requestId, updateStateSynchronizer.getRevision(), updateState.state)) return;
    const resolution = resolveManualCheckResult(manualCheckTracker.hasPending(), updateState.state);
    if (resolution.pending) return;
    if (manualCheckTracker.complete(requestId) && resolution.notifyLatest) notify({ kind: "success", message: "当前已是最新版本" });
  }, [notify, updateState.state]);

  const checkForUpdates = async () => {
    setDismissedUpdateVersion(undefined);
    const checkSnapshot = updateStateSynchronizer.beginSnapshot();
    const requestId = manualCheckTracker.begin(checkSnapshot.eventRevision, updateStateSynchronizer.getState().state);
    try {
      const result = await window.forwarder.checkForUpdates();
      if (!manualCheckTracker.isCurrent(requestId)) return;
      if (!result.ok) {
        manualCheckTracker.complete(requestId);
        notifyError(result.error ?? "检查更新失败", "检查更新失败");
        return;
      }
      const nextState = await window.forwarder.getUpdateState();
      updateStateSynchronizer.receiveSnapshot(checkSnapshot, nextState);
      if (!manualCheckTracker.isCurrent(requestId)) return;
      const effectiveState = updateStateSynchronizer.getState();
      if (effectiveState.state === "error") {
        manualCheckTracker.complete(requestId);
        notifyError(effectiveState.error ?? "检查更新失败", "检查更新失败");
        return;
      }
      if (!manualCheckTracker.canResolve(requestId, updateStateSynchronizer.getRevision(), effectiveState.state, true)) return;
      const resolution = resolveManualCheckResult(manualCheckTracker.hasPending(), effectiveState.state);
      if (!resolution.pending && manualCheckTracker.complete(requestId) && resolution.notifyLatest) notify({ kind: "success", message: "当前已是最新版本" });
    } catch (cause) {
      if (manualCheckTracker.complete(requestId)) notifyError(cause, "检查更新失败");
    }
  };

  const downloadUpdate = async () => {
    try {
      const result = await window.forwarder.downloadUpdate();
      if (!result.ok) notifyError(result.error ?? "下载更新失败", "下载更新失败");
    } catch (cause) {
      notifyError(cause, "下载更新失败");
    }
  };

  const installUpdate = async () => {
    try {
      const result = await window.forwarder.installUpdate();
      if (!result.ok) notifyError(result.error ?? "安装更新失败", "安装更新失败");
    } catch (cause) {
      notifyError(cause, "安装更新失败");
    }
  };

  const dismissUpdate = () => {
    if (updateState.update?.version !== undefined) setDismissedUpdateVersion(updateState.update.version);
  };

  const refresh = async () => {
    try {
      const [nextInstances, nextConfig, nextSharedValues, nextLoginCache, nextStatus, nextEncryptionPreferences] = await Promise.all([window.forwarder.listProxyInstances(), window.forwarder.getConfig(), window.forwarder.getSharedValues(), window.forwarder.getLoginCache(), window.forwarder.status(), window.forwarder.getEncryptionPreferences(), readLogs()]);
      setInstances(nextInstances);
      setConfig(nextConfig);
      setSharedValues(nextSharedValues);
      setLoginCache(nextLoginCache);
      setStatus(nextStatus);
      setEncryptionPreferences(nextEncryptionPreferences);
    } catch (cause) {
      notifyError(cause, "无法加载运行状态");
    }
  };

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      void window.forwarder.listProxyInstances().then(setInstances).catch(() => undefined);
      void window.forwarder.getLoginCache().then(setLoginCache).catch(() => undefined);
      void window.forwarder.status().then(setStatus).catch(() => undefined);
      void readLogs().catch(() => undefined);
    }, 2000);
    return () => window.clearInterval(timer);
  }, []);

  const save = async (nextConfig: AppConfig) => {
    const result = await window.forwarder.saveConfig(nextConfig);
    if (!result.ok) {
      notifyError(result.error ?? "配置保存失败", "配置保存失败");
      return false;
    }
    setConfig(nextConfig);
    return true;
  };

  const saveSharedValues = async (values: Record<string, string>) => {
    const result = await window.forwarder.saveSharedValues(values);
    if (!result.ok) {
      notifyError(result.error ?? "本地变量保存失败", "本地变量保存失败");
      return false;
    }
    setSharedValues(values);
    setInstances(await window.forwarder.listProxyInstances());
    return true;
  };

  const saveLoginCache = async (values: Record<string, string>) => {
    const result = await window.forwarder.saveLoginCache(values);
    if (!result.ok) {
      notifyError(result.error ?? "登录缓存保存失败", "登录缓存保存失败");
      return false;
    }
    setLoginCache(values);
    setInstances(await window.forwarder.listProxyInstances());
    return true;
  };

  const chooseProjectDirectory = async () => {
    const result = await window.forwarder.selectProjectDirectory();
    if (result.canceled) return false;
    if (!result.ok || result.path === undefined) {
      notifyError(result.error ?? "选择项目目录失败", "选择项目目录失败");
      return false;
    }
    return save({ ...config, projectPath: result.path });
  };

  const selectProxyInstance = async (id: string) => {
    const result = await window.forwarder.selectProxyInstance(id);
    if (!result.ok) {
      notifyError(result.error ?? "代理实例切换失败", "代理实例切换失败");
      return;
    }
    await refresh();
  };

  const createProxyInstance = async () => {
    const result = await window.forwarder.createProxyInstance();
    if (!result.ok) {
      notifyError(result.error ?? "新增代理实例失败", "新增代理实例失败");
      return;
    }
    await refresh();
  };

  const duplicateProxyInstance = async () => {
    const result = await window.forwarder.duplicateProxyInstance();
    if (!result.ok) {
      notifyError(result.error ?? "复制代理实例失败", "复制代理实例失败");
      return;
    }
    await refresh();
  };

  const renameProxyInstance = async (id: string, name: string): Promise<boolean> => {
    const result = await window.forwarder.renameProxyInstance(id, name);
    if (!result.ok) {
      notifyError(result.error ?? "代理名称保存失败", "代理名称保存失败");
      return false;
    }
    setInstances(await window.forwarder.listProxyInstances());
    return true;
  };

  const deleteProxyInstance = async (id: string): Promise<boolean> => {
    const result = await window.forwarder.deleteProxyInstance(id);
    if (!result.ok) {
      notifyError(result.error ?? "删除代理实例失败", "删除代理实例失败");
      return false;
    }
    await refresh();
    return true;
  };

  const toggleProxyInstance = async (instance: ProxyInstanceSummary) => {
    if (instance.status.state === "starting" || instance.status.state === "stopping") return;
    try {
      if (instance.status.state === "running") await window.forwarder.stop(instance.id);
      else await window.forwarder.start(instance.id);
      await refresh();
    } catch (cause) {
      notifyError(cause, "代理状态切换失败");
      await refresh();
    }
  };

  const startAll = async () => {
    setBulkRuntimeAction("start");
    try {
      const result = await window.forwarder.startAll();
      if (!result.ok) notifyError(result.error ?? "一键开启失败", "一键开启失败");
      await refresh();
    } finally {
      setBulkRuntimeAction(undefined);
    }
  };

  const stopAll = async () => {
    setBulkRuntimeAction("stop");
    try {
      const result = await window.forwarder.stopAll();
      if (!result.ok) notifyError(result.error ?? "一键关闭失败", "一键关闭失败");
      await refresh();
    } finally {
      setBulkRuntimeAction(undefined);
    }
  };

  const start = async () => {
    try {
      setStatus(await window.forwarder.start());
      setInstances(await window.forwarder.listProxyInstances());
    } catch (cause) {
      notifyError(cause, "代理启动失败");
      await refresh();
    }
  };

  const stop = async () => {
    try {
      setStatus(await window.forwarder.stop());
      setInstances(await window.forwarder.listProxyInstances());
    } catch (cause) {
      notifyError(cause, "代理停止失败");
    }
  };

  const clearLogs = async (): Promise<boolean> => {
    try {
      const result = await window.forwarder.clearLogs();
      if (!result.ok) {
        notifyError(result.error ?? "日志清空失败", "日志清空失败");
        return false;
      }
      logReaderRef.current?.invalidate();
      setLogs([]);
      return true;
    } catch (cause) {
      notifyError(cause, "日志清空失败");
      return false;
    }
  };

  const fillJsonPreview = (text: string) => {
    setJsonPrefill(text);
    setPage("json");
  };

  const saveEncryptionPreferences = async (patch: EncryptionPreferencesPatch): Promise<boolean> => {
    const result = await window.forwarder.saveEncryptionPreferences(patch);
    if (!result.ok) {
      notifyError(result.error ?? "保存加密目录失败", "保存加密目录失败");
      return false;
    }
    setEncryptionPreferences((current) => result.preferences ?? { ...current, ...patch });
    return true;
  };

  const selectEncryptionDirectory = async (kind: EncryptionDirectoryKind): Promise<string | undefined> => {
    const result = await window.forwarder.selectEncryptionDirectory(kind);
    if (result.canceled) return undefined;
    if (!result.ok || result.path === undefined) {
      notifyError(result.error ?? "选择加密目录失败", "选择加密目录失败");
      return undefined;
    }
    const selectedPath = result.path;
    setEncryptionPreferences((current) => result.preferences ?? (kind === "input" ? { ...current, inputDir: selectedPath } : { ...current, outputDir: selectedPath }));
    return selectedPath;
  };

  const encryptDirectory = async (inputDir: string, outputDir: string, mode: EncryptionMode): Promise<EncryptionResult> => {
    const result = await window.forwarder.encryptDirectory(inputDir, outputDir, mode);
    if (!result.ok) notifyError(result.error ?? "加密失败", "加密失败");
    return result;
  };

  const sendRequest = async (request: ManualRequestConfig): Promise<ManualRequestResponse> => {
    const result = await window.forwarder.sendRequest(request);
    if (!result.ok) notifyError(result.error ?? "请求失败", "请求失败");
    else {
      await refresh();
    }
    return result;
  };

  const pageProps = { config, logs, onChange: save, encryptionPreferences, onSelectEncryptionDirectory: selectEncryptionDirectory, onSaveEncryptionPreferences: saveEncryptionPreferences, onEncryptDirectory: encryptDirectory, onEncryptionProgress: window.forwarder.onEncryptionProgress, onSendRequest: sendRequest, sharedValues, loginCache, onSaveSharedValues: saveSharedValues, onSaveLoginCache: saveLoginCache };

  return <main className="app-shell" data-theme={theme}>
    <aside className="sidebar">
      <ProxyInstanceSidebar instances={instances} onSelect={selectProxyInstance} onCreate={createProxyInstance} onDelete={deleteProxyInstance} onDuplicate={duplicateProxyInstance} onToggle={toggleProxyInstance} onStartAll={startAll} onStopAll={stopAll} bulkBusy={bulkRuntimeAction !== undefined} />
      <nav className="sidebar-nav" aria-label="功能导航">
        {pages.map((item) => <button key={item.id} className={page === item.id ? "active" : ""} aria-current={page === item.id ? "page" : undefined} onClick={() => setPage(item.id)}><SidebarNavIcon name={item.icon} /><span>{item.label}</span></button>)}
      </nav>
    </aside>
    <section className={`content ${page === "request" ? "request-page-content" : ""} ${page === "json" ? "json-page-content" : ""} ${page === "logs" ? "log-page-content" : ""}`}>
      {page === "appearance" && <AppearancePage mode={mode} theme={theme} onModeChange={setMode} appVersion={appVersion || updateState.currentVersion} checkingForUpdates={updateState.state === "checking"} onCheckForUpdates={checkForUpdates} />}
      {page === "runtime" && <><ProxyInstancePanel instances={instances} status={status} config={config} onChange={save} onChooseProjectDirectory={chooseProjectDirectory} onRename={renameProxyInstance} onStart={start} onStop={stop} /><ConfigPages page="addresses" {...pageProps} /></>}
      <div hidden={page !== "json"}><JsonPreviewPage prefillText={jsonPrefill} onPrefillApplied={() => setJsonPrefill(undefined)} /></div>
      {page === "rules" && <RuleList config={config} onChange={save} />}
      {page !== "runtime" && page !== "rules" && page !== "logs" && page !== "appearance" && page !== "json" && <ConfigPages page={page} {...pageProps} />}
      {page === "logs" && <LogPanel logs={logs} selected={selectedLog} onSelect={setSelectedLog} onClear={clearLogs} onFillJson={fillJsonPreview} />}
    </section>
    <UpdateCard state={updateState} dismissedVersion={dismissedUpdateVersion} onDownload={downloadUpdate} onInstall={installUpdate} onDismiss={dismissUpdate} />
  </main>;
}

function App() {
  return <ToastProvider><AppContent /></ToastProvider>;
}

export default App;
