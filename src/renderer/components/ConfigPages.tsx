import type { AppConfig, LogEntry } from "../../shared/contracts";

export type Page = "runtime" | "rules" | "values" | "cache" | "logs" | "settings";
interface ConfigPagesProps { page: Page; config: AppConfig; logs: LogEntry[]; onChange: (config: AppConfig) => Promise<void>; onImport: () => Promise<void>; onExport: () => Promise<void>; }
const sensitive = /password|token|secret|account|authorization|mobile/i;

export function ConfigPages({ page, config, logs, onChange, onImport, onExport }: ConfigPagesProps) {
  if (page === "values") return <section className="panel"><p className="eyebrow">Local state</p><h2>Variables</h2><div className="value-list">{Object.entries(config.localValues).map(([key, value]) => <div key={key}><strong>{key}</strong><span>{sensitive.test(key) ? "••••••••" : value}</span></div>)}</div></section>;
  if (page === "cache") return <section className="panel"><p className="eyebrow">Resources</p><h2>Cache</h2><dl className="settings-list"><div><dt>Root directory</dt><dd>{config.cache.rootDir || "Default application cache"}</dd></div><div><dt>Download target</dt><dd>{config.cache.downloadTarget || "Not configured"}</dd></div><div><dt>Decrypt .d resources</dt><dd>{config.cache.decryptEnabled ? "Enabled" : "Disabled"}</dd></div></dl></section>;
  if (page === "settings") return <section className="panel"><p className="eyebrow">Configuration</p><h2>Settings</h2><div className="form-grid"><label>Bind host<input value={config.server.bindHost} onChange={(event) => void onChange({ ...config, server: { ...config.server, bindHost: event.target.value } })} /></label><label>Port<input type="number" value={config.server.port} onChange={(event) => void onChange({ ...config, server: { ...config.server, port: Number(event.target.value) } })} /></label><label>Timeout (ms)<input type="number" value={config.server.timeoutMs} onChange={(event) => void onChange({ ...config, server: { ...config.server, timeoutMs: Number(event.target.value) } })} /></label></div><div className="button-row"><button onClick={() => void onImport()}>Import legacy config</button><button onClick={() => void onExport()}>Export legacy config</button></div></section>;
  if (page === "logs") return <section className="panel"><p className="eyebrow">Observability</p><h2>{logs.length} log entries</h2><p className="muted">Use the logs page to inspect recent service activity.</p></section>;
  return null;
}
