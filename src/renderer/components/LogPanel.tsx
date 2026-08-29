import { useMemo, useState } from "react";
import type { LogEntry } from "../../shared/contracts";
import { logLevelLabels } from "../labels";

export function LogPanel({ logs }: { logs: LogEntry[] }) {
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState("all");
  const [selected, setSelected] = useState<LogEntry | undefined>();
  const visible = useMemo(() => logs.filter((entry) => {
    const searchable = [entry.message, entry.requestParams ?? "", entry.responseData ?? ""].join("\n").toLowerCase();
    return (level === "all" || entry.level === level) && searchable.includes(query.toLowerCase());
  }).slice(-200).reverse(), [logs, level, query]);
  return <section className="panel log-panel"><div className="log-toolbar"><span className="log-count">{visible.length} 条记录</span><div className="filters"><select aria-label="日志级别" value={level} onChange={(event) => setLevel(event.target.value)}><option value="all">全部级别</option><option value="info">{logLevelLabels.info}</option><option value="warn">{logLevelLabels.warn}</option><option value="error">{logLevelLabels.error}</option></select><input aria-label="筛选日志" placeholder="筛选" value={query} onChange={(event) => setQuery(event.target.value)} /></div></div><div className="log-workspace"><div className="log-list">{visible.length === 0 ? <p className="empty">暂无日志。</p> : visible.map((entry, index) => <button className="log-row" type="button" key={`${entry.timestamp}-${index}`} onClick={() => setSelected(entry)}><time>{new Date(entry.timestamp).toLocaleTimeString()}</time><span className={`log-level ${entry.level}`}>{logLevelLabels[entry.level]}</span><span className="log-message">{entry.message}</span></button>)}</div><section className="log-detail" aria-label="日志详情">{selected ? <><div className="log-detail-heading"><strong>日志详情</strong><button type="button" className="log-detail-close" aria-label="关闭日志详情" onClick={() => setSelected(undefined)}>×</button></div><dl className="log-detail-list"><div><dt>请求参数</dt><dd><pre className="log-detail-body">{selected.requestParams || "无"}</pre></dd></div><div><dt>应答数据</dt><dd><pre className="log-detail-body">{selected.responseData || "无"}</pre></dd></div></dl></> : <p className="log-detail-empty">选择一条日志查看详情。</p>}</section></div></section>;
}
