import { useEffect, useState } from "react";
import type { RuntimeStatus } from "../../shared/contracts";
import { DismissibleError } from "./DismissibleError";
import { statusLabels } from "../labels";

interface RuntimePanelProps { status: RuntimeStatus; }

export function RuntimePanel({ status }: RuntimePanelProps) {
  const [dismissedError, setDismissedError] = useState("");
  useEffect(() => { setDismissedError(""); }, [status.error]);
  const visibleError = status.error !== undefined && status.error !== dismissedError ? status.error : "";
  return <section className="panel runtime-panel"><div className="panel-heading"><div><p className="eyebrow">运行状态</p><h2>代理状态</h2></div><span className={`status-pill ${status.state}`}><span className="status-dot" />{statusLabels[status.state]}</span></div><div className="metric-grid"><div><span>请求数</span><strong>{status.requestCount}</strong></div><div><span>TCP 连接数</span><strong>{status.tcpConnections}</strong></div><div><span>状态</span><strong>{statusLabels[status.state]}</strong></div></div>{visibleError && <DismissibleError message={visibleError} onClose={() => setDismissedError(visibleError)} />}</section>;
}
