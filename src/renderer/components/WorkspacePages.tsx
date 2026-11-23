import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { AppConfig, ForwardingAddressHistory, LogEntry, ProxyInstanceSummary, RuntimeState, RuntimeStatus, UpdateState } from "../../shared/contracts";
import { parseDirectoryInput } from "../../shared/directory-path";
import type { WorkspaceRoute } from "../workspace-navigation";
import { addressForTarget, appendForwardingAddressHistory, draftsForTargets, forwardingAddressHistoryForTarget, targetFromDraft, type AddressDraft } from "./ConfigPages";
import { ProxyInstancePanel } from "./ProxyInstancePanel";
import { orderProxyInstancesForDisplay } from "./ProxyInstanceSidebar";
import { useToast } from "./ToastProvider";
import { InstanceToggleButton, WorkspaceIcon, instanceStatusLabel } from "./WorkspaceChrome";
import { LogRowLabel } from "./LogPanel";

export interface BuildTask {
  id: string;
  kind: "encrypt" | "decrypt";
  mode?: "full" | "incremental" | "restore";
  status: "running" | "success" | "error" | "canceled";
  inputDir: string;
  outputDir: string;
  startedAt: number;
  finishedAt?: number;
  totalFiles?: number;
  processedFiles?: number;
  failedFiles?: number;
  error?: string;
}

export function WorkspacePageHeader({ eyebrow, title, description, badge, actions }: { eyebrow: string; title: string; description: string; badge?: ReactNode; actions?: ReactNode }) {
  return <header className="lf-page-head">
    <div>
      <p className="lf-page-eyebrow">{eyebrow}</p>
      <div className="lf-page-title-line"><h1>{title}</h1>{badge}</div>
      <p className="lf-page-sub">{description}</p>
    </div>
    {actions !== undefined && <div className="lf-page-actions">{actions}</div>}
  </header>;
}

function toneForState(state: RuntimeState): string {
  if (state === "running") return "running";
  if (state === "starting" || state === "stopping") return "warning";
  if (state === "error") return "error";
  return "stopped";
}

function shortPath(value: string | undefined): string {
  if (value === undefined || value.trim() === "") return "—";
  const normalized = value.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized.split("/").slice(-1)[0] || normalized;
}

function formatClock(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString("zh-CN", { hour12: false });
}

