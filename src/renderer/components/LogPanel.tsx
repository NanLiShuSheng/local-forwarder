import { useMemo, useState } from "react";
import type { LogEntry } from "../../shared/contracts";

export function LogPanel({ logs }: { logs: LogEntry[] }) {
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState("all");
  const visible = useMemo(() => logs.filter((entry) => (level === "all" || entry.level === level) && entry.message.toLowerCase().includes(query.toLowerCase())).slice(-200).reverse(), [logs, level, query]);
  return <section className="panel log-panel"><div className="panel-heading"><div><p className="eyebrow">Observability</p><h2>Logs</h2></div><div className="filters"><select aria-label="Log level" value={level} onChange={(event) => setLevel(event.target.value)}><option value="all">All levels</option><option value="info">Info</option><option value="warn">Warn</option><option value="error">Error</option></select><input aria-label="Filter logs" placeholder="Filter" value={query} onChange={(event) => setQuery(event.target.value)} /></div></div><div className="log-list">{visible.length === 0 ? <p className="empty">No logs yet.</p> : visible.map((entry, index) => <div className="log-row" key={`${entry.timestamp}-${index}`}><time>{new Date(entry.timestamp).toLocaleTimeString()}</time><span className={`log-level ${entry.level}`}>{entry.level}</span><span>{entry.message}</span></div>)}</div></section>;
}
