import { useEffect, useState } from "react";
import type { AppConfig, EncryptionDirectoryKind, EncryptionPreferences, EncryptionResult, LogEntry, RuntimeStatus } from "../shared/contracts";
import { ConfigPages, type Page } from "./components/ConfigPages";
import { LogPanel } from "./components/LogPanel";
import { RuleList } from "./components/RuleList";
import { RuntimePanel } from "./components/RuntimePanel";
import { statusLabels } from "./labels";

const initialStatus: RuntimeStatus = { state: "stopped", requestCount: 0, tcpConnections: 0 };
const initialEncryptionPreferences: EncryptionPreferences = { inputDir: "", outputDir: "" };
const initialConfig: AppConfig = { server: { bindHost: "127.0.0.1", port: 8080, timeoutMs: 30000, loggingEnabled: true }, httpRules: [], tcpTargets: [], localValues: {}, mapValues: {}, accounts: {}, cache: { rootDir: "", downloadTarget: "", decryptEnabled: false, autoDownload: false } };
const pages: Array<{ id: Page; label: string }> = [{ id: "runtime", label: "概览" }, { id: "addresses", label: "转发地址" }, { id: "local", label: "本地变量" }, { id: "values", label: "登录缓存" }, { id: "encryption", label: "加密" }, { id: "logs", label: "日志" }, { id: "settings", label: "设置" }];

function App() {
  const [page, setPage] = useState<Page>("runtime");
  const [status, setStatus] = useState(initialStatus);
  const [config, setConfig] = useState(initialConfig);
  const [encryptionPreferences, setEncryptionPreferences] = useState(initialEncryptionPreferences);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [error, setError] = useState("");
  const refresh = async () => { try { const [nextConfig, nextStatus, nextLogs, nextEncryptionPreferences] = await Promise.all([window.forwarder.getConfig(), window.forwarder.status(), window.forwarder.logs(), window.forwarder.getEncryptionPreferences()]); setConfig(nextConfig); setStatus(nextStatus); setLogs(nextLogs); setEncryptionPreferences(nextEncryptionPreferences); } catch (cause) { setError(cause instanceof Error ? cause.message : "无法加载运行状态"); } };
  useEffect(() => { void refresh(); const timer = window.setInterval(() => { void window.forwarder.status().then(setStatus).catch(() => undefined); void window.forwarder.logs().then(setLogs).catch(() => undefined); }, 2000); return () => window.clearInterval(timer); }, []);
  const save = async (nextConfig: AppConfig) => { const result = await window.forwarder.saveConfig(nextConfig); if (!result.ok) { setError(result.error ?? "配置保存失败"); return false; } setConfig(nextConfig); setError(""); return true; };
  const chooseProjectDirectory = async () => { const result = await window.forwarder.selectProjectDirectory(); if (result.canceled) return false; if (!result.ok || result.path === undefined) { setError(result.error ?? "选择项目目录失败"); return false; } return save({ ...config, projectPath: result.path }); };
  const start = async () => { try { setStatus(await window.forwarder.start()); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : "服务启动失败"); await refresh(); } };
  const stop = async () => { try { setStatus(await window.forwarder.stop()); } catch (cause) { setError(cause instanceof Error ? cause.message : "服务停止失败"); } };
  const importLegacy = async () => { const result = await window.forwarder.importLegacy(); if (!result.ok) setError(result.error ?? "导入失败"); else if (result.config) setConfig(result.config); };
  const exportConfig = async () => { const result = await window.forwarder.exportConfig(); if (!result.ok) setError(result.error ?? "导出失败"); };
  const selectEncryptionDirectory = async (kind: EncryptionDirectoryKind): Promise<string | undefined> => { const result = await window.forwarder.selectEncryptionDirectory(kind); if (result.canceled) return undefined; if (!result.ok || result.path === undefined) { setError(result.error ?? "选择加密目录失败"); return undefined; } setEncryptionPreferences((current) => kind === "input" ? { ...current, inputDir: result.path ?? "" } : { ...current, outputDir: result.path ?? "" }); setError(""); return result.path; };
  const encryptDirectory = async (inputDir: string, outputDir: string): Promise<EncryptionResult> => { const result = await window.forwarder.encryptDirectory(inputDir, outputDir); if (!result.ok) setError(result.error ?? "加密失败"); else setError(""); return result; };
  return <main className="app-shell"><aside className="sidebar"><div className="brand"><span className="brand-mark">↗</span><div><strong>本地转发工具</strong><small>英特尔苹果电脑服务</small></div></div><nav aria-label="主导航">{pages.map((item) => <button key={item.id} className={page === item.id ? "active" : ""} onClick={() => setPage(item.id)}>{item.label}</button>)}</nav><div className="sidebar-footer"><span className={`status-dot ${status.state}`} />{statusLabels[status.state]}</div></aside><section className="content"><header className="topbar"><div><p className="eyebrow">控制中心</p><h1>{pages.find((item) => item.id === page)?.label}</h1></div><span className="address-chip">{config.server.bindHost}:{config.server.port}</span></header>{error && <div className="error-box" role="alert">{error}</div>}{page === "runtime" && <div className="dashboard-grid"><RuntimePanel status={status} address={`${config.server.bindHost}:${config.server.port}`} onStart={start} onStop={stop} /><section className="panel summary-panel"><p className="eyebrow">配置</p><h2>{config.httpRules.length} 条 HTTP 规则</h2><p>{config.tcpTargets.length} 个 TCP 目标 · {Object.keys(config.localValues).length} 个本地变量</p><div className="mini-stat"><span>日志记录</span><strong>{config.server.loggingEnabled ? "已启用" : "已停用"}</strong></div></section></div>}{page === "rules" && <RuleList config={config} onChange={save} />}{page !== "runtime" && page !== "rules" && page !== "logs" && <ConfigPages page={page} config={config} logs={logs} onChange={save} onImport={importLegacy} onExport={exportConfig} onChooseProjectDirectory={chooseProjectDirectory} encryptionPreferences={encryptionPreferences} onSelectEncryptionDirectory={selectEncryptionDirectory} onEncryptDirectory={encryptDirectory} />}{page === "logs" && <LogPanel logs={logs} />}</section></main>;
}

export default App;
