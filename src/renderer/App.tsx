import { useEffect, useState } from "react";
import type { AppConfig, EncryptionDirectoryKind, EncryptionMode, EncryptionPreferences, EncryptionResult, LogEntry, ManualRequestConfig, ManualRequestResponse, ProxyInstanceSummary, RuntimeStatus } from "../shared/contracts";
import { ConfigPages, type Page } from "./components/ConfigPages";
import { DismissibleError } from "./components/DismissibleError";
import { LogPanel } from "./components/LogPanel";
import { RuleList } from "./components/RuleList";
import { ProxyInstancePanel } from "./components/ProxyInstancePanel";
import { statusLabels } from "./labels";

const initialStatus: RuntimeStatus = { state: "stopped", requestCount: 0, tcpConnections: 0 };
const initialEncryptionPreferences: EncryptionPreferences = { inputDir: "", outputDir: "" };
const initialConfig: AppConfig = { server: { bindHost: "127.0.0.1", port: 8080, timeoutMs: 30000, loggingEnabled: true }, httpRules: [], tcpTargets: [], localValues: {}, mapValues: {}, accounts: {}, cache: { rootDir: "", downloadTarget: "", decryptEnabled: false, autoDownload: false }, request: { host: "127.0.0.1", port: 8080, paramsText: "" }, stringTool: { inputText: "", outputText: "", operation: "replace", findText: "", replaceText: "" } };
const pages: Array<{ id: Page; label: string }> = [{ id: "runtime", label: "概览" }, { id: "request", label: "请求" }, { id: "string", label: "字符串" }, { id: "local", label: "本地变量" }, { id: "values", label: "登录缓存" }, { id: "encryption", label: "加密" }, { id: "logs", label: "日志" }, { id: "settings", label: "设置" }];

