import { useEffect } from "react";
import type { RuntimeStatus } from "../../shared/contracts";
import { statusLabels } from "../labels";
import { useToast } from "./ToastProvider";

interface RuntimePanelProps { status: RuntimeStatus; }

export function RuntimePanel({ status }: RuntimePanelProps) {
  const { notifyError } = useToast();
  useEffect(() => {
    if (status.error !== undefined) notifyError(status.error, "代理运行失败");
  }, [notifyError, status.error]);
  return <section className="panel runtime-panel"><div className="panel-heading"><div><p className="eyebrow">运行状态</p><h2>代理状态</h2></div><span className={`status-pill ${status.state}`}><span className="status-dot" />{statusLabels[status.state]}</span></div><div className="metric-grid"><div><span>请求数</span><strong>{status.requestCount}</strong></div><div><span>TCP 连接数</span><strong>{status.tcpConnections}</strong></div><div><span>状态</span><strong>{statusLabels[status.state]}</strong></div></div></section>;
}