function formatDateTime(value: number): string {
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function logDetail(entry: LogEntry): string {
  const parts: string[] = [];
  if (entry.statusCode !== undefined) parts.push(String(entry.statusCode));
  if (entry.requestParams !== undefined) parts.push(entry.requestParams.split(/\r?\n/)[0] ?? "请求参数");
  if (hasResponseData(entry)) parts.push("含应答数据");
  if (parts.length === 0) parts.push(entry.message);
  return parts.join(" · ");
}

function isRequestLog(entry: LogEntry): boolean {
  return entry.requestPath !== undefined || entry.requestParams !== undefined;
}

function hasResponseData(entry: LogEntry): boolean {
  return typeof entry.responseData === "string" && entry.responseData.length > 0;
}

function levelClass(level: LogEntry["level"]): string {
  if (level === "error") return "error";
  if (level === "warn") return "warn";
  if (level === "debug") return "idle";
  return "info";
}

function Sparkline({ tone = "accent" }: { tone?: "accent" | "info" | "warning" }) {
  return <svg className={`lf-sparkline ${tone}`} viewBox="0 0 70 24" fill="none" aria-hidden="true">
    <path d="M1 20c7-1 8-7 15-7s8 4 14 2 7-8 13-7 8 8 13 4 7-9 13-10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M1 20c7-1 8-7 15-7s8 4 14 2 7-8 13-7 8 8 13 4 7-9 13-10v22H1Z" fill="currentColor" opacity=".08" />
  </svg>;
}

export interface WorkbenchPageProps {
  instances: ProxyInstanceSummary[];
  selectedInstance?: ProxyInstanceSummary;
  status: RuntimeStatus;
  config: AppConfig;
  loginCache: Record<string, string>;
  logs: LogEntry[];
  bulkBusy: boolean;
  onNavigate: (route: WorkspaceRoute) => void;
  onSelectInstance: (id: string) => void;
  onToggleInstance: (instance: ProxyInstanceSummary) => void;
  onStartAll: () => void;
  onStopAll: () => void;
  onOpenDock: () => void;
  onChooseProjectDirectory: () => Promise<boolean>;
  onChangeProjectPath: (projectPath: string) => Promise<boolean>;
}

export function WorkbenchPage({ instances, selectedInstance, status, config, loginCache, logs, bulkBusy, onNavigate, onSelectInstance, onToggleInstance, onStartAll, onStopAll, onOpenDock, onChooseProjectDirectory, onChangeProjectPath }: WorkbenchPageProps) {
  const { notify, notifyError } = useToast();
  const [projectPathDraft, setProjectPathDraft] = useState(config.projectPath ?? "");
  const selectedStatus = selectedInstance?.status ?? status;
  const projectDirectoryLocked = selectedStatus.state !== "stopped" && selectedStatus.state !== "error";
  const workbenchInstances = useMemo(() => orderProxyInstancesForDisplay(instances, instances.map((instance) => instance.id)), [instances]);
  const running = instances.filter((instance) => instance.status.state === "running").length;
  const errors = instances.filter((instance) => instance.status.state === "error").length;
  const recentLogs = useMemo(() => logs.slice(-6).reverse(), [logs]);
  const targets = config.tcpTargets.filter((target) => target.enabled).slice(0, 3);
  const requestLogs = logs.filter((entry) => entry.requestPath !== undefined || entry.requestParams !== undefined);
  const errorLogs = requestLogs.filter((entry) => entry.level === "error" || (entry.statusCode !== undefined && entry.statusCode >= 400));
  const errorRate = requestLogs.length === 0 ? 0 : (errorLogs.length / requestLogs.length) * 100;
  const recentRequestCount = logs.filter((entry) => {
    const timestamp = Date.parse(entry.timestamp);
    return Number.isFinite(timestamp) && Date.now() - timestamp <= 5 * 60_000 && (entry.requestPath !== undefined || entry.requestParams !== undefined);
  }).length;

  useEffect(() => setProjectPathDraft(config.projectPath ?? ""), [config.projectPath]);

  const notifyProjectDirectoryLocked = () => {
    if (!projectDirectoryLocked) return false;
    notify({ kind: "warning", title: "请先停止代理", message: "代理运行期间不能修改项目目录" });
    return true;
  };

  const saveProjectPath = async () => {
    if (projectDirectoryLocked) {
      setProjectPathDraft(config.projectPath ?? "");
      return;
    }
    const draft = projectPathDraft.trim();
    if (draft === (config.projectPath ?? "")) return;
    try {
      const projectPath = parseDirectoryInput(draft);
      const saved = await onChangeProjectPath(projectPath);
      setProjectPathDraft(saved ? projectPath : config.projectPath ?? "");
    } catch (error) {
      setProjectPathDraft(config.projectPath ?? "");
      notifyError(error, "项目目录路径无效");
    }
  };

  return <section className="lf-view-body">
    <WorkspacePageHeader
      eyebrow="Runtime · Workspace"
      title="工作台"
      badge={<span className="lf-live-pill"><i />{running} 个环境运行中</span>}
      description="环境、监听状态、请求量和最近事件集中在一个视图里。当前环境决定调试目标和数据作用域。"
      actions={<><button className="lf-btn" type="button" onClick={onOpenDock}><WorkspaceIcon name="activity" className="lf-icon" />打开日志</button><button className="lf-btn primary" type="button" onClick={() => onNavigate("debug")}><WorkspaceIcon name="send" className="lf-icon" />发送请求</button></>}
    />

    <section className="lf-panel lf-project-bar" aria-label="项目目录">
      <span className="lf-project-bar-icon"><WorkspaceIcon name="files" className="lf-icon" /></span>
      <div className="lf-project-bar-copy">
        <label htmlFor="lf-workbench-project-path">项目目录</label>
        <input id="lf-workbench-project-path" aria-label="项目目录路径" value={projectPathDraft} placeholder="粘贴项目目录路径，或点击右侧选择" title={projectDirectoryLocked ? "请先停止代理后再修改" : config.projectPath} readOnly={projectDirectoryLocked} aria-readonly={projectDirectoryLocked} aria-disabled={projectDirectoryLocked} onFocus={notifyProjectDirectoryLocked} onClick={notifyProjectDirectoryLocked} onChange={(event) => { if (notifyProjectDirectoryLocked()) return; setProjectPathDraft(event.target.value); }} onBlur={() => { void saveProjectPath(); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void saveProjectPath(); } else if (event.key === "Escape") { setProjectPathDraft(config.projectPath ?? ""); event.currentTarget.blur(); } }} />
      </div>
      <button className="lf-btn small" type="button" disabled={projectDirectoryLocked} title={projectDirectoryLocked ? "请先停止代理后再修改" : undefined} onClick={() => { void onChooseProjectDirectory(); }}><WorkspaceIcon name="files" className="lf-icon lf-icon-sm" />选择项目目录</button>
    </section>

    <div className="lf-metrics">
      <article className="lf-metric"><div className="lf-metric-label"><span>请求总量</span><WorkspaceIcon name="activity" className="lf-icon" /></div><div className="lf-metric-value">{selectedStatus.requestCount.toLocaleString("zh-CN")}<small>次</small></div><div className="lf-metric-sub good">当前环境累计请求</div><Sparkline /></article>
      <article className="lf-metric"><div className="lf-metric-label"><span>当前吞吐</span><WorkspaceIcon name="refresh" className="lf-icon" /></div><div className="lf-metric-value">{recentRequestCount}<small>req / 5m</small></div><div className="lf-metric-sub">最近五分钟请求</div><Sparkline tone="info" /></article>
      <article className="lf-metric"><div className="lf-metric-label"><span>TCP 连接</span><WorkspaceIcon name="database" className="lf-icon" /></div><div className="lf-metric-value">{selectedStatus.tcpConnections}<small>个</small></div><div className="lf-metric-sub">{selectedStatus.tcpConnections > 0 ? "连接保持中" : "当前无活动连接"}</div><Sparkline /></article>
      <article className="lf-metric"><div className="lf-metric-label"><span>错误率</span><WorkspaceIcon name="history" className="lf-icon" /></div><div className="lf-metric-value">{errorRate.toFixed(2)}<small>%</small></div><div className={`lf-metric-sub ${errors > 0 || errorLogs.length > 0 ? "warn" : "good"}`}>{errorLogs.length > 0 ? `${errorLogs.length} 个失败请求` : "请求全部成功"}</div><Sparkline tone="warning" /></article>
    </div>

    <div className="lf-workbench-grid">
      <section className="lf-panel lf-simple-table-panel">
        <div className="lf-panel-head"><div><h3>环境</h3><span>{instances.length} 个代理实例</span></div><div className="lf-panel-head-actions"><button className="lf-text-button" type="button" disabled={bulkBusy || instances.length === 0} onClick={onStartAll}>启动全部</button><button className="lf-text-button" type="button" disabled={bulkBusy || instances.length === 0} onClick={onStopAll}>停止全部</button><button className="lf-text-button" type="button" onClick={() => onNavigate("environment")}>管理全部 →</button></div></div>
        <div className="lf-table-wrap lf-workbench-table-wrap"><table className="lf-data-table lf-workbench-table"><colgroup><col className="lf-wb-col-env" /><col className="lf-wb-col-port" /><col className="lf-wb-col-upstream" /><col className="lf-wb-col-status" /><col className="lf-wb-col-requests" /><col className="lf-wb-col-toggle" /></colgroup><thead><tr><th>环境</th><th className="lf-wb-port">端口</th><th>上游</th><th className="lf-wb-status">状态</th><th className="lf-wb-requests">请求</th><th className="lf-cell-toggle">开关</th></tr></thead><tbody>
          {instances.length === 0 ? <tr><td colSpan={6}><div className="lf-table-empty">还没有代理环境，前往环境页创建第一个环境。</div></td></tr> : workbenchInstances.map((instance) => <tr className={instance.selected ? "selected" : ""} key={instance.id} onClick={() => onSelectInstance(instance.id)}>
            <td className="lf-wb-env"><div className="lf-cell-env"><span className={`lf-status-dot ${toneForState(instance.status.state)}`} /><strong>{instance.name}</strong>{instance.selected && <small>当前</small>}</div></td>
            <td className="lf-cell-mono lf-wb-port">:{instance.port}</td>
            <td className="lf-cell-mono lf-wb-upstream" title={instance.target}>{instance.target}</td>
            <td className="lf-wb-status"><span className={`lf-status-badge ${toneForState(instance.status.state)}`}>{instanceStatusLabel(instance.status.state)}</span></td>
            <td className="lf-cell-mono lf-wb-requests">{instance.status.requestCount.toLocaleString("zh-CN")}</td>
            <td className="lf-cell-toggle"><InstanceToggleButton instance={instance} onToggle={onToggleInstance} /></td>
          </tr>)}
        </tbody></table></div>
      </section>

      <section className="lf-panel">
        <div className="lf-panel-head"><div><h3>最近活动</h3><span>实时事件流</span></div><button className="lf-text-button" type="button" onClick={() => onNavigate("activity")}>查看全部 →</button></div>
        <div className="lf-activity-list">
          {recentLogs.length === 0 ? <p className="lf-panel-empty">暂无活动记录。</p> : recentLogs.map((entry, index) => <button className="lf-activity-item" type="button" key={`${entry.timestamp}-${index}`} onClick={() => onNavigate("activity")}>
            <span className={`lf-activity-icon ${entry.level}`}><WorkspaceIcon name={entry.level === "error" || entry.level === "warn" ? "history" : entry.requestPath !== undefined ? "debug" : "activity"} className="lf-icon lf-icon-sm" /></span>
            <span className="lf-activity-copy"><strong><LogRowLabel message={entry.message} requestParams={entry.requestParams} /></strong><small>{logDetail(entry)}</small></span>
            <time>{formatClock(entry.timestamp)}</time>
          </button>)}
        </div>
      </section>
    </div>

    <div className="lf-quick-actions">
      <button className="lf-quick-action" type="button" onClick={() => onNavigate("session")}><span className="lf-quick-icon"><WorkspaceIcon name="session" /></span><span><strong>查看登录缓存</strong><span>{Object.keys(loginCache).length} 个字段</span></span></button>
      <button className="lf-quick-action" type="button" onClick={() => onNavigate("build")}><span className="lf-quick-icon"><WorkspaceIcon name="package" /></span><span><strong>构建资源</strong><span>加密或解密 .d 资源</span></span></button>
      <button className="lf-quick-action" type="button" onClick={() => onNavigate("kv")}><span className="lf-quick-icon"><WorkspaceIcon name="kv" /></span><span><strong>打开数据浏览器</strong><span>缓存、文件与变量</span></span></button>
      <button className="lf-quick-action" type="button" onClick={() => onNavigate("activity")}><span className="lf-quick-icon"><WorkspaceIcon name="activity" /></span><span><strong>查看活动</strong><span>{logs.length} 条最近事件</span></span></button>
    </div>

    <section className="lf-panel lf-forwarding-panel">
      <div className="lf-panel-head"><div><h3>转发地址</h3><span>只读 · 当前环境</span></div><button className="lf-text-button" type="button" onClick={() => onNavigate("environment")}>编辑配置 →</button></div>
      <div className="lf-forwarding-grid">
        {targets.length === 0 ? <div className="lf-panel-empty">当前环境没有启用的转发地址。</div> : targets.map((target) => <div className="lf-forwarding-item" key={target.id}><span className="lf-forwarding-key">{target.name.slice(0, 4)}</span><span className="lf-forwarding-copy"><code>{addressForTarget(target)}</code><span>{target.enabled ? "已启用" : "已停用"}</span></span></div>)}
      </div>
    </section>
  </section>;
}

