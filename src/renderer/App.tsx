import { useEffect, useState } from "react";
import type { AppConfig, EncryptionDirectoryKind, EncryptionMode, EncryptionPreferences, EncryptionProgress, EncryptionResult, LogEntry, ManualRequestConfig, ManualRequestResponse, ProxyInstanceSummary, RuntimeStatus } from "../shared/contracts";
import { AppearancePage } from "./components/AppearancePage";
import { ConfigPages, type Page } from "./components/ConfigPages";
import { DismissibleError } from "./components/DismissibleError";
import { LogPanel } from "./components/LogPanel";
import { RuleList } from "./components/RuleList";
import { ProxyInstancePanel } from "./components/ProxyInstancePanel";
import { ProxyInstanceSidebar } from "./components/ProxyInstanceSidebar";
import { useTheme } from "./useTheme";

const initialStatus: RuntimeStatus = { state: "stopped", requestCount: 0, tcpConnections: 0 };
const initialEncryptionPreferences: EncryptionPreferences = { inputDir: "", outputDir: "" };
const initialConfig: AppConfig = { server: { bindHost: "127.0.0.1", port: 8080, timeoutMs: 30000, loggingEnabled: true }, httpRules: [], tcpTargets: [], localValues: {}, mapValues: {}, accounts: {}, cache: { rootDir: "", downloadTarget: "", decryptEnabled: false, autoDownload: false }, request: { host: "127.0.0.1", port: 8080, paramsText: "" }, stringTool: { inputText: "", outputText: "", operation: "replace", findText: "", replaceText: "" } };
const pages: Array<{ id: Page; label: string }> = [{ id: "runtime", label: "概览" }, { id: "request", label: "请求" }, { id: "string", label: "字符串" }, { id: "local", label: "本地变量" }, { id: "values", label: "登录缓存" }, { id: "encryption", label: "加密" }, { id: "logs", label: "日志" }, { id: "appearance", label: "外观" }];

