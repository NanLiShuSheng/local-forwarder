import type { RuntimeStatus } from "../../shared/contracts";

interface RuntimePanelProps { status: RuntimeStatus; address: string; onStart: () => Promise<void>; onStop: () => Promise<void>; }

export function RuntimePanel({ status, address, onStart, onStop }: RuntimePanelProps) {
  const busy = status.state === "starting" || status.state === "stopping";
  return <section className="panel runtime-panel"><div className="panel-heading"><div><p className="eyebrow">Runtime</p><h2>Service status</h2></div><span className={`status-pill ${status.state}`}><span className="status-dot" />{status.state}</span></div><p className="listen-address">Listening <strong>{address}</strong></p><div className="metric-grid"><div><span>Requests</span><strong>{status.requestCount}</strong></div><div><span>TCP connections</span><strong>{status.tcpConnections}</strong></div><div><span>State</span><strong>{status.state}</strong></div></div>{status.error && <p className="error-box" role="alert">{status.error}</p>}<div className="button-row"><button className="primary" disabled={busy || status.state === "running"} onClick={() => void onStart()}>Start service</button><button disabled={busy || status.state === "stopped"} onClick={() => void onStop()}>Stop service</button></div></section>;
}