export interface EnvironmentPageProps {
  instances: ProxyInstanceSummary[];
  selectedInstance?: ProxyInstanceSummary;
  status: RuntimeStatus;
  config: AppConfig;
  bulkBusy: boolean;
  onSelectInstance: (id: string) => void;
  onToggleInstance: (instance: ProxyInstanceSummary) => void;
  onCreate: () => void;
  onDuplicate: () => void;
  onDelete: (id: string) => void;
  onStartAll: () => void;
  onStopAll: () => void;
  onChange: (config: AppConfig) => Promise<boolean>;
  onChooseProjectDirectory: () => Promise<boolean>;
  onRename: (id: string, name: string) => Promise<boolean>;
  onStart: () => Promise<void>;
  onStop: () => Promise<void>;
}

export function EnvironmentPage({ instances, selectedInstance, status, config, bulkBusy, onSelectInstance, onToggleInstance, onCreate, onDuplicate, onDelete, onStartAll, onStopAll, onChange, onChooseProjectDirectory, onRename, onStart, onStop }: EnvironmentPageProps) {
  const { notifyError } = useToast();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "running" | "stopped" | "error">("all");
  const [addressDrafts, setAddressDrafts] = useState<AddressDraft[]>(() => draftsForTargets(config.tcpTargets));
  const orderedInstances = useMemo(
    () => orderProxyInstancesForDisplay(instances, instances.map((instance) => instance.id)),
    [instances],
  );
  const filtered = useMemo(() => orderedInstances.filter((instance) => {
    const normalized = query.trim().toLocaleLowerCase();
    const matchesQuery = normalized === "" || `${instance.name} ${instance.bindHost}:${instance.port} ${instance.target}`.toLocaleLowerCase().includes(normalized);
    const matchesFilter = filter === "all" || (filter === "running" ? instance.status.state === "running" : filter === "error" ? instance.status.state === "error" : instance.status.state === "stopped");
    return matchesQuery && matchesFilter;
  }), [filter, orderedInstances, query]);

  useEffect(() => { setAddressDrafts(draftsForTargets(config.tcpTargets)); }, [config.tcpTargets]);

  const saveAddresses = async (drafts: AddressDraft[]) => {
    try {
      const firstEmpty = drafts.findIndex((draft) => draft.address.trim() === "");
      const laterFilled = firstEmpty >= 0 && drafts.slice(firstEmpty + 1).some((draft) => draft.address.trim() !== "");
      if (laterFilled) throw new Error("请按 hq、jy、zx 顺序填写地址");
      const populated = drafts.filter((draft) => draft.address.trim() !== "");
      const currentAddresses = config.tcpTargets.map(addressForTarget);
      const nextAddresses = populated.map((draft) => draft.address.trim());
      if (currentAddresses.length === nextAddresses.length && currentAddresses.every((address, index) => address === nextAddresses[index])) return;
      const tcpTargets = populated.map((draft, index) => targetFromDraft(draft, index));
      let forwardingAddressHistory: ForwardingAddressHistory = {
        hq: forwardingAddressHistoryForTarget(config.forwardingAddressHistory, "hq"),
        jy: forwardingAddressHistoryForTarget(config.forwardingAddressHistory, "jy"),
        zx: forwardingAddressHistoryForTarget(config.forwardingAddressHistory, "zx"),
      };
      currentAddresses.forEach((address, index) => {
        const key = (["hq", "jy", "zx"] as const)[index];
        if (key !== undefined) forwardingAddressHistory = { ...forwardingAddressHistory, [key]: appendForwardingAddressHistory(forwardingAddressHistory[key], address) };
      });
      nextAddresses.forEach((address, index) => {
        const key = (["hq", "jy", "zx"] as const)[index];
        if (key !== undefined) forwardingAddressHistory = { ...forwardingAddressHistory, [key]: appendForwardingAddressHistory(forwardingAddressHistory[key], address) };
      });
      await onChange({ ...config, tcpTargets, forwardingAddressHistory });
    } catch (cause) {
      setAddressDrafts(draftsForTargets(config.tcpTargets));
      notifyError(cause, "地址配置无效");
    }
  };

  const updateAddress = (index: number, address: string) => {
    setAddressDrafts((current) => current.map((draft, draftIndex) => draftIndex === index ? { ...draft, address } : draft));
  };

  return <section className="lf-view-body">
    <WorkspacePageHeader eyebrow="Runtime · Environment" title="环境" badge={<span className="lf-count-pill">{instances.length} 个实例</span>} description="所有代理实例集中管理。环境决定剩余页面的数据作用域，切换后监听地址和上游目标同步变化。" actions={<><button className="lf-btn" type="button" disabled={bulkBusy || instances.length === 0} onClick={onStartAll}><WorkspaceIcon name="play" className="lf-icon" />启动全部</button><button className="lf-btn danger" type="button" disabled={bulkBusy || instances.length === 0} onClick={onStopAll}><WorkspaceIcon name="stop" className="lf-icon" />停止全部</button><button className="lf-btn primary" type="button" onClick={onCreate}>新增环境</button></>} />
    <section className="lf-panel lf-simple-table-panel">
      <div className="lf-simple-toolbar">
        <label className="lf-search-control"><WorkspaceIcon name="search" className="lf-icon" /><input type="search" placeholder="搜索环境名称、端口或上游" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <div className="lf-filter-chips">{[["all", `全部 ${instances.length}`], ["running", `运行中 ${instances.filter((instance) => instance.status.state === "running").length}`], ["stopped", `已停止 ${instances.filter((instance) => instance.status.state === "stopped").length}`], ["error", `异常 ${instances.filter((instance) => instance.status.state === "error").length}`]] .map(([value, label]) => <button className={`lf-chip ${filter === value ? "active" : ""}`} type="button" key={value} onClick={() => setFilter(value as typeof filter)}>{label}</button>)}</div>
        <div className="lf-toolbar-spacer" />
        <button className="lf-btn small" type="button" onClick={onDuplicate} disabled={instances.length === 0}>复制当前</button>
      </div>
      <div className="lf-table-wrap"><table className="lf-data-table"><thead><tr><th>环境</th><th>监听地址</th><th>上游</th><th>状态</th><th>请求</th><th>登录字段</th><th>操作</th></tr></thead><tbody>
        {filtered.length === 0 ? <tr><td colSpan={7}><div className="lf-table-empty">{instances.length === 0 ? "还没有代理环境。" : "没有符合筛选条件的环境。"}</div></td></tr> : filtered.map((instance) => <tr className={instance.selected ? "selected" : ""} key={instance.id}>
          <td className="lf-cell-select"><button className="lf-cell-env as-button" type="button" aria-pressed={instance.selected} onClick={() => onSelectInstance(instance.id)}><span className={`lf-status-dot ${toneForState(instance.status.state)}`} /><strong>{instance.name}</strong>{instance.selected && <small>当前</small>}</button></td>
          <td className="lf-cell-mono">{instance.bindHost}:{instance.port}</td>
          <td className="lf-cell-mono">{instance.target}</td>
          <td><span className={`lf-status-badge ${toneForState(instance.status.state)}`}>{instanceStatusLabel(instance.status.state)}</span></td>
          <td className="lf-cell-mono">{instance.status.requestCount.toLocaleString("zh-CN")}</td>
          <td className="lf-cell-mono">{instance.loginCacheCount}</td>
          <td><div className="lf-row-actions"><InstanceToggleButton instance={instance} onToggle={onToggleInstance} /><button className="lf-mini-action danger" type="button" title="删除环境" aria-label={`删除 ${instance.name}`} onClick={() => { if (window.confirm(`确定删除代理环境“${instance.name}”吗？`)) onDelete(instance.id); }}><WorkspaceIcon name="trash" className="lf-icon lf-icon-sm" /></button></div></td>
        </tr>)}
      </tbody></table></div>
    </section>
    <section className="lf-section-heading"><div><p className="lf-eyebrow">Environment details</p><h2>当前环境配置</h2></div><span className="lf-faint">重命名、监听地址、端口与项目目录会立即保存</span></section>
    <ProxyInstancePanel instances={instances} status={status} config={config} onChange={onChange} onChooseProjectDirectory={onChooseProjectDirectory} onRename={onRename} onStart={onStart} onStop={onStop} />
    <section className="lf-panel lf-forwarding-settings" aria-label="转发地址配置">
      <div className="lf-panel-head"><div><h3>转发地址</h3><span>/reqxml · 当前环境</span></div><span className="lf-faint lf-small">失焦自动保存</span></div>
      <div className="lf-address-grid">
        {addressDrafts.slice(0, 3).map((draft, index) => <label className="lf-address-field" key={draft.id}>
          <span><strong>{(["hq", "jy", "zx"] as const)[index]}</strong><small>{draft.address.trim() === "" ? "未配置" : "已启用"}</small></span>
          <input
            className="lf-control mono"
            aria-label={`${(["hq", "jy", "zx"] as const)[index]} 转发地址`}
            list={`lf-address-history-${index}`}
            value={draft.address}
            placeholder={index === 0 ? "tcp://10.20.18.91:9101" : index === 1 ? "tcp://10.20.18.91:9102" : "tcp://10.20.18.91:9103"}
            onChange={(event) => updateAddress(index, event.target.value)}
            onBlur={() => void saveAddresses(addressDrafts)}
          />
          <datalist id={`lf-address-history-${index}`}>{forwardingAddressHistoryForTarget(config.forwardingAddressHistory, (["hq", "jy", "zx"] as const)[index]).map((address) => <option key={address} value={address} />)}</datalist>
        </label>)}
      </div>
    </section>
  </section>;
}

