import { useMemo, useState } from "react";
import type { LogEntry } from "../../shared/contracts";
import { parseLogRequestParams } from "../../shared/log-details";
import type { LogKeyValue } from "../../shared/log-details";
import { logLevelLabels } from "../labels";

function LogKeyValueRows({ entries }: { entries: LogKeyValue[] }) {
  if (entries.length === 0) return <p className="log-detail-empty-value">无</p>;
  return <div className="log-detail-key-values">{entries.map((entry, index) => <div className="log-detail-key-value" key={`${entry.key}-${index}`}><span className="log-detail-key">{entry.key}</span><span className="log-detail-separator">:</span><span className="log-detail-value">{entry.value}</span></div>)}</div>;
}

function ParsedRequestDetails({ raw }: { raw: string }) {
  const parsed = parseLogRequestParams(raw);
  return <div className="log-detail-parsed">
    <div className="log-detail-section"><h4 className="log-detail-section-title">method</h4><p className="log-detail-scalar">{parsed.method || "无"}</p></div>
    <div className="log-detail-section"><h4 className="log-detail-section-title">path</h4><p className="log-detail-scalar">{parsed.path || "无"}</p></div>
    <div className="log-detail-section"><h4 className="log-detail-section-title">query</h4><LogKeyValueRows entries={parsed.query} /></div>
    <div className="log-detail-section"><h4 className="log-detail-section-title">body</h4><LogKeyValueRows entries={parsed.body} /></div>
    <div className="log-detail-section"><h4 className="log-detail-section-title">rawBody</h4><pre className="log-detail-body">{parsed.rawBody ?? "无"}</pre></div>
  </div>;
}

export function LogPanel({
  logs,
  onClear,
  onFillJson,
}: {
  logs: LogEntry[];
  onClear: () => Promise<boolean>;
  onFillJson: (text: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState("all");
  const [requestView, setRequestView] = useState<"source" | "parsed">("source");
  const [selected, setSelected] = useState<LogEntry | undefined>();
  const visible = useMemo(() => logs.filter((entry) => {
    const searchable = [entry.message, entry.requestParams ?? "", entry.responseData ?? ""].join("\n").toLowerCase();
    return (level === "all" || entry.level === level) && searchable.includes(query.toLowerCase());
  }).slice(-200).reverse(), [logs, level, query]);
  const clearLogs = async () => {
    if (await onClear()) {
      setSelected(undefined);
    }
  };
  return <section className="panel log-panel"><div className="log-toolbar"><span className="log-count">{visible.length} 条记录</span><div className="log-toolbar-actions"><div className="filters"><select aria-label="日志级别" value={level} onChange={(event) => setLevel(event.target.value)}><option value="all">全部级别</option><option value="info">{logLevelLabels.info}</option><option value="warn">{logLevelLabels.warn}</option><option value="error">{logLevelLabels.error}</option></select><input aria-label="筛选日志" placeholder="筛选" value={query} onChange={(event) => setQuery(event.target.value)} /></div><button type="button" className="secondary-button log-clear-button" disabled={logs.length === 0} onClick={() => void clearLogs()}>清空日志</button></div></div><div className="log-workspace"><div className="log-list">{visible.length === 0 ? <p className="empty">暂无日志。</p> : visible.map((entry, index) => <button className="log-row" type="button" key={`${entry.timestamp}-${index}`} onClick={() => setSelected(entry)}><time>{new Date(entry.timestamp).toLocaleTimeString()}</time><span className={`log-level ${entry.level}`}>{logLevelLabels[entry.level]}</span><span className="log-message">{entry.message}</span></button>)}</div><section className="log-detail" aria-label="日志详情">{selected ? <><div className="log-detail-heading"><strong>日志详情</strong><button type="button" className="log-detail-close" aria-label="关闭日志详情" onClick={() => setSelected(undefined)}>×</button></div><dl className="log-detail-list"><div className="log-detail-section"><div className="log-detail-section-heading"><dt className="log-detail-section-title">请求参数</dt><div className="log-detail-tabs" role="tablist" aria-label="请求参数视图"><button type="button" role="tab" aria-selected={requestView === "source"} className={requestView === "source" ? "active" : ""} onClick={() => setRequestView("source")}>源码</button><button type="button" role="tab" aria-selected={requestView === "parsed"} className={requestView === "parsed" ? "active" : ""} onClick={() => setRequestView("parsed")}>解析结果</button></div></div><dd>{requestView === "source" ? <pre className="log-detail-body">{selected.requestParams ?? "无"}</pre> : <ParsedRequestDetails raw={selected.requestParams ?? ""} />}</dd></div><div className="log-detail-section"><div className="log-detail-section-heading"><dt className="log-detail-section-title">应答数据</dt></div><dd><pre className="log-detail-body">{selected.responseData ?? "无"}</pre>{selected.responseData !== undefined && <div className="log-detail-response-actions"><button type="button" className="secondary-button" onClick={() => onFillJson(selected.responseData!)}>回填到 JSON 可视化</button></div>}</dd></div></dl></> : <p className="log-detail-empty">选择一条日志查看详情。</p>}</section></div></section>;
}