function App() {
  const [page, setPage] = useState<Page>("runtime");
  const [status, setStatus] = useState(initialStatus);
  const [instances, setInstances] = useState<ProxyInstanceSummary[]>([]);
  const [config, setConfig] = useState(initialConfig);
  const [encryptionPreferences, setEncryptionPreferences] = useState(initialEncryptionPreferences);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [error, setError] = useState("");
  const refresh = async () => { try { const [nextInstances, nextConfig, nextStatus, nextLogs, nextEncryptionPreferences] = await Promise.all([window.forwarder.listProxyInstances(), window.forwarder.getConfig(), window.forwarder.status(), window.forwarder.logs(), window.forwarder.getEncryptionPreferences()]); setInstances(nextInstances); setConfig(nextConfig); setStatus(nextStatus); setLogs(nextLogs); setEncryptionPreferences(nextEncryptionPreferences); } catch (cause) { setError(cause instanceof Error ? cause.message : "无法加载运行状态"); } };
  useEffect(() => { void refresh(); const timer = window.setInterval(() => { void window.forwarder.listProxyInstances().then(setInstances).catch(() => undefined); void window.forwarder.status().then(setStatus).catch(() => undefined); void window.forwarder.logs().then(setLogs).catch(() => undefined); }, 2000); return () => window.clearInterval(timer); }, []);
  const save = async (nextConfig: AppConfig) => { const result = await window.forwarder.saveConfig(nextConfig); if (!result.ok) { setError(result.error ?? "配置保存失败"); return false; } setConfig(nextConfig); setError(""); return true; };
  const chooseProjectDirectory = async () => { const result = await window.forwarder.selectProjectDirectory(); if (result.canceled) return false; if (!result.ok || result.path === undefined) { setError(result.error ?? "选择项目目录失败"); return false; } return save({ ...config, projectPath: result.path }); };
  const selectProxyInstance = async (id: string) => { const result = await window.forwarder.selectProxyInstance(id); if (!result.ok) { setError(result.error ?? "代理实例切换失败"); return; } await refresh(); };
  const createProxyInstance = async () => { const result = await window.forwarder.createProxyInstance(); if (!result.ok) { setError(result.error ?? "新增代理实例失败"); return; } await refresh(); };
  const duplicateProxyInstance = async () => { const result = await window.forwarder.duplicateProxyInstance(); if (!result.ok) { setError(result.error ?? "复制代理实例失败"); return; } await refresh(); };
  const start = async () => { try { setStatus(await window.forwarder.start()); setInstances(await window.forwarder.listProxyInstances()); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : "代理启动失败"); await refresh(); } };
  const stop = async () => { try { setStatus(await window.forwarder.stop()); setInstances(await window.forwarder.listProxyInstances()); } catch (cause) { setError(cause instanceof Error ? cause.message : "代理停止失败"); } };
  const importLegacy = async () => { const result = await window.forwarder.importLegacy(); if (!result.ok) setError(result.error ?? "导入失败"); else if (result.config) setConfig(result.config); };
  const exportConfig = async () => { const result = await window.forwarder.exportConfig(); if (!result.ok) setError(result.error ?? "导出失败"); };
  const saveEncryptionPreferences = async (patch: Partial<EncryptionPreferences>): Promise<boolean> => { const result = await window.forwarder.saveEncryptionPreferences(patch); if (!result.ok) { setError(result.error ?? "保存加密目录失败"); return false; } setEncryptionPreferences(result.preferences ?? { ...encryptionPreferences, ...patch }); setError(""); return true; };
  const selectEncryptionDirectory = async (kind: EncryptionDirectoryKind): Promise<string | undefined> => { const result = await window.forwarder.selectEncryptionDirectory(kind); if (result.canceled) return undefined; if (!result.ok || result.path === undefined) { setError(result.error ?? "选择加密目录失败"); return undefined; } setEncryptionPreferences((current) => kind === "input" ? { ...current, inputDir: result.path ?? "" } : { ...current, outputDir: result.path ?? "" }); setError(""); return result.path; };
  const encryptDirectory = async (inputDir: string, outputDir: string, mode: EncryptionMode): Promise<EncryptionResult> => { const result = await window.forwarder.encryptDirectory(inputDir, outputDir, mode); if (!result.ok) setError(result.error ?? "加密失败"); else setError(""); return result; };
  const sendRequest = async (request: ManualRequestConfig): Promise<ManualRequestResponse> => { const result = await window.forwarder.sendRequest(request); if (!result.ok) setError(result.error ?? "请求失败"); else setError(""); return result; };
  return <main className="app-shell"><aside className="sidebar"><div className="brand"><span className="brand-mark">↗</span><div><strong>本地转发工具</strong><small>英特尔苹果电脑服务</small></div></div><nav aria-label="主导航">{pages.map((item) => <button key={item.id} className={page === item.id ? "active" : ""} onClick={() => setPage(item.id)}>{item.label}</button>)}</nav><div className="sidebar-footer"><span className={`status-dot ${status.state}`} />{statusLabels[status.state]}</div></aside><section className={`content ${page === "request" ? "request-page-content" : ""}`}>{error && <DismissibleError message={error} onClose={() => setError("")} />}{page === "runtime" && <><ProxyInstancePanel instances={instances} status={status} onSelect={selectProxyInstance} onCreate={createProxyInstance} onDuplicate={duplicateProxyInstance} onStart={start} onStop={stop} /><ConfigPages page="addresses" config={config} logs={logs} onChange={save} onImport={importLegacy} onExport={exportConfig} onChooseProjectDirectory={chooseProjectDirectory} encryptionPreferences={encryptionPreferences} onSelectEncryptionDirectory={selectEncryptionDirectory} onSaveEncryptionPreferences={saveEncryptionPreferences} onEncryptDirectory={encryptDirectory} onSendRequest={sendRequest} /></>}{page === "rules" && <RuleList config={config} onChange={save} />}{page !== "runtime" && page !== "rules" && page !== "logs" && <ConfigPages page={page} config={config} logs={logs} onChange={save} onImport={importLegacy} onExport={exportConfig} onChooseProjectDirectory={chooseProjectDirectory} encryptionPreferences={encryptionPreferences} onSelectEncryptionDirectory={selectEncryptionDirectory} onSaveEncryptionPreferences={saveEncryptionPreferences} onEncryptDirectory={encryptDirectory} onSendRequest={sendRequest} />}{page === "logs" && <LogPanel logs={logs} />}</section></main>;
}

export default App;