export interface ActivityPageProps {
  logs: LogEntry[];
  instanceName: string;
  onClear: () => Promise<boolean>;
  onInspect: (entry: LogEntry) => void;
  onFillJson: (text: string) => void;
}

export function ActivityPage({ logs, instanceName, onClear, onInspect, onFillJson }: ActivityPageProps) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | "request" | "cache" | "error">("all");
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return logs.slice().reverse().filter((entry) => {
      const searchable = `${entry.message} ${entry.requestPath ?? ""} ${entry.requestParams ?? ""} ${entry.responseData ?? ""}`.toLocaleLowerCase();
      const matchesQuery = normalized === "" || searchable.includes(normalized);
      const matchesKind = kind === "all" || (kind === "request" ? entry.requestPath !== undefined || entry.message.includes("请求") : kind === "cache" ? /缓存|写入|保存|同步/.test(entry.message) : entry.level === "error" || entry.level === "warn");
      return matchesQuery && matchesKind;
    }).slice(0, 500);
  }, [kind, logs, query]);
  const exportLogs = () => {
    const blob = new Blob([JSON.stringify(filtered, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `local-forwarder-activity-${Date.now()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  return <section className="lf-view-body">
    <WorkspacePageHeader eyebrow="Runtime · Activity" title="活动" badge={<span className="lf-scope-pill"><span className="lf-status-dot running" /><strong>实时</strong></span>} description="代理生命周期、请求结果、缓存写入和错误统一进入活动流。选择请求事件可查看完整参数，带应答的记录可直接进入 JSON 可视化。" actions={<><button className="lf-btn" type="button" onClick={exportLogs} disabled={filtered.length === 0}>导出</button><button className="lf-btn danger" type="button" onClick={() => { if (window.confirm("确定清空全部日志吗？")) void onClear(); }} disabled={logs.length === 0}>清空</button></>} />
    <section className="lf-panel lf-simple-table-panel">
      <div className="lf-simple-toolbar"><label className="lf-search-control"><WorkspaceIcon name="search" className="lf-icon" /><input type="search" placeholder="搜索路径、Action 或消息" value={query} onChange={(event) => setQuery(event.target.value)} /></label><div className="lf-filter-chips">{([['all', '全部'], ['request', '请求'], ['cache', '缓存'], ['error', '错误']] as const).map(([value, label]) => <button className={`lf-chip ${kind === value ? "active" : ""}`} type="button" key={value} onClick={() => setKind(value)}>{label}</button>)}</div><div className="lf-toolbar-spacer" /><span className="lf-faint lf-small">最近 {filtered.length} 条</span></div>
      <div className="lf-table-wrap"><table className="lf-data-table"><thead><tr><th>时间</th><th>级别</th><th>环境</th><th>事件</th><th>详情</th><th>耗时</th><th>操作</th></tr></thead><tbody>
        {filtered.length === 0 ? <tr><td colSpan={7}><div className="lf-table-empty">暂无活动记录。</div></td></tr> : filtered.map((entry, index) => <tr key={`${entry.timestamp}-${index}`}><td className="lf-cell-mono">{formatClock(entry.timestamp)}</td><td><span className={`lf-status-badge ${levelClass(entry.level)}`}>{entry.level.toUpperCase()}</span></td><td>{instanceName}</td><td><LogRowLabel message={entry.message} requestParams={entry.requestParams} /></td><td className="lf-cell-mono lf-cell-ellipsis" title={logDetail(entry)}>{logDetail(entry)}</td><td className="lf-cell-mono">{entry.durationMs === undefined ? "—" : `${entry.durationMs} ms`}</td><td><div className="lf-row-actions">{isRequestLog(entry) && <button className="lf-text-button" type="button" onClick={() => onInspect(entry)}>查看</button>}{hasResponseData(entry) && <button className="lf-text-button" type="button" onClick={() => onFillJson(entry.responseData!)}>JSON 可视化</button>}{!isRequestLog(entry) && !hasResponseData(entry) && <span className="lf-faint">—</span>}</div></td></tr>)}
      </tbody></table></div>
    </section>
  </section>;
}

export function RequestHistoryPage({ logs, instanceName, onInspect, onFillJson, onOpenDebug }: { logs: LogEntry[]; instanceName: string; onInspect: (entry: LogEntry) => void; onFillJson: (text: string) => void; onOpenDebug: () => void }) {
  const requests = useMemo(() => logs.slice().reverse().filter((entry) => entry.requestPath !== undefined || entry.requestParams !== undefined).slice(0, 300), [logs]);
  return <section className="lf-view-body">
    <WorkspacePageHeader eyebrow="Debug · History" title="请求历史" badge={<span className="lf-count-pill">{requests.length} 条</span>} description="最近捕获的请求参数、协议、状态码和耗时。选择记录可查看完整详情，带应答的数据可直接进入 JSON 可视化。" actions={<button className="lf-btn primary" type="button" onClick={onOpenDebug}>新建请求</button>} />
    <section className="lf-panel lf-simple-table-panel"><div className="lf-table-wrap"><table className="lf-data-table"><thead><tr><th>时间</th><th>环境</th><th>协议</th><th>路径</th><th>状态</th><th>耗时</th><th>操作</th></tr></thead><tbody>
      {requests.length === 0 ? <tr><td colSpan={7}><div className="lf-table-empty">还没有请求记录。发送一次请求后会出现在这里。</div></td></tr> : requests.map((entry, index) => <tr key={`${entry.timestamp}-${index}`}><td className="lf-cell-mono">{formatClock(entry.timestamp)}</td><td>{instanceName}</td><td className="lf-cell-mono">{entry.protocol?.toUpperCase() ?? (entry.requestPath === undefined ? "TZT TCP" : "HTTP")}</td><td><LogRowLabel message={entry.message} requestParams={entry.requestParams} /></td><td><span className={`lf-status-badge ${entry.statusCode !== undefined && entry.statusCode >= 400 ? "warn" : "success"}`}>{entry.statusCode ?? "OK"}</span></td><td className="lf-cell-mono">{entry.durationMs === undefined ? "—" : `${entry.durationMs} ms`}</td><td><div className="lf-row-actions"><button className="lf-text-button" type="button" onClick={() => onInspect(entry)}>查看</button>{hasResponseData(entry) && <button className="lf-text-button" type="button" onClick={() => onFillJson(entry.responseData!)}>JSON 可视化</button>}</div></td></tr>)}
    </tbody></table></div></section>
  </section>;
}

type BuildTaskFilter = "all" | "running" | "success" | "failed";

export function BuildJobsPage({ tasks, onOpenBuild, onBackfillTask, onNotify }: { tasks: BuildTask[]; onOpenBuild: () => void; onBackfillTask: (task: BuildTask) => void; onNotify?: (message: string) => void }) {
  const [filter, setFilter] = useState<BuildTaskFilter>("all");
  const filteredTasks = useMemo(() => tasks.filter((task) => {
    if (filter === "running") return task.status === "running";
    if (filter === "success") return task.status === "success";
    if (filter === "failed") return task.status === "error" || task.status === "canceled";
    return true;
  }), [filter, tasks]);
  const counts = useMemo(() => ({
    all: tasks.length,
    running: tasks.filter((task) => task.status === "running").length,
    success: tasks.filter((task) => task.status === "success").length,
    failed: tasks.filter((task) => task.status === "error" || task.status === "canceled").length,
  }), [tasks]);
  const exportTasks = () => {
    const blob = new Blob([JSON.stringify(tasks, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `local-forwarder-build-jobs-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    onNotify?.("任务记录已导出");
  };
  return <section className="lf-view-body">
    <WorkspacePageHeader eyebrow="Build · Jobs" title="任务记录" badge={<span className="lf-count-pill">{tasks.length} 条</span>} description="构建任务全局保留；进度、日志和失败文件不会因为切换环境而丢失。" actions={<><button className="lf-btn" type="button" disabled={tasks.length === 0} onClick={exportTasks}>导出记录</button><button className="lf-btn primary" type="button" onClick={onOpenBuild}>新建任务</button></>} />
    <section className="lf-panel lf-simple-table-panel">
      <div className="lf-simple-toolbar"><div className="lf-filter-chips">{([['all', `全部 ${counts.all}`], ['running', `运行中 ${counts.running}`], ['success', `已完成 ${counts.success}`], ['failed', `失败 ${counts.failed}`]] as const).map(([value, label]) => <button className={`lf-chip ${filter === value ? "active" : ""}`} type="button" key={value} onClick={() => setFilter(value)}>{label}</button>)}</div><div className="lf-toolbar-spacer" /><span className="lf-faint lf-small">全局任务中心</span></div>
      <div className="lf-table-wrap"><table className="lf-data-table"><thead><tr><th>任务</th><th>方向</th><th>模式</th><th>文件</th><th>状态</th><th>开始时间</th><th>耗时</th><th>操作</th></tr></thead><tbody>
        {filteredTasks.length === 0 ? <tr><td colSpan={8}><div className="lf-table-empty">{tasks.length === 0 ? "还没有构建任务。前往资源构建开始加密或解密。" : "当前筛选条件下没有任务。"}</div></td></tr> : filteredTasks.map((task) => {
          const percent = task.totalFiles !== undefined && task.totalFiles > 0 ? Math.min(100, Math.round(((task.processedFiles ?? 0) / task.totalFiles) * 100)) : undefined;
          const statusLabel = task.status === "success" ? "已完成" : task.status === "running" ? `运行中${percent === undefined ? "" : ` ${percent}%`}` : task.status === "canceled" ? "已取消" : "失败";
          return <tr className={task.status === "running" ? "selected" : ""} key={task.id}><td className="lf-cell-mono lf-cell-ellipsis" title={`${task.inputDir} → ${task.outputDir}`}>{shortPath(task.inputDir)} → {task.kind === "encrypt" ? ".d" : shortPath(task.outputDir)}</td><td>{task.kind === "encrypt" ? "加密" : "解密"}</td><td>{task.mode === "incremental" ? "增量" : task.mode === "restore" ? "还原" : "全量"}</td><td className="lf-cell-mono">{task.processedFiles ?? "—"} / {task.totalFiles ?? "—"}</td><td><span className={`lf-status-badge ${task.status === "success" ? "success" : task.status === "running" ? "running" : task.status === "canceled" ? "warn" : "error"}`}>{statusLabel}</span></td><td className="lf-cell-mono">{formatDateTime(task.startedAt)}</td><td className="lf-cell-mono">{task.finishedAt === undefined ? "—" : `${Math.max(1, Math.round((task.finishedAt - task.startedAt) / 1000))} 秒`}</td><td className="lf-cell-action"><button className="lf-text-button" type="button" aria-label={`回填${task.kind === "encrypt" ? "加密" : "解密"}任务目录`} onClick={() => onBackfillTask(task)}>回填目录</button></td></tr>;
        })}
      </tbody></table></div>
    </section>
  </section>;
}

export function UpdateSettingsPage({ appVersion, updateState, onCheck, onDownload, onInstall, onCancel }: { appVersion: string; updateState: UpdateState; onCheck: () => void; onDownload: () => void; onInstall: () => void; onCancel: () => void }) {
  const stateCopy = updateState.state === "checking" ? "正在检查更新" : updateState.state === "available" ? `发现新版本 ${updateState.update?.version ?? ""}` : updateState.state === "downloading" ? `正在下载 ${Math.round(updateState.progress?.percent ?? 0)}%` : updateState.state === "downloaded" ? "更新已下载，可以安装" : updateState.state === "not-available" ? "当前已是最新版本" : updateState.state === "error" ? updateState.error ?? "检查更新失败" : "尚未检查更新";
  return <section className="lf-view-body">
    <WorkspacePageHeader eyebrow="Settings · Update" title="更新" description="版本更新、下载进度和安装状态集中在设置里，不在工作台抢占视线。" />
    <section className="lf-panel lf-version-card"><div className="lf-version-icon"><WorkspaceIcon name="update" /></div><div className="lf-version-copy"><strong>Local Forwarder {appVersion || updateState.currentVersion || "—"}</strong><span>{stateCopy}</span></div>{updateState.state === "available" ? <button className="lf-btn primary" type="button" onClick={onDownload}>下载更新</button> : updateState.state === "downloading" ? <button className="lf-btn danger" type="button" onClick={onCancel}>停止下载</button> : updateState.state === "downloaded" ? <button className="lf-btn primary" type="button" onClick={onInstall}>安装更新</button> : <button className="lf-btn primary" type="button" disabled={updateState.state === "checking"} onClick={onCheck}>{updateState.state === "checking" ? "正在检查" : "检查更新"}</button>}</section>
    <section className="lf-panel lf-settings-panel"><h3>更新通道</h3><p>正式版本从发布渠道获取。安装更新前，应用会先停止正在运行的代理。</p><div className="lf-settings-row"><span>自动检查更新</span><span className="lf-status-badge success">已启用</span></div><div className="lf-settings-row"><span>下载完成后提示安装</span><span className="lf-status-badge success">已启用</span></div></section>
  </section>;
}

export function AdvancedSettingsPage({ config, version, onExportConfig, onNotify }: { config: AppConfig; version: string; onExportConfig: () => void; onNotify: (message: string) => void }) {
  return <section className="lf-view-body">
    <WorkspacePageHeader eyebrow="Settings · Advanced" title="高级" description="数据目录、配置导出和快捷键等低频操作收在这里。" />
    <section className="lf-panel lf-settings-panel"><h3>数据与配置</h3><p>配置文件、日志和缓存保存在本机；导出前不会上传。</p><div className="lf-settings-row"><span>应用数据目录 <code>~/Library/Application Support/Local Forwarder</code></span><button className="lf-btn small" type="button" onClick={() => onNotify("请在系统文件管理器中打开应用数据目录")}>提示</button></div><div className="lf-settings-row"><span>导出全部配置</span><button className="lf-btn small" type="button" onClick={onExportConfig}>导出</button></div><div className="lf-settings-row"><span>当前配置来源</span><code className="lf-mono">{config.projectPath ?? "默认配置"}</code></div></section>
    <section className="lf-panel lf-settings-panel"><h3>快捷键</h3><p>命令面板与调试、日志的常用入口。</p><div className="lf-settings-row"><span>搜索与命令</span><kbd>⌘ K</kbd></div><div className="lf-settings-row"><span>切换环境</span><kbd>⌘ P</kbd></div><div className="lf-settings-row"><span>切换外观</span><kbd>⌘ L</kbd></div><div className="lf-settings-row"><span>打开日志控制台</span><kbd>⌘ J</kbd></div><div className="lf-settings-row"><span>打开请求调试</span><kbd>⌘ 2</kbd></div><div className="lf-settings-row"><span>打开日志页</span><kbd>⌘ 5</kbd></div><div className="lf-settings-row"><span>恢复默认快捷键</span><button className="lf-btn small" type="button" onClick={() => onNotify("快捷键已恢复默认")}>恢复</button></div></section>
    <section className="lf-panel lf-settings-panel"><h3>关于</h3><p>Local Forwarder {version || "—"} · Electron 本地转发工作区</p><div className="lf-settings-row"><span>配置版本</span><code className="lf-mono">AppConfig v1</code></div></section>
  </section>;
}
