import { useEffect, useState } from "react";
import type { AppConfig, ProxyInstanceSummary, RuntimeStatus } from "../../shared/contracts";
import { parseDirectoryInput } from "../../shared/directory-path";
import { useToast } from "./ToastProvider";

interface ProxyInstancePanelProps {
  instances: ProxyInstanceSummary[];
  status: RuntimeStatus;
  config: AppConfig;
  onChange: (config: AppConfig) => Promise<boolean>;
  onChooseProjectDirectory: () => Promise<boolean>;
  onRename: (id: string, name: string) => Promise<boolean>;
  onStart: () => Promise<void>;
  onStop: () => Promise<void>;
}

export function ProxyInstancePanel({ instances, status, config, onChange, onChooseProjectDirectory, onRename, onStart, onStop }: ProxyInstancePanelProps) {
  const { notifyError } = useToast();
  const selected = instances.find((instance) => instance.selected) ?? instances[0];
  const busy = status.state === "starting" || status.state === "stopping";
  const running = status.state === "running";
  const [nameDraft, setNameDraft] = useState(selected?.name ?? "");
  const [projectPathDraft, setProjectPathDraft] = useState(config.projectPath ?? "");
  const [bindHostDraft, setBindHostDraft] = useState(config.server.bindHost);
  const [portDraft, setPortDraft] = useState(String(config.server.port));
  const [timeoutDraft, setTimeoutDraft] = useState(String(config.server.timeoutMs));

  useEffect(() => {
    setNameDraft(selected?.name ?? "");
    setProjectPathDraft(config.projectPath ?? "");
    setBindHostDraft(config.server.bindHost);
    setPortDraft(String(config.server.port));
    setTimeoutDraft(String(config.server.timeoutMs));
  }, [selected?.id, selected?.name, config.projectPath, config.server.bindHost, config.server.port, config.server.timeoutMs]);

  const commitName = async () => {
    if (!selected) return;
    const draft = nameDraft.trim();
    if (draft === "") {
      setNameDraft(selected.name);
      return;
    }
    if (draft === selected.name) return;
    const saved = await onRename(selected.id, draft);
    if (!saved) setNameDraft(selected.name);
  };

  const saveProjectDirectory = async () => {
    try {
      const projectPath = parseDirectoryInput(projectPathDraft);
      const saved = await onChange({ ...config, projectPath });
      if (!saved) {
        setProjectPathDraft(config.projectPath ?? "");
        return;
      }
      setProjectPathDraft(projectPath);
    } catch (error) {
      setProjectPathDraft(config.projectPath ?? "");
      notifyError(error, "项目目录路径无效");
    }
  };

  const saveServerPatch = async (patch: Partial<AppConfig["server"]>) => {
    const saved = await onChange({ ...config, server: { ...config.server, ...patch } });
    if (saved) return;
    setBindHostDraft(config.server.bindHost);
    setPortDraft(String(config.server.port));
    setTimeoutDraft(String(config.server.timeoutMs));
  };

  return <section className="panel proxy-instance-panel">
    {selected ? <>
      <div className="proxy-instance-overview-heading">
        <span className={`status-pill ${status.state}`}><span className="status-dot" />{status.state === "running" ? "运行中" : status.state === "error" ? "异常" : "已停止"}</span>
        <div className="proxy-instance-overview-title"><input className="proxy-instance-overview-name-input" aria-label="编辑代理名称" value={nameDraft} onChange={function (event) { setNameDraft(event.target.value); }} onBlur={function () { void commitName(); }} onKeyDown={function (event) { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } else if (event.key === "Escape") { setNameDraft(selected.name); event.currentTarget.blur(); } }} disabled={running || busy} /></div>
        <div className="proxy-instance-actions"><button className={`proxy-instance-sidebar-action ${running ? "stop" : "start"}`} type="button" disabled={busy} onClick={() => { if (status.state === "running") void onStop(); else void onStart(); }}>{status.state === "running" ? "停止代理" : "启动代理"}</button></div>
      </div>
      <div className="proxy-instance-project-card">
        <div className="proxy-instance-project-field input-with-button">
          <input aria-label="项目目录" value={projectPathDraft} placeholder="请选择项目目录" onChange={function (event) { setProjectPathDraft(event.target.value); }} onBlur={function () { void saveProjectDirectory(); }} onKeyDown={function (event) { if (event.key === "Enter") { event.preventDefault(); void saveProjectDirectory(); } }} disabled={running || busy} />
          <button type="button" onClick={function () { void onChooseProjectDirectory(); }} disabled={running || busy}>选择项目目录</button>
        </div>
      </div>
      <div className="proxy-instance-overview-fields">
        <label className="proxy-instance-overview-field"><span>监听主机 <small>HOST</small></span><input className="overview-config-input" aria-label="监听主机" value={bindHostDraft} onChange={function (event) { setBindHostDraft(event.target.value); }} onBlur={function () { void saveServerPatch({ bindHost: bindHostDraft }); }} disabled={running || busy} /><small className="overview-config-hint good">本机访问地址</small></label>
        <label className="proxy-instance-overview-field"><span>监听端口 <small>PORT</small></span><input className="overview-config-input" aria-label="监听端口" type="number" value={portDraft} onChange={function (event) { setPortDraft(event.target.value); }} onBlur={function () { void saveServerPatch({ port: Number(portDraft) }); }} disabled={running || busy} /><small className="overview-config-hint">范围 1 - 65535</small></label>
        <label className="proxy-instance-overview-field"><span>超时时间（毫秒） <small>MS</small></span><input className="overview-config-input" aria-label="超时时间" type="number" value={timeoutDraft} onChange={function (event) { setTimeoutDraft(event.target.value); }} onBlur={function () { void saveServerPatch({ timeoutMs: Number(timeoutDraft) }); }} disabled={running || busy} /><small className="overview-config-hint">请求等待上限</small></label>
      </div>
    </> : <p className="empty">暂无代理实例</p>}
  </section>;
}