function App() {
  const { mode, theme, setMode } = useTheme();
  const [page, setPage] = useState<Page>("runtime");
  const [status, setStatus] = useState(initialStatus);
  const [instances, setInstances] = useState<ProxyInstanceSummary[]>([]);
  const [config, setConfig] = useState(initialConfig);
  const [sharedValues, setSharedValues] = useState<Record<string, string>>({});
  const [loginCache, setLoginCache] = useState<Record<string, string>>({});
  const [encryptionPreferences, setEncryptionPreferences] = useState(initialEncryptionPreferences);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [error, setError] = useState("");
  const [bulkRuntimeAction, setBulkRuntimeAction] = useState<"start" | "stop">();

  const refresh = async () => {
    try {
      const [nextInstances, nextConfig, nextSharedValues, nextLoginCache, nextStatus, nextLogs, nextEncryptionPreferences] = await Promise.all([window.forwarder.listProxyInstances(), window.forwarder.getConfig(), window.forwarder.getSharedValues(), window.forwarder.getLoginCache(), window.forwarder.status(), window.forwarder.logs(), window.forwarder.getEncryptionPreferences()]);
      setInstances(nextInstances);
      setConfig(nextConfig);
      setSharedValues(nextSharedValues);
      setLoginCache(nextLoginCache);
      setStatus(nextStatus);
      setLogs(nextLogs);
      setEncryptionPreferences(nextEncryptionPreferences);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法加载运行状态");
    }
  };

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      void window.forwarder.listProxyInstances().then(setInstances).catch(() => undefined);
      void window.forwarder.getLoginCache().then(setLoginCache).catch(() => undefined);
      void window.forwarder.status().then(setStatus).catch(() => undefined);
      void window.forwarder.logs().then(setLogs).catch(() => undefined);
    }, 2000);
    return () => window.clearInterval(timer);
  }, []);

  const save = async (nextConfig: AppConfig) => {
    const result = await window.forwarder.saveConfig(nextConfig);
    if (!result.ok) {
      setError(result.error ?? "配置保存失败");
      return false;
    }
    setConfig(nextConfig);
    setError("");
    return true;
  };

  const saveSharedValues = async (values: Record<string, string>) => {
    const result = await window.forwarder.saveSharedValues(values);
    if (!result.ok) {
      setError(result.error ?? "本地变量保存失败");
      return false;
    }
    setSharedValues(values);
    setInstances(await window.forwarder.listProxyInstances());
    setError("");
    return true;
  };

  const saveLoginCache = async (values: Record<string, string>) => {
    const result = await window.forwarder.saveLoginCache(values);
    if (!result.ok) {
      setError(result.error ?? "登录缓存保存失败");
      return false;
    }
    setLoginCache(values);
    setInstances(await window.forwarder.listProxyInstances());
    setError("");
    return true;
  };

  const chooseProjectDirectory = async () => {
    const result = await window.forwarder.selectProjectDirectory();
    if (result.canceled) return false;
    if (!result.ok || result.path === undefined) {
      setError(result.error ?? "选择项目目录失败");
      return false;
    }
    return save({ ...config, projectPath: result.path });
  };

  const selectProxyInstance = async (id: string) => {
    const result = await window.forwarder.selectProxyInstance(id);
    if (!result.ok) {
      setError(result.error ?? "代理实例切换失败");
      return;
    }
    await refresh();
  };

  const createProxyInstance = async () => {
    const result = await window.forwarder.createProxyInstance();
    if (!result.ok) {
      setError(result.error ?? "新增代理实例失败");
      return;
    }
    await refresh();
  };

  const duplicateProxyInstance = async () => {
    const result = await window.forwarder.duplicateProxyInstance();
    if (!result.ok) {
      setError(result.error ?? "复制代理实例失败");
      return;
    }
    await refresh();
  };

  const renameProxyInstance = async (id: string, name: string): Promise<boolean> => {
    const result = await window.forwarder.renameProxyInstance(id, name);
    if (!result.ok) {
      setError(result.error ?? "代理名称保存失败");
      return false;
    }
    setInstances(await window.forwarder.listProxyInstances());
    setError("");
    return true;
  };

  const deleteProxyInstance = async (id: string): Promise<boolean> => {
    const result = await window.forwarder.deleteProxyInstance(id);
    if (!result.ok) {
      setError(result.error ?? "删除代理实例失败");
      return false;
    }
    await refresh();
    setError("");
    return true;
  };

  const toggleProxyInstance = async (instance: ProxyInstanceSummary) => {
    if (instance.status.state === "starting" || instance.status.state === "stopping") return;
    try {
      if (instance.status.state === "running") await window.forwarder.stop(instance.id);
      else await window.forwarder.start(instance.id);
      await refresh();
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "代理状态切换失败");
      await refresh();
    }
  };

  const startAll = async () => {
    setBulkRuntimeAction("start");
    try {
      const result = await window.forwarder.startAll();
      if (!result.ok) setError(result.error ?? "一键开启失败");
      else setError("");
      await refresh();
    } finally {
      setBulkRuntimeAction(undefined);
    }
  };

  const stopAll = async () => {
    setBulkRuntimeAction("stop");
    try {
      const result = await window.forwarder.stopAll();
      if (!result.ok) setError(result.error ?? "一键关闭失败");
      else setError("");
      await refresh();
    } finally {
      setBulkRuntimeAction(undefined);
    }
  };

  const start = async () => {
    try {
      setStatus(await window.forwarder.start());
      setInstances(await window.forwarder.listProxyInstances());
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "代理启动失败");
      await refresh();
    }
  };

  const stop = async () => {
    try {
      setStatus(await window.forwarder.stop());
      setInstances(await window.forwarder.listProxyInstances());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "代理停止失败");
    }
  };

  const saveEncryptionPreferences = async (patch: Partial<EncryptionPreferences>): Promise<boolean> => {
    const result = await window.forwarder.saveEncryptionPreferences(patch);
    if (!result.ok) {
      setError(result.error ?? "保存加密目录失败");
      return false;
    }
    setEncryptionPreferences(result.preferences ?? { ...encryptionPreferences, ...patch });
    setError("");
    return true;
  };

  const selectEncryptionDirectory = async (kind: EncryptionDirectoryKind): Promise<string | undefined> => {
    const result = await window.forwarder.selectEncryptionDirectory(kind);
    if (result.canceled) return undefined;
    if (!result.ok || result.path === undefined) {
      setError(result.error ?? "选择加密目录失败");
      return undefined;
    }
    setEncryptionPreferences((current) => kind === "input" ? { ...current, inputDir: result.path ?? "" } : { ...current, outputDir: result.path ?? "" });
    setError("");
    return result.path;
  };

  const encryptDirectory = async (inputDir: string, outputDir: string, mode: EncryptionMode): Promise<EncryptionResult> => {
    const result = await window.forwarder.encryptDirectory(inputDir, outputDir, mode);
    if (!result.ok) setError(result.error ?? "加密失败");
    else setError("");
    return result;
  };

  const sendRequest = async (request: ManualRequestConfig): Promise<ManualRequestResponse> => {
    const result = await window.forwarder.sendRequest(request);
    if (!result.ok) setError(result.error ?? "请求失败");
    else {
      setError("");
      await refresh();
    }
    return result;
  };

  const pageProps = { config, logs, onChange: save, encryptionPreferences, onSelectEncryptionDirectory: selectEncryptionDirectory, onSaveEncryptionPreferences: saveEncryptionPreferences, onEncryptDirectory: encryptDirectory, onEncryptionProgress: window.forwarder.onEncryptionProgress, onSendRequest: sendRequest, sharedValues, loginCache, onSaveSharedValues: saveSharedValues, onSaveLoginCache: saveLoginCache };

  return <main className="app-shell" data-theme={theme}>
    <aside className="sidebar">
      <ProxyInstanceSidebar instances={instances} onSelect={selectProxyInstance} onCreate={createProxyInstance} onDelete={deleteProxyInstance} onDuplicate={duplicateProxyInstance} onToggle={toggleProxyInstance} onStartAll={startAll} onStopAll={stopAll} bulkBusy={bulkRuntimeAction !== undefined} />
      <nav className="sidebar-nav" aria-label="功能导航">
        {pages.map((item) => <button key={item.id} className={page === item.id ? "active" : ""} onClick={() => setPage(item.id)}>{item.label}</button>)}
      </nav>
    </aside>
    <section className={`content ${page === "request" ? "request-page-content" : ""}`}>
      {error && <DismissibleError message={error} onClose={() => setError("")} />}
      {page === "appearance" && <AppearancePage mode={mode} theme={theme} onModeChange={setMode} />}
      {page === "runtime" && <><ProxyInstancePanel instances={instances} status={status} config={config} onChange={save} onChooseProjectDirectory={chooseProjectDirectory} onRename={renameProxyInstance} onStart={start} onStop={stop} /><ConfigPages page="addresses" {...pageProps} /></>}
      {page === "rules" && <RuleList config={config} onChange={save} />}
      {page !== "runtime" && page !== "rules" && page !== "logs" && page !== "appearance" && <ConfigPages page={page} {...pageProps} />}
      {page === "logs" && <LogPanel logs={logs} />}
    </section>
  </main>;
}

export default App;
