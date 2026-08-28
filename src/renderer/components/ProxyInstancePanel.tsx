import type { ProxyInstanceSummary, RuntimeStatus } from "../../shared/contracts";

interface ProxyInstancePanelProps {
  instances: ProxyInstanceSummary[];
  status: RuntimeStatus;
  onSelect: (id: string) => Promise<void>;
  onCreate: () => Promise<void>;
  onDuplicate: () => Promise<void>;
  onStart: () => Promise<void>;
  onStop: () => Promise<void>;
}

export function ProxyInstancePanel({ instances, status, onSelect, onCreate, onDuplicate, onStart, onStop }: ProxyInstancePanelProps) {
  const selected = instances.find((instance) => instance.selected) ?? instances[0];
  const busy = status.state === "starting" || status.state === "stopping";
  return <section className="panel proxy-instance-panel">
    <div className="proxy-instance-heading">
      <div><p className="eyebrow">代理实例</p><h2>多代理并行转发</h2><p className="proxy-instance-subtitle">每个实例使用独立端口和转发地址，可同时运行</p></div>
      <button className="primary-button" type="button" onClick={() => void onCreate()}>＋ 新增代理</button>
    </div>
    <div className="proxy-instance-layout">
      <div className="proxy-instance-list">
        {instances.map((instance) => <button key={instance.id} type="button" className={`proxy-instance-card ${instance.selected ? "selected" : ""}`} onClick={() => void onSelect(instance.id)}>
          <span className="proxy-instance-card-title"><span className={`status-dot ${instance.status.state}`} />{instance.name}<code>:{instance.port}</code></span>
          <small>上游地址</small><code className="proxy-instance-target">{instance.target}</code>
          <span className="proxy-instance-card-status">{instance.status.state === "running" ? `运行中 · ${instance.status.requestCount} 请求` : instance.status.state === "error" ? "启动失败" : "已停止"}</span>
        </button>)}
      </div>
      {selected && <div className="proxy-instance-detail">
        <div className="proxy-instance-detail-heading"><div><p className="eyebrow">当前实例</p><h3>{selected.name}</h3></div><span className={`status-pill ${status.state}`}><span className="status-dot" />{status.state === "running" ? "运行中" : status.state === "error" ? "异常" : "已停止"}</span></div>
        <p className="proxy-instance-endpoint">监听 {selected.bindHost}:{selected.port}</p>
        <p className="proxy-instance-endpoint">上游 {selected.target}</p>
        <div className="proxy-instance-actions"><button className="primary-button" type="button" disabled={busy || status.state === "running"} onClick={() => void onStart()}>启动代理</button><button className="secondary-button" type="button" disabled={busy || status.state === "stopped"} onClick={() => void onStop()}>停止代理</button><button className="secondary-button" type="button" onClick={() => void onDuplicate()}>复制当前代理</button></div>
      </div>}
    </div>
  </section>;
}
