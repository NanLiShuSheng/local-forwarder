import { useMemo, useState } from "react";
import type { LogEntry } from "../../shared/contracts";
import { logLevelLabels } from "../labels";

export function LogPanel({ logs }: { logs: LogEntry[] }) {
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState("all");
  const visible = useMemo(() => logs.filter((entry) => (level === "all" || entry.level === level) && entry.message.toLowerCase().includes(query.toLowerCase())).slice(-200).reverse(), [logs, level, query]);
  return <section className="panel log-panel"><div className="panel-heading"><div><p className="eyebrow">运行记录</p><h2>日志</h2></div><div className="filters"><select aria-label="日志级别" value={level} onChange={(event) => setLevel(event.target.value)}><option value="all">全部级别</option><option value="info">{logLevelLabels.info}</option><option value="warn">{logLevelLabels.warn}</option><option value="error">{logLevelLabels.error}</option></select><input aria-label="筛选日志" placeholder="筛选" value={query} onChange={(event) => setQuery(event.target.value)} /></div></div><div className="log-list">{visible.length === 0 ? <p className="empty">暂无日志。</p> : visible.map((entry, index) => <div className="log-row" key={`${entry.timestamp}-${index}`}><time>{new Date(entry.timestamp).toLocaleTimeString()}</time><span className={`log-level ${entry.level}`}>{logLevelLabels[entry.level]}</span><span>{entry.message}</span></div>)}</div></section>;
}
