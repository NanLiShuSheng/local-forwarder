import { useEffect, useMemo, useRef, useState } from "react";
import type { LogEntry, ProxyInstanceSummary, RuntimeState, RuntimeStatus, UpdateState } from "../../shared/contracts";
import type { ResolvedTheme } from "../theme";
import {
  workspaceGroups,
  workspaceIconPaths,
  workspaceRailGroups,
  type WorkspaceGroup,
  type WorkspaceGroupKey,
  type WorkspaceIconName,
  type WorkspaceRoute,
} from "../workspace-navigation";
import { loginCacheCustomerSummary } from "../login-cache-data";
import { LogRowLabel } from "./LogPanel";
import { orderProxyInstancesForDisplay } from "./ProxyInstanceSidebar";

export type DockTab = "logs" | "cache" | "request";

export function WorkspaceIcon({ name, className = "lf-icon" }: { name: WorkspaceIconName; className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">{workspaceIconPaths[name].map((path) => <path d={path} key={path} />)}</svg>;
}

export function instanceStatusLabel(state: RuntimeState): string {
  if (state === "running") return "运行中";
  if (state === "starting") return "启动中";
  if (state === "stopping") return "停止中";
  if (state === "error") return "异常";
  return "已停止";
}

export function InstanceToggleButton({ instance, onToggle }: { instance: ProxyInstanceSummary; onToggle: (instance: ProxyInstanceSummary) => void }) {
  const running = instance.status.state === "running";
  const busy = instance.status.state === "starting" || instance.status.state === "stopping";
  const toggleLabel = running ? `停止 ${instance.name}` : `启动 ${instance.name}`;
  return <button
    className={`lf-env-toggle ${running ? "stop" : "start"} ${busy ? "busy" : ""}`}
    type="button"
    title={toggleLabel}
    aria-label={toggleLabel}
    disabled={busy}
    onClick={(event) => { event.stopPropagation(); onToggle(instance); }}
  >
    <WorkspaceIcon name={busy ? "refresh" : running ? "stop" : "play"} className={`lf-icon lf-icon-sm lf-env-toggle-icon ${busy ? "spin" : ""}`} />
  </button>;
}

function statusTone(state: RuntimeState): string {
  if (state === "running") return "running";
  if (state === "starting" || state === "stopping") return "warning";
  if (state === "error") return "error";
  return "stopped";
}

function selectedStatus(instance: ProxyInstanceSummary | undefined, fallback: RuntimeStatus): RuntimeStatus {
  return instance?.status ?? fallback;
}

export interface WorkspaceTitlebarProps {
  instances: ProxyInstanceSummary[];
  selectedInstance?: ProxyInstanceSummary;
  fallbackStatus: RuntimeStatus;
  loginCache: Record<string, string>;
  theme: ResolvedTheme;
  appVersion: string;
  updateState: UpdateState;
  environmentOpen: boolean;
  onToggleEnvironment: () => void;
  onCloseEnvironment: () => void;
  onSelectInstance: (id: string) => void;
  onToggleInstance: (instance: ProxyInstanceSummary) => void;
  onDuplicateCurrent: () => void;
  onOpenCommand: () => void;
  onCheckForUpdates: () => void;
  onToggleTheme: () => void;
  onOpenAccount: () => void;
}

export function WorkspaceTitlebar({
  instances,
  selectedInstance,
  fallbackStatus,
  loginCache,
  theme,
  appVersion,
  updateState,
  environmentOpen,
  onToggleEnvironment,
  onCloseEnvironment,
  onSelectInstance,
  onToggleInstance,
  onDuplicateCurrent,
  onOpenCommand,
  onCheckForUpdates,
  onToggleTheme,
  onOpenAccount,
}: WorkspaceTitlebarProps) {
  const status = selectedStatus(selectedInstance, fallbackStatus);
  const customer = loginCacheCustomerSummary(loginCache);
  const updateAvailable = updateState.state === "available" || updateState.state === "downloaded";
  const versionLabel = appVersion || updateState.currentVersion;
  const orderedInstances = useMemo(
    () => orderProxyInstancesForDisplay(instances, instances.map((instance) => instance.id)),
    [instances],
  );

  return <header className="lf-titlebar">
    <div className="lf-brand">
      <div className="lf-brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M7.2 4.8v14.4h10" stroke="currentColor" strokeWidth="2.7" strokeLinecap="round" strokeLinejoin="round" /></svg></div>
      <div className="lf-brand-copy"><strong>Local Forwarder</strong><span>中焯代理 <b className="lf-brand-version">v{versionLabel || "—"}</b></span></div>
    </div>
    <div className="lf-env-anchor">
      <button className="lf-env-switch" type="button" aria-haspopup="listbox" aria-expanded={environmentOpen} onClick={onToggleEnvironment}>
        <span className={`lf-status-dot ${statusTone(status.state)}`} />
        <span className="lf-env-name">{selectedInstance?.name ?? "未选择环境"}</span>
        <span className="lf-env-addr">{selectedInstance === undefined ? "请先创建环境" : `:${selectedInstance.port}`}</span>
        <WorkspaceIcon name="chevron-down" className="lf-icon lf-icon-sm lf-chevron" />
      </button>
      {environmentOpen && <div className="lf-env-popover">
        <div className="lf-popover-head"><span>切换环境</span><kbd>⌘P</kbd></div>
        <div className="lf-env-list" role="listbox" aria-label="切换环境">
          {orderedInstances.map((instance) => {
            const tone = statusTone(instance.status.state);
            return <div className={`lf-env-option-row ${instance.selected ? "active" : ""}`} key={instance.id}>
              <button
                className="lf-env-option"
                type="button"
                role="option"
                aria-selected={instance.selected}
                onClick={() => { onSelectInstance(instance.id); onCloseEnvironment(); }}
              >
                <span className={`lf-status-dot ${tone}`} />
                <span className="lf-env-option-copy">
                  <span className="lf-env-option-title"><strong>{instance.name}</strong><span className={`lf-env-state ${tone}`}>{instanceStatusLabel(instance.status.state)}</span></span>
                  <small><code>:{instance.port}</code><span>{instance.target}</span></small>
                </span>
              </button>
              <InstanceToggleButton instance={instance} onToggle={onToggleInstance} />
            </div>;
          })}
          {instances.length === 0 && <p className="lf-popover-empty">还没有代理环境</p>}
        </div>
        <div className="lf-popover-foot"><button type="button" disabled={instances.length === 0} onClick={() => { onDuplicateCurrent(); onCloseEnvironment(); }}>复制当前</button></div>
      </div>}
    </div>
    <div className="lf-titlebar-spacer" />
    <button className="lf-cmd-button" type="button" onClick={onOpenCommand}><WorkspaceIcon name="search" className="lf-icon lf-icon-sm" /><span>搜索环境、页面或命令</span><kbd>⌘</kbd><kbd>K</kbd></button>
    <button className={`lf-icon-button ${updateAvailable ? "has-update" : ""}`} type="button" title={updateAvailable ? `发现新版本 ${updateState.update?.version ?? ""}` : "检查更新"} onClick={onCheckForUpdates}><WorkspaceIcon name="update" className="lf-icon" />{updateAvailable && <span className="lf-update-dot" />}</button>
    <button className="lf-icon-button" type="button" title={theme === "dark" ? "切换到浅色外观（⌘L）" : "切换到深色外观（⌘L）"} onClick={onToggleTheme}><WorkspaceIcon name={theme === "dark" ? "sun" : "moon"} className="lf-icon" /></button>
    <button className="lf-account-chip" type="button" title={customer.hasCustomer ? `当前登录客户 ${customer.code}` : "查看登录缓存"} onClick={onOpenAccount}>{customer.initial}</button>
  </header>;
}

export function WorkspaceRail({ activeGroup, onSelectGroup }: { activeGroup: WorkspaceGroupKey; onSelectGroup: (group: WorkspaceGroupKey) => void }) {
  return <nav className="lf-rail" aria-label="工作区">
    {workspaceRailGroups.map((key) => {
      const group = workspaceGroups[key];
      return <button className={`lf-rail-button ${activeGroup === key ? "active" : ""}`} type="button" aria-current={activeGroup === key ? "page" : undefined} title={group.label} key={key} onClick={() => onSelectGroup(key)}><WorkspaceIcon name={group.icon} /><span>{group.label}</span></button>;
    })}
    <div className="lf-rail-spacer" />
    <div className="lf-rail-divider" />
    <button className={`lf-rail-button ${activeGroup === "settings" ? "active" : ""}`} type="button" aria-current={activeGroup === "settings" ? "page" : undefined} title="设置" onClick={() => onSelectGroup("settings")}><WorkspaceIcon name="settings" /><span>设置</span></button>
  </nav>;
}

export interface WorkspaceContextProps {
  group: WorkspaceGroup;
  activeRoute: WorkspaceRoute;
  badges: Partial<Record<WorkspaceRoute, number>>;
  loginCache: Record<string, string>;
  selectedInstance?: ProxyInstanceSummary;
  onNavigate: (route: WorkspaceRoute) => void;
  onOpenSession: () => void;
}

export function WorkspaceContext({ group, activeRoute, badges, loginCache, selectedInstance, onNavigate, onOpenSession }: WorkspaceContextProps) {
  const customer = loginCacheCustomerSummary(loginCache);
  const note = group.key === "run" && selectedInstance !== undefined ? `${selectedInstance.name} · :${selectedInstance.port}` : group.note;
  return <aside className="lf-context" aria-label={`${group.label}导航`}>
    <div className="lf-context-head"><p className="lf-context-eyebrow">{group.eyebrow}</p><h1>{group.title}</h1><p>{group.subtitle}</p></div>
    <div className="lf-context-nav">
      <div className="lf-context-section-label">{group.section}</div>
      {group.items.map((item) => {
        const badge = badges[item.route];
        return <button className={`lf-context-item ${activeRoute === item.route ? "active" : ""}`} type="button" aria-current={activeRoute === item.route ? "page" : undefined} key={item.route} onClick={() => onNavigate(item.route)}>
          <WorkspaceIcon name={item.icon} className="lf-icon" />
          <span className="lf-context-label">{item.label}</span>
          {item.route === "variables" && <span className="lf-global-tag">全局</span>}
          {badge !== undefined && badge > 0 && <span className="lf-item-badge">{badge > 999 ? "999+" : badge}</span>}
        </button>;
      })}
      <div className="lf-context-note"><strong>{group.noteTitle}</strong><span>{note}</span></div>
    </div>
    <div className="lf-context-footer">
      <div className="lf-operator">
        <div className="lf-operator-avatar">{customer.initial}</div>
        <div className="lf-operator-copy"><strong>{customer.hasCustomer ? customer.code : "未登录"}</strong><span>{customer.hasCustomer ? `当前登录身份 · ${Object.keys(loginCache).length} 个字段` : "完成登录后自动缓存会话"}</span></div>
        <button className="lf-operator-more" type="button" title="查看登录缓存" onClick={onOpenSession}>···</button>
      </div>
    </div>
  </aside>;
}

export interface WorkspaceStatusbarProps {
  selectedInstance?: ProxyInstanceSummary;
  fallbackStatus: RuntimeStatus;
  logCount: number;
  version: string;
  dockOpen: boolean;
  onToggleDock: () => void;
}

export function WorkspaceStatusbar({ selectedInstance, fallbackStatus, logCount, version, dockOpen, onToggleDock }: WorkspaceStatusbarProps) {
  const status = selectedStatus(selectedInstance, fallbackStatus);
  const address = selectedInstance === undefined ? "—" : `:${selectedInstance.port}`;
  return <footer className="lf-statusbar">
    <span className={`lf-status-item ${statusTone(status.state)}`}><span className={`lf-status-dot ${statusTone(status.state)}`} />{instanceStatusLabel(status.state)}</span>
    <span className="lf-status-item">{selectedInstance?.name ?? "无环境"} · <code>{address}</code></span>
    <span className="lf-status-item">请求 <code>{status.requestCount.toLocaleString("zh-CN")}</code></span>
    <span className="lf-status-item">TCP <code>{status.tcpConnections}</code></span>
    {status.error !== undefined ? <span className="lf-status-item error" title={status.error}>最近错误 · {status.error}</span> : <span className="lf-status-item">最近错误 · <code>无</code></span>}
    <div className="lf-status-spacer" />
    <button className={`lf-status-dock-button ${dockOpen ? "active" : ""}`} type="button" onClick={onToggleDock}>{dockOpen ? "收起控制台" : `日志控制台 ${logCount > 99 ? "99+" : logCount}`} <kbd>⌘J</kbd></button>
    <span className="lf-status-item">v{version || "—"}</span>
  </footer>;
}

const logLevelLabels: Record<LogEntry["level"], string> = { debug: "DEBUG", info: "INFO", warn: "WARN", error: "ERROR" };

function logTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString("zh-CN", { hour12: false });
}

