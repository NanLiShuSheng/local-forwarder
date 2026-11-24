import { useEffect, useRef, useState } from "react";
import type { ManualRequestConfig } from "../../shared/contracts";
import {
  formatRequestHistoryTime,
  requestHistorySignature,
  requestHistorySummary,
  type RequestHistoryEntry,
} from "../request-history";
import { WorkspaceIcon } from "./WorkspaceChrome";

interface RequestHistoryMenuProps {
  history: RequestHistoryEntry[];
  currentRequest?: ManualRequestConfig;
  onRestore: (entry: RequestHistoryEntry) => Promise<boolean>;
}

export function RequestHistoryMenu({ history, currentRequest, onRestore }: RequestHistoryMenuProps) {
  const [open, setOpen] = useState(false);
  const [restoring, setRestoring] = useState<number>();
  const rootRef = useRef<HTMLDivElement>(null);
  const currentSignature = currentRequest === undefined ? undefined : requestHistorySignature(currentRequest);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const restore = async (entry: RequestHistoryEntry) => {
    if (restoring !== undefined) return;
    setRestoring(entry.sentAt);
    try {
      if (await onRestore(entry)) setOpen(false);
    } finally {
      setRestoring(undefined);
    }
  };

  return <div className="lf-request-history" ref={rootRef}>
    <button
      className="lf-request-history-trigger"
      type="button"
      aria-expanded={open}
      aria-haspopup="dialog"
      aria-controls="request-history-panel"
      aria-label={`打开请求历史，共 ${history.length} 个版本`}
      onClick={() => setOpen((current) => !current)}
    >
      <WorkspaceIcon name="history" className="lf-icon lf-icon-sm" />
      <span>历史</span>
      <span className="lf-request-history-count">{history.length}</span>
    </button>
    {open && <section className="lf-request-history-popover" id="request-history-panel" role="dialog" aria-label="请求历史">
      <header className="lf-request-history-head">
        <div className="lf-request-history-heading">
          <strong>请求历史</strong>
          <span>自动保留最近 20 个请求版本</span>
        </div>
        <button className="lf-request-history-close" type="button" aria-label="关闭请求历史" onClick={() => setOpen(false)}>
          <WorkspaceIcon name="close" className="lf-icon lf-icon-sm" />
        </button>
      </header>
      <div className="lf-request-history-list">
        {history.length === 0
          ? <p className="lf-request-history-empty">还没有请求历史<br /><span>发送请求后会自动保存在这里</span></p>
          : history.map((entry) => {
            const summary = requestHistorySummary(entry.request);
            const isCurrent = currentSignature !== undefined && requestHistorySignature(entry.request) === currentSignature;
            const time = formatRequestHistoryTime(entry.sentAt);
            return <article className={`lf-request-history-row${isCurrent ? " current" : ""}`} key={`${entry.sentAt}-${requestHistorySignature(entry.request)}`}>
              <div className="lf-request-history-main">
                <div className="lf-request-history-line">
                  <time dateTime={new Date(entry.sentAt).toISOString()} title={new Date(entry.sentAt).toLocaleString("zh-CN")}>{time}</time>
                  <code>{summary.address}</code>
                  {isCurrent && <span className="lf-request-history-current">当前</span>}
                </div>
                <div className="lf-request-history-meta">
                  <span>{summary.action === undefined ? "无 Action" : `Action=${summary.action}`}{summary.account === undefined ? "" : ` · account=${summary.account}`}</span>
                  <span>· {summary.paramCount} 个参数</span>
                </div>
              </div>
              <button
                className="lf-request-history-restore"
                type="button"
                disabled={isCurrent || restoring !== undefined}
                onClick={() => void restore(entry)}
              >{isCurrent ? "已载入" : restoring === entry.sentAt ? "恢复中…" : "恢复"}</button>
            </article>;
          })}
      </div>
      <footer className="lf-request-history-foot">恢复只会回填 IP、端口、协议和请求参数，不会自动发送。</footer>
    </section>}
  </div>;
}
