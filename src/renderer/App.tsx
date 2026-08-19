import { useEffect, useState } from "react";
import type { AppConfig, LogEntry, RuntimeStatus } from "../shared/contracts";
import { ConfigPages, type Page } from "./components/ConfigPages";
import { LogPanel } from "./components/LogPanel";
import { RuleList } from "./components/RuleList";
import { RuntimePanel } from "./components/RuntimePanel";

const initialStatus: RuntimeStatus = { state: "stopped", requestCount: 0, tcpConnections: 0 };
const initialConfig: AppConfig = { server: { bindHost: "127.0.0.1", port: 8080, timeoutMs: 30000, loggingEnabled: true }, httpRules: [], tcpTargets: [], localValues: {}, mapValues: {}, accounts: {}, cache: { rootDir: "", downloadTarget: "", decryptEnabled: false, autoDownload: false } };
const pages: Array<{ id: Page; label: string }> = [{ id: "runtime", label: "Overview" }, { id: "rules", label: "Rules" }, { id: "values", label: "Variables" }, { id: "cache", label: "Cache" }, { id: "logs", label: "Logs" }, { id: "settings", label: "Settings" }];

function App() {
  const [page, setPage] = useState<Page>("runtime");
  const [status, setStatus] = useState(initialStatus);
  const [config, setConfig] = useState(initialConfig);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [error, setError] = useState("");
  const refresh = async () => { try { const [nextConfig, nextStatus, nextLogs] = await Promise.all([window.forwarder.getConfig(), window.forwarder.status(), window.forwarder.logs()]); setConfig(nextConfig); setStatus(nextStatus); setLogs(nextLogs); } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load runtime"); } };
  useEffect(() => { void refresh(); const timer = window.setInterval(() => { void window.forwarder.status().then(setStatus).catch(() => undefined); void window.forwarder.logs().then(setLogs).catch(() => undefined); }, 2000); return () => window.clearInterval(timer); }, []);
  const save = async (nextConfig: AppConfig) => { const result = await window.forwarder.saveConfig(nextConfig); if (!result.ok) { setError(result.error ?? "Could not save configuration"); return; } setConfig(nextConfig); setError(""); };
  const start = async () => { try { setStatus(await window.forwarder.start()); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not start service"); await refresh(); } };
  const stop = async () => { try { setStatus(await window.forwarder.stop()); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not stop service"); } };
  const importLegacy = async () => { const result = await window.forwarder.importLegacy(); if (!result.ok) setError(result.error ?? "Import failed"); else if (result.config) setConfig(result.config); };
  const exportConfig = async () => { const result = await window.forwarder.exportConfig(); if (!result.ok) setError(result.error ?? "Export failed"); };
  return <main className="app-shell"><aside className="sidebar"><div className="brand"><span className="brand-mark">↗</span><div><strong>Local Forwarder</strong><small>Intel Mac service</small></div></div><nav aria-label="Main navigation">{pages.map((item) => <button key={item.id} className={page === item.id ? "active" : ""} onClick={() => setPage(item.id)}>{item.label}</button>)}</nav><div className="sidebar-footer"><span className={`status-dot ${status.state}`} />{status.state}</div></aside><section className="content"><header className="topbar"><div><p className="eyebrow">Control center</p><h1>{pages.find((item) => item.id === page)?.label}</h1></div><span className="address-chip">{config.server.bindHost}:{config.server.port}</span></header>{error && <div className="error-box" role="alert">{error}</div>}{page === "runtime" && <div className="dashboard-grid"><RuntimePanel status={status} address={`${config.server.bindHost}:${config.server.port}`} onStart={start} onStop={stop} /><section className="panel summary-panel"><p className="eyebrow">Configuration</p><h2>{config.httpRules.length} HTTP rules</h2><p>{config.tcpTargets.length} TCP targets · {Object.keys(config.localValues).length} local variables</p><div className="mini-stat"><span>Logging</span><strong>{config.server.loggingEnabled ? "Enabled" : "Disabled"}</strong></div></section></div>}{page === "rules" && <RuleList config={config} onChange={save} />}{page !== "runtime" && page !== "rules" && page !== "logs" && <ConfigPages page={page} config={config} logs={logs} onChange={save} onImport={importLegacy} onExport={exportConfig} />}{page === "logs" && <LogPanel logs={logs} />}</section></main>;
}

export default App;
