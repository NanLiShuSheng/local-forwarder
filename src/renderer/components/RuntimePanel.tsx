import type { RuntimeStatus } from "../../shared/contracts";
import { statusLabels } from "../labels";

interface RuntimePanelProps { status: RuntimeStatus; address: string; onStart: () => Promise<void>; onStop: () => Promise<void>; }

export function RuntimePanel({ status, address, onStart, onStop }: RuntimePanelProps) {
  const busy = status.state === "starting" || status.state === "stopping";
  return <section className="panel runtime-panel"><div className="panel-heading"><div><p className="eyebrow">运行状态</p><h2>服务状态</h2></div><span className={`status-pill ${status.state}`}><span className="status-dot" />{statusLabels[status.state]}</span></div><p className="listen-address">监听地址：<strong>{address}</strong></p><div className="metric-grid"><div><span>请求数</span><strong>{status.requestCount}</strong></div><div><span>TCP 连接数</span><strong>{status.tcpConnections}</strong></div><div><span>状态</span><strong>{statusLabels[status.state]}</strong></div></div>{status.error && <p className="error-box" role="alert">{status.error}</p>}<div className="button-row"><button className="primary" disabled={busy || status.state === "running"} onClick={() => void onStart()}>启动服务</button><button disabled={busy || status.state === "stopped"} onClick={() => void onStop()}>停止服务</button></div></section>;
}