function isCacheLog(entry: LogEntry): boolean {
  return /缓存|写入|保存|同步|/i.test(entry.message) && /缓存|写入|保存|同步/.test(entry.message);
}

export interface WorkspaceDockProps {
  logs: LogEntry[];
  selected?: LogEntry;
  tab: DockTab;
  onTabChange: (tab: DockTab) => void;
  onSelectLog: (entry: LogEntry) => void;
  onClear: () => void;
  onClose: () => void;
  onFillJson: (text: string) => void;
}

export function WorkspaceDock({ logs, selected, tab, onTabChange, onSelectLog, onClear, onClose, onFillJson }: WorkspaceDockProps) {
  const recent = useMemo(() => logs.slice(-200).reverse(), [logs]);
  const cacheLogs = useMemo(() => recent.filter(isCacheLog), [recent]);
  const requestLogs = useMemo(() => recent.filter((entry) => entry.requestPath !== undefined || entry.requestParams !== undefined || entry.responseData !== undefined), [recent]);
  const rows = tab === "cache" ? cacheLogs : tab === "request" ? requestLogs : recent;
  const selectedInView = selected !== undefined && rows.includes(selected) ? selected : rows[0];

  return <section className="lf-dock" aria-label="日志控制台">
    <div className="lf-dock-head">
      <strong>控制台</strong>
      <div className="lf-dock-tabs" role="tablist" aria-label="控制台视图">
        <button type="button" role="tab" aria-selected={tab === "logs"} className={tab === "logs" ? "active" : ""} onClick={() => onTabChange("logs")}>日志 <span>{logs.length}</span></button>
        <button type="button" role="tab" aria-selected={tab === "cache"} className={tab === "cache" ? "active" : ""} onClick={() => onTabChange("cache")}>缓存变更 <span>{cacheLogs.length}</span></button>
        <button type="button" role="tab" aria-selected={tab === "request"} className={tab === "request" ? "active" : ""} onClick={() => onTabChange("request")}>请求详情</button>
      </div>
      <div className="lf-dock-actions">
        <button type="button" className="lf-text-button" disabled={logs.length === 0} onClick={onClear}><WorkspaceIcon name="trash" className="lf-icon lf-icon-sm" />清空</button>
        <button type="button" className="lf-icon-button" title="收起控制台" onClick={onClose}><WorkspaceIcon name="chevron-down" className="lf-icon lf-icon-sm" /></button>
      </div>
    </div>
    {tab === "request" ? <div className="lf-dock-detail">
      {selectedInView === undefined ? <p className="lf-dock-empty">还没有带请求详情的事件。发送请求后会出现在这里。</p> : <div className="lf-dock-detail-grid">
        <div className="lf-dock-log-list">
          {rows.slice(0, 50).map((entry, index) => <button className={`lf-dock-log-row ${entry === selectedInView ? "selected" : ""}`} type="button" key={`${entry.timestamp}-${index}`} onClick={() => onSelectLog(entry)}><time>{logTime(entry.timestamp)}</time><span className={`lf-log-level ${entry.level}`}>{logLevelLabels[entry.level]}</span><span className="lf-log-message"><LogRowLabel message={entry.message} requestParams={entry.requestParams} /></span></button>)}
        </div>
        <div className="lf-dock-request">
          <div className="lf-dock-request-head"><strong><LogRowLabel message={selectedInView.message} requestParams={selectedInView.requestParams} /></strong>{selectedInView.statusCode !== undefined && <span className="lf-status-badge success">{selectedInView.statusCode}</span>}{selectedInView.durationMs !== undefined && <span className="lf-faint">{selectedInView.durationMs} ms</span>}</div>
          <div className="lf-dock-request-columns">
            <div><span>请求参数</span><pre>{selectedInView.requestParams ?? "无"}</pre></div>
            <div><div className="lf-dock-request-label"><span>应答数据</span>{typeof selectedInView.responseData === "string" && selectedInView.responseData.length > 0 && <button className="lf-text-button lf-dock-json-button" type="button" onClick={() => onFillJson(selectedInView.responseData!)}>JSON 可视化</button>}</div><pre>{selectedInView.responseData ?? "无"}</pre></div>
          </div>
        </div>
      </div>}
    </div> : <div className="lf-dock-body">
      {rows.length === 0 ? <p className="lf-dock-empty">{tab === "cache" ? "当前还没有缓存变更记录。" : "暂无日志。"}</p> : rows.slice(0, 120).map((entry, index) => <button className="lf-dock-log-row" type="button" key={`${entry.timestamp}-${index}`} onClick={() => { onSelectLog(entry); onTabChange("request"); }}><time>{logTime(entry.timestamp)}</time><span className={`lf-log-level ${entry.level}`}>{logLevelLabels[entry.level]}</span><span className="lf-log-message"><LogRowLabel message={entry.message} requestParams={entry.requestParams} /></span>{entry.requestPath !== undefined && <code className="lf-log-path">{entry.requestPath}</code>}</button>)}
    </div>}
  </section>;
}

export interface WorkspaceCommand {
  id: string;
  label: string;
  detail: string;
  group: string;
  shortcut?: string;
  run: () => void;
}

export function CommandPalette({ open, commands, onClose }: { open: boolean; commands: WorkspaceCommand[]; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const results = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (normalized === "") return commands;
    return commands.filter((command) => `${command.label} ${command.detail} ${command.group}`.toLocaleLowerCase().includes(normalized));
  }, [commands, query]);
  const resultGroups = useMemo(() => {
    const groups = new Map<string, Array<{ command: WorkspaceCommand; index: number }>>();
    results.forEach((command, index) => {
      const items = groups.get(command.group) ?? [];
      items.push({ command, index });
      groups.set(command.group, items);
    });
    return Array.from(groups, ([label, items]) => ({ label, items }));
  }, [results]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelectedIndex(0);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    if (selectedIndex >= results.length) setSelectedIndex(Math.max(0, results.length - 1));
  }, [results.length, selectedIndex]);

  useEffect(() => {
    if (!open) return;
    resultsRef.current?.querySelector<HTMLElement>(`[data-command-index="${selectedIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, selectedIndex]);

  if (!open) return null;
  const run = (command: WorkspaceCommand | undefined) => {
    if (command === undefined) return;
    command.run();
    onClose();
  };
  return <div className="lf-command-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="lf-command-dialog" role="dialog" aria-modal="true" aria-label="命令面板">
      <div className="lf-command-input-row"><WorkspaceIcon name="search" className="lf-icon" /><input ref={inputRef} aria-label="搜索命令" aria-autocomplete="list" aria-controls="lf-command-results" aria-activedescendant={results.length === 0 ? undefined : `lf-command-option-${selectedIndex}`} placeholder="搜索页面、环境或操作" value={query} onChange={(event) => { setQuery(event.target.value); setSelectedIndex(0); }} onKeyDown={(event) => {
        if (event.key === "ArrowDown") { event.preventDefault(); setSelectedIndex((current) => Math.min(results.length - 1, current + 1)); }
        else if (event.key === "ArrowUp") { event.preventDefault(); setSelectedIndex((current) => Math.max(0, current - 1)); }
        else if (event.key === "Enter") { event.preventDefault(); run(results[selectedIndex]); }
        else if (event.key === "Escape") { event.preventDefault(); onClose(); }
      }} /><kbd>esc</kbd></div>
      <div ref={resultsRef} id="lf-command-results" className="lf-command-results" role="listbox" aria-label="命令结果">
        {results.length === 0 ? <p className="lf-command-empty">没有匹配的命令</p> : resultGroups.map((group) => <section className="lf-command-section" role="group" aria-label={group.label} key={group.label}>
          <p className="lf-command-section-title">{group.label}</p>
          {group.items.map(({ command, index }) => <button data-command-index={index} id={`lf-command-option-${index}`} className={`lf-command-result ${index === selectedIndex ? "selected" : ""}`} role="option" aria-selected={index === selectedIndex} type="button" key={command.id} onMouseEnter={() => setSelectedIndex(index)} onClick={() => run(command)}><span className="lf-command-copy"><strong>{command.label}</strong><small>{command.detail}</small></span>{command.shortcut !== undefined && <kbd>{command.shortcut}</kbd>}</button>)}
        </section>)}
      </div>
      <div className="lf-command-footer"><span>↑↓ 选择 · ↵ 执行 · esc 关闭</span><span>{results.length} 个结果</span></div>
    </section>
  </div>;
}
