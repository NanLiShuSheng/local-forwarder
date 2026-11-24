import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createDefaultForwardingTargets, DEFAULT_REQUEST_HOST, DEFAULT_REQUEST_PARAMS_TEXT, DEFAULT_REQUEST_PORT } from "../shared/config-defaults";
import type { AppConfig, LogEntry, ManualRequestConfig, ManualRequestResponse, ProxyInstanceSummary, RuntimeStatus, UpdateState } from "../shared/contracts";
import { responseTextToJsonPreview } from "../shared/json-preview";
import { AppearancePage } from "./components/AppearancePage";
import { BuildPage } from "./components/BuildPage";
import { DataBrowserPage } from "./components/DataBrowserPage";
import { JsonPreviewPage } from "./components/JsonPreviewPage";
import { LogPanel } from "./components/LogPanel";
import { RequestPage } from "./components/RequestPage";
import { StringToolPage } from "./components/StringToolPage";
import { ToastProvider, useToast } from "./components/ToastProvider";
import { UpdateCancelDialog } from "./components/UpdateCancelDialog";
import { UpdateCard } from "./components/UpdateCard";
import { CommandPalette, WorkspaceContext, WorkspaceDock, WorkspaceIcon, WorkspaceRail, WorkspaceStatusbar, WorkspaceTitlebar, type DockTab, type SaveState, type WorkspaceCommand } from "./components/WorkspaceChrome";
import { AdvancedSettingsPage, ActivityPage, BuildJobsPage, UpdateSettingsPage, WorkbenchPage, WorkspacePageHeader, type BuildTask } from "./components/WorkspacePages";
import { loginCacheCustomerSummary } from "./login-cache-data";
import { getUpdateDismissalStorage, readDismissedUpdateVersion, writeDismissedUpdateVersion } from "./update-dismissal";
import { createManualCheckTracker, createUpdateStateSynchronizer, resolveManualCheckResult } from "./update-state";
import { useTheme } from "./useTheme";
import { workspaceGroups, workspaceRouteMeta, type WorkspaceGroupKey, type WorkspaceRoute } from "./workspace-navigation";

const initialStatus: RuntimeStatus = { state: "stopped", requestCount: 0, tcpConnections: 0 };
const initialUpdateState: UpdateState = { state: "idle", currentVersion: "" };
const initialConfig: AppConfig = { server: { bindHost: "127.0.0.1", port: 8080, timeoutMs: 30000, loggingEnabled: true }, httpRules: [], tcpTargets: createDefaultForwardingTargets(), localValues: {}, mapValues: {}, accounts: {}, cache: { rootDir: "", downloadTarget: "", decryptEnabled: false, autoDownload: false }, request: { host: DEFAULT_REQUEST_HOST, port: DEFAULT_REQUEST_PORT, paramsText: DEFAULT_REQUEST_PARAMS_TEXT }, stringTool: { inputText: "", outputText: "", operation: "replace", findText: "", replaceText: "" } };
const workspaceShortcutGroups: Record<string, WorkspaceGroupKey> = { "1": "run", "2": "data", "3": "build", "4": "tools", "5": "settings" };
const workspaceGroupShortcuts = Object.fromEntries(Object.entries(workspaceShortcutGroups).map(([key, group]) => [group, `⌘${key}`])) as Partial<Record<WorkspaceGroupKey, string>>;

export function createVersionedLogReader(readLogs: () => Promise<LogEntry[]>, applyLogs: (logs: LogEntry[]) => void) {
  let version = 0;
  return {
    read: async () => {
      const requestVersion = ++version;
      const logs = await readLogs();
      if (requestVersion === version) applyLogs(logs);
    },
    invalidate: () => { version += 1; },
  };
}

function PagePane({ active, children }: { active: boolean; children: ReactNode }) {
  const [hasOpened, setHasOpened] = useState(active);
  useEffect(() => { if (active) setHasOpened(true); }, [active]);
  if (!hasOpened && !active) return null;
  return <section className="lf-view" hidden={!active}>{children}</section>;
}

function KeepAlivePane({ active, children }: { active: boolean; children: ReactNode }) {
  const [hasOpened, setHasOpened] = useState(active);
  useEffect(() => { if (active) setHasOpened(true); }, [active]);
  if (!hasOpened && !active) return null;
  return <div className="lf-keep-alive" hidden={!active}>{children}</div>;
}

interface LoginSuccessNotice {
  id: number;
  values: Record<string, string>;
}

function LoginSuccessCard({ notice, onClose, onOpenCache }: { notice: LoginSuccessNotice; onClose: () => void; onOpenCache: () => void }) {
  const customer = loginCacheCustomerSummary(notice.values);
  return <aside className="login-success-card" role="status" aria-live="polite" aria-label="登录成功客户简讯">
    <div className="login-success-topline" />
    <div className="login-success-head">
      <div className="login-success-heading"><span className="login-success-icon">✓</span><div><strong>登录成功</strong><span>客户信息已更新</span></div></div>
      <button className="login-success-close" type="button" aria-label="关闭客户简讯" onClick={onClose}>×</button>
    </div>
    <div className="login-success-user">
      <div className="login-success-avatar">{customer.initial}</div>
      <div className="login-success-user-copy"><h4>{customer.name}</h4><p>USERCODE <code>{customer.code}</code></p></div>
      <span className="login-success-time">刚刚</span>
    </div>
    <div className="login-success-meta">
      <span><b>开户网点</b><strong>{customer.branch}</strong></span>
      <span><b>客户类型</b><strong>{customer.type}</strong></span>
    </div>
    <div className="login-success-footer"><span>请求成功后显示 · 3 秒后自动隐藏</span><button className="login-success-action" type="button" onClick={onOpenCache}>查看登录缓存 →</button></div>
  </aside>;
}

function AppContent() {
  const { mode, theme, setMode } = useTheme();
  const { notify, notifyError } = useToast();
  const [route, setRoute] = useState<WorkspaceRoute>("workbench");
  const [status, setStatus] = useState(initialStatus);
  const [instances, setInstances] = useState<ProxyInstanceSummary[]>([]);
  const [config, setConfig] = useState(initialConfig);
  const [loginCache, setLoginCache] = useState<Record<string, string>>({});
  const [loginSuccessNotice, setLoginSuccessNotice] = useState<LoginSuccessNotice>();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [selectedLog, setSelectedLog] = useState<LogEntry>();
  const [dockOpen, setDockOpen] = useState(false);
  const [dockTab, setDockTab] = useState<DockTab>("logs");
  const [commandOpen, setCommandOpen] = useState(false);
  const [environmentOpen, setEnvironmentOpen] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [buildTasks, setBuildTasks] = useState<BuildTask[]>([]);
  const [buildBackfillTask, setBuildBackfillTask] = useState<BuildTask>();
  const [bulkRuntimeAction, setBulkRuntimeAction] = useState<"start" | "stop">();
  const [jsonPrefill, setJsonPrefill] = useState<string>();
  const [appVersion, setAppVersion] = useState("");
  const [updateState, setUpdateState] = useState<UpdateState>(initialUpdateState);
  const [dismissedUpdateVersion, setDismissedUpdateVersion] = useState<string | undefined>(() => readDismissedUpdateVersion(getUpdateDismissalStorage()));
  const [updateDismissPrompt, setUpdateDismissPrompt] = useState(false);
  const [hiddenDownloadVersion, setHiddenDownloadVersion] = useState<string | undefined>();
  const [updateCancelBusy, setUpdateCancelBusy] = useState(false);
  const loginNoticeIdRef = useRef(0);
  const manualCheckTrackerRef = useRef<ReturnType<typeof createManualCheckTracker> | undefined>(undefined);
  if (manualCheckTrackerRef.current === undefined) {
    manualCheckTrackerRef.current = createManualCheckTracker();
  }
  const manualCheckTracker = manualCheckTrackerRef.current;
  const updateStateSynchronizerRef = useRef<ReturnType<typeof createUpdateStateSynchronizer> | undefined>(undefined);
  if (updateStateSynchronizerRef.current === undefined) {
    updateStateSynchronizerRef.current = createUpdateStateSynchronizer(initialUpdateState, setUpdateState);
  }
  const updateStateSynchronizer = updateStateSynchronizerRef.current;
  const logReaderRef = useRef<ReturnType<typeof createVersionedLogReader> | null>(null);
  if (logReaderRef.current === null) logReaderRef.current = createVersionedLogReader(() => window.forwarder.logs(), setLogs);
  const readLogs = () => logReaderRef.current!.read();

  const navigate = useCallback((nextRoute: WorkspaceRoute) => {
    setRoute(nextRoute);
    setCommandOpen(false);
    setEnvironmentOpen(false);
    window.requestAnimationFrame(() => document.querySelector<HTMLElement>(".lf-main")?.scrollTo({ top: 0, behavior: "smooth" }));
  }, []);

  const backfillBuildTask = useCallback((task: BuildTask) => {
    setBuildBackfillTask(task);
    navigate("build");
  }, [navigate]);
  const clearBuildBackfillTask = useCallback(() => setBuildBackfillTask(undefined), []);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      const command = event.metaKey || event.ctrlKey;
      if (command && event.key.toLocaleLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen((current) => !current);
        return;
      }
      if (command && event.key.toLocaleLowerCase() === "j") {
        event.preventDefault();
        setDockOpen((current) => !current);
        return;
      }
      if (command && event.key.toLocaleLowerCase() === "p") {
        event.preventDefault();
        setEnvironmentOpen((current) => !current);
        return;
      }
      if (command && event.key.toLocaleLowerCase() === "l") {
        event.preventDefault();
        setMode(theme === "dark" ? "light" : "dark");
        return;
      }
      if (command && /^[1-5]$/.test(event.key)) {
        event.preventDefault();
        const groupKey = workspaceShortcutGroups[event.key];
        if (groupKey !== undefined) navigate(workspaceGroups[groupKey].items[0]!.route);
        return;
      }
      if (event.key === "Escape") {
        setCommandOpen(false);
        setEnvironmentOpen(false);
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [navigate, theme]);

  useEffect(() => {
    if (!environmentOpen) return;
    const close = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".lf-env-anchor") !== null) return;
      setEnvironmentOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [environmentOpen]);

  useEffect(() => {
    if (status.error !== undefined) notifyError(status.error, "代理运行失败");
  }, [notifyError, status.error]);

  useEffect(() => {
    let mounted = true;
    const initialSnapshot = updateStateSynchronizer.beginSnapshot();
    const unsubscribe = window.forwarder.onUpdateState((nextState) => {
      if (mounted) updateStateSynchronizer.receiveEvent(nextState);
    });
    void Promise.all([window.forwarder.getAppVersion(), window.forwarder.getUpdateState()]).then(([version, nextState]) => {
      if (!mounted) return;
      setAppVersion(version);
      updateStateSynchronizer.receiveSnapshot(initialSnapshot, nextState);
    }).catch((cause) => {
      if (mounted) notifyError(cause, "无法加载更新状态");
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [notifyError]);

  useEffect(() => {
    const requestId = manualCheckTracker.current();
    if (requestId === undefined) return;
    if (!manualCheckTracker.canResolve(requestId, updateStateSynchronizer.getRevision(), updateState.state)) return;
    const resolution = resolveManualCheckResult(manualCheckTracker.hasPending(), updateState.state);
    if (resolution.pending) return;
    if (manualCheckTracker.complete(requestId) && resolution.notifyLatest) notify({ kind: "success", message: "当前已是最新版本" });
  }, [notify, updateState.state]);

  useEffect(() => {
    if (updateState.state === "downloading") return;
    setHiddenDownloadVersion(undefined);
    setUpdateDismissPrompt(false);
  }, [updateState.state]);

  const checkForUpdates = async () => {
    setDismissedUpdateVersion(undefined);
    setHiddenDownloadVersion(undefined);
    setUpdateDismissPrompt(false);
    const checkSnapshot = updateStateSynchronizer.beginSnapshot();
    const requestId = manualCheckTracker.begin(checkSnapshot.eventRevision, updateStateSynchronizer.getState().state);
    try {
      const result = await window.forwarder.checkForUpdates();
      if (!manualCheckTracker.isCurrent(requestId)) return;
      if (!result.ok) {
        manualCheckTracker.complete(requestId);
        notifyError(result.error ?? "检查更新失败", "检查更新失败");
        return;
      }
      const nextState = await window.forwarder.getUpdateState();
      updateStateSynchronizer.receiveSnapshot(checkSnapshot, nextState);
      if (!manualCheckTracker.isCurrent(requestId)) return;
      const effectiveState = updateStateSynchronizer.getState();
      if (effectiveState.state === "error") {
        manualCheckTracker.complete(requestId);
        notifyError(effectiveState.error ?? "检查更新失败", "检查更新失败");
        return;
      }
      if (!manualCheckTracker.canResolve(requestId, updateStateSynchronizer.getRevision(), effectiveState.state, true)) return;
      const resolution = resolveManualCheckResult(manualCheckTracker.hasPending(), effectiveState.state);
      if (!resolution.pending && manualCheckTracker.complete(requestId) && resolution.notifyLatest) notify({ kind: "success", message: "当前已是最新版本" });
    } catch (cause) {
      if (manualCheckTracker.complete(requestId)) notifyError(cause, "检查更新失败");
    }
  };

  const downloadUpdate = async () => {
    try {
      const result = await window.forwarder.downloadUpdate();
      if (!result.ok) notifyError(result.error ?? "下载更新失败", "下载更新失败");
    } catch (cause) {
      notifyError(cause, "下载更新失败");
    }
  };

  const installUpdate = async () => {
    try {
      const result = await window.forwarder.installUpdate();
      if (!result.ok) notifyError(result.error ?? "安装更新失败", "安装更新失败");
      else if (updateState.installMode === "manual") notify({ kind: "success", message: "安装包已打开，请手动完成更新" });
    } catch (cause) {
      notifyError(cause, "安装更新失败");
    }
  };

  const dismissUpdate = () => {
    const version = updateState.update?.version;
    if (version === undefined) return;
    if (updateState.state === "downloading") {
      setUpdateDismissPrompt(true);
      return;
    }
    setDismissedUpdateVersion(version);
    writeDismissedUpdateVersion(getUpdateDismissalStorage(), version);
  };

  const continueUpdateDownload = () => setUpdateDismissPrompt(false);

  const hideUpdateDuringDownload = () => {
    const version = updateState.update?.version;
    if (version === undefined) return;
    setHiddenDownloadVersion(version);
    setUpdateDismissPrompt(false);
  };

  const stopUpdateDownload = async () => {
    if (updateCancelBusy) return;
    setUpdateCancelBusy(true);
    try {
      const result = await window.forwarder.cancelUpdate();
      if (!result.ok) {
        notifyError(result.error ?? "停止更新失败", "停止更新失败");
        return;
      }
      setHiddenDownloadVersion(undefined);
      setUpdateDismissPrompt(false);
      notify({ kind: "success", message: "已停止下载更新" });
    } catch (cause) {
      notifyError(cause, "停止更新失败");
    } finally {
      setUpdateCancelBusy(false);
    }
  };

  const refresh = async () => {
    try {
      const [nextInstances, nextConfig, nextLoginCache, nextStatus] = await Promise.all([window.forwarder.listProxyInstances(), window.forwarder.getConfig(), window.forwarder.getLoginCache(), window.forwarder.status()]);
      setInstances(nextInstances);
      setConfig(nextConfig);
      setLoginCache(nextLoginCache);
      setStatus(nextStatus);
      await readLogs();
    } catch (cause) {
      notifyError(cause, "无法加载运行状态");
    }
  };

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      void window.forwarder.listProxyInstances().then(setInstances).catch(() => undefined);
      void window.forwarder.getLoginCache().then(setLoginCache).catch(() => undefined);
      void window.forwarder.status().then(setStatus).catch(() => undefined);
      void readLogs().catch(() => undefined);
    }, 2000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (loginSuccessNotice === undefined) return;
    const timer = window.setTimeout(() => {
      setLoginSuccessNotice((current) => current?.id === loginSuccessNotice.id ? undefined : current);
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [loginSuccessNotice]);

  const save = async (nextConfig: AppConfig) => {
    setSaveState("saving");
    const result = await window.forwarder.saveConfig(nextConfig);
    if (!result.ok) {
      setSaveState("error");
      notifyError(result.error ?? "配置保存失败", "配置保存失败");
      return false;
    }
    setConfig(nextConfig);
    setSaveState("saved");
    return true;
  };

  const saveLoginCache = async (values: Record<string, string>) => {
    setSaveState("saving");
    const result = await window.forwarder.saveLoginCache(values);
    if (!result.ok) {
      setSaveState("error");
      notifyError(result.error ?? "登录缓存保存失败", "登录缓存保存失败");
      return false;
    }
    setLoginCache(values);
    setInstances(await window.forwarder.listProxyInstances());
    setSaveState("saved");
    return true;
  };

  const chooseProjectDirectory = async () => {
    const result = await window.forwarder.selectProjectDirectory();
    if (result.canceled) return false;
    if (!result.ok || result.path === undefined) {
      notifyError(result.error ?? "选择项目目录失败", "选择项目目录失败");
      return false;
    }
    return save({ ...config, projectPath: result.path });
  };

  const selectProxyInstance = async (id: string) => {
    const result = await window.forwarder.selectProxyInstance(id);
    if (!result.ok) {
      notifyError(result.error ?? "代理实例切换失败", "代理实例切换失败");
      return;
    }
    await refresh();
  };

  const createProxyInstance = async () => {
    const result = await window.forwarder.createProxyInstance();
    if (!result.ok) {
      notifyError(result.error ?? "新增代理实例失败", "新增代理实例失败");
      return;
    }
    await refresh();
  };

  const duplicateProxyInstance = async () => {
    const result = await window.forwarder.duplicateProxyInstance();
    if (!result.ok) {
      notifyError(result.error ?? "复制代理实例失败", "复制代理实例失败");
      return;
    }
    await refresh();
  };

  const renameProxyInstance = async (id: string, name: string): Promise<boolean> => {
    const result = await window.forwarder.renameProxyInstance(id, name);
    if (!result.ok) {
      notifyError(result.error ?? "代理名称保存失败", "代理名称保存失败");
      return false;
    }
    setInstances(await window.forwarder.listProxyInstances());
    return true;
  };

  const deleteProxyInstance = async (id: string): Promise<boolean> => {
    const result = await window.forwarder.deleteProxyInstance(id);
    if (!result.ok) {
      notifyError(result.error ?? "删除代理实例失败", "删除代理实例失败");
      return false;
    }
    await refresh();
    return true;
  };

  const toggleProxyInstance = async (instance: ProxyInstanceSummary) => {
    if (instance.status.state === "starting" || instance.status.state === "stopping") return;
    try {
      if (instance.status.state === "running") await window.forwarder.stop(instance.id);
      else await window.forwarder.start(instance.id);
      await refresh();
    } catch (cause) {
      notifyError(cause, "代理状态切换失败");
      await refresh();
    }
  };

  const startAll = async () => {
    setBulkRuntimeAction("start");
    try {
      const result = await window.forwarder.startAll();
      if (!result.ok) notifyError(result.error ?? "一键开启失败", "一键开启失败");
      await refresh();
    } finally {
      setBulkRuntimeAction(undefined);
    }
  };

  const stopAll = async () => {
    setBulkRuntimeAction("stop");
    try {
      const result = await window.forwarder.stopAll();
      if (!result.ok) notifyError(result.error ?? "一键关闭失败", "一键关闭失败");
      await refresh();
    } finally {
      setBulkRuntimeAction(undefined);
    }
  };

  const clearLogs = async (): Promise<boolean> => {
    try {
      const result = await window.forwarder.clearLogs();
      if (!result.ok) {
        notifyError(result.error ?? "日志清空失败", "日志清空失败");
        return false;
      }
      logReaderRef.current?.invalidate();
      setLogs([]);
      return true;
    } catch (cause) {
      notifyError(cause, "日志清空失败");
      return false;
    }
  };

  const fillJsonPreview = (text: string) => {
    setJsonPrefill(responseTextToJsonPreview(text));
    setDockOpen(false);
    navigate("json");
  };

  const sendRequest = async (request: ManualRequestConfig): Promise<ManualRequestResponse> => {
    const result = await window.forwarder.sendRequest(request);
    if (!result.ok) notifyError(result.error ?? "请求失败", "请求失败");
    else {
      await refresh();
      if (result.loginSuccess) {
        try {
          const values = await window.forwarder.getLoginCache();
          setLoginCache(values);
          const id = ++loginNoticeIdRef.current;
          setLoginSuccessNotice({ id, values });
        } catch (cause) {
          notifyError(cause, "登录缓存读取失败");
        }
      }
    }
    return result;
  };

  const openLoginCache = () => {
    setLoginSuccessNotice(undefined);
    navigate("session");
  };

  const selectedInstance = instances.find((instance) => instance.selected) ?? instances[0];
  const activeGroupKey = workspaceRouteMeta[route].group;
  const activeGroup = workspaceGroups[activeGroupKey];
  const isDataRoute = route === "session" || route === "kv" || route === "files" || route === "variables";
  const dataTab = route === "session" || route === "kv" || route === "files" || route === "variables" ? route : "session";
  const badges = useMemo<Partial<Record<WorkspaceRoute, number>>>(() => ({
    activity: logs.length,
    logs: logs.length,
    session: Object.keys(loginCache).length,
  }), [instances.length, loginCache, logs.length]);
  const inspectLog = (entry: LogEntry) => {
    setSelectedLog(entry);
    setDockTab("request");
    setDockOpen(true);
  };
  const exportConfig = () => {
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `local-forwarder-config-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    notify({ kind: "success", message: "配置已导出" });
  };
  const commands: WorkspaceCommand[] = [
    ...Object.values(workspaceGroups).flatMap((group) => group.items.map((item, index) => ({
      id: `route-${item.route}`,
      label: item.label,
      detail: group.subtitle,
      group: group.label,
      shortcut: index === 0 ? workspaceGroupShortcuts[group.key] : undefined,
      run: () => navigate(item.route),
    }))),
    ...instances.map((instance) => ({
      id: `environment-${instance.id}`,
      label: `切换到 ${instance.name}`,
      detail: `${instance.bindHost}:${instance.port} · ${instance.target}`,
      group: "环境",
      run: () => { void selectProxyInstance(instance.id); },
    })),
    { id: "start-all", label: "启动全部环境", detail: "启动所有已停止的代理实例", group: "操作", run: () => { void startAll(); } },
    { id: "stop-all", label: "停止全部环境", detail: "停止当前所有运行中的代理实例", group: "操作", run: () => { void stopAll(); } },
    { id: "toggle-dock", label: "切换日志控制台", detail: "显示或收起底部日志、缓存与请求详情", group: "操作", shortcut: "⌘J", run: () => setDockOpen((current) => !current) },
    { id: "check-update", label: "检查更新", detail: "立即查询是否有可用版本", group: "设置", run: () => { void checkForUpdates(); } },
    { id: "toggle-theme", label: theme === "dark" ? "切换到浅色外观" : "切换到深色外观", detail: "立即切换工作台配色", group: "设置", shortcut: "⌘L", run: () => setMode(theme === "dark" ? "light" : "dark") },
  ];
  const createBuildTask = (task: BuildTask) => setBuildTasks((current) => [task, ...current].slice(0, 50));
  const updateBuildTask = (id: string, patch: Partial<BuildTask>) => setBuildTasks((current) => current.map((task) => task.id === id ? { ...task, ...patch } : task));

  return <main className="app-shell lf-app" data-theme={theme}>
    <WorkspaceTitlebar
      instances={instances}
      selectedInstance={selectedInstance}
      fallbackStatus={status}
      loginCache={loginCache}
      theme={theme}
      appVersion={appVersion}
      saveState={saveState}
      updateState={updateState}
      environmentOpen={environmentOpen}
      onToggleEnvironment={() => setEnvironmentOpen((current) => !current)}
      onCloseEnvironment={() => setEnvironmentOpen(false)}
      onSelectInstance={(id) => { void selectProxyInstance(id); }}
      onToggleInstance={(instance) => { void toggleProxyInstance(instance); }}
      onDuplicateCurrent={() => { void duplicateProxyInstance(); }}
      onOpenCommand={() => setCommandOpen(true)}
      onCheckForUpdates={() => { void checkForUpdates(); }}
      onToggleTheme={() => setMode(theme === "dark" ? "light" : "dark")}
      onOpenAccount={() => navigate("session")}
    />
    <div className="lf-shell-body">
      <WorkspaceRail activeGroup={activeGroupKey} onSelectGroup={(groupKey: WorkspaceGroupKey) => navigate(workspaceGroups[groupKey].items[0]!.route)} />
      <WorkspaceContext group={activeGroup} activeRoute={route} badges={badges} loginCache={loginCache} selectedInstance={selectedInstance} onNavigate={navigate} onOpenSession={() => navigate("session")} />
      <div className={`lf-workspace ${dockOpen ? "dock-open" : ""}`}>
        <main className="lf-main">
          <PagePane active={route === "workbench"}>
            <WorkbenchPage instances={instances} selectedInstance={selectedInstance} status={status} config={config} loginCache={loginCache} logs={logs} bulkBusy={bulkRuntimeAction !== undefined} onNavigate={navigate} onSelectInstance={(id) => { void selectProxyInstance(id); }} onToggleInstance={(instance) => { void toggleProxyInstance(instance); }} onCreate={() => { void createProxyInstance(); }} onDuplicate={() => { void duplicateProxyInstance(); }} onDelete={(id) => { void deleteProxyInstance(id); }} onStartAll={() => { void startAll(); }} onStopAll={() => { void stopAll(); }} onOpenDock={() => setDockOpen(true)} onChange={save} onChooseProjectDirectory={chooseProjectDirectory} onRename={renameProxyInstance} />
          </PagePane>

          <PagePane active={route === "activity"}>
            <ActivityPage logs={logs} instanceName={selectedInstance?.name ?? "当前环境"} onClear={clearLogs} onInspect={inspectLog} onFillJson={fillJsonPreview} />
          </PagePane>

          <PagePane active={route === "debug"}>
            <section className="lf-view-body lf-debug-view">
              <WorkspacePageHeader eyebrow="Runtime · Request" title="请求调试" badge={<span className="lf-scope-pill"><span className={`lf-status-dot ${selectedInstance?.status.state === "running" ? "running" : "stopped"}`} />当前环境 <strong>{selectedInstance?.name ?? "—"}</strong></span>} description="目标由当前环境提供，支持 TZT TCP 与 HTTP /reqxml；应答和日志在同一个工作区内查看。" />
              <RequestPage config={config} active={route === "debug"} onChange={save} onSendRequest={sendRequest} onFillJson={fillJsonPreview} onOpenSession={() => navigate("session")} />
            </section>
          </PagePane>

          <PagePane active={isDataRoute}>
            <DataBrowserPage tab={dataTab} selectedInstance={selectedInstance} sessionValues={loginCache} onSaveSession={saveLoginCache} onNavigate={navigate} />
          </PagePane>

          <PagePane active={route === "build"}>
            <BuildPage onCreateTask={createBuildTask} onUpdateTask={updateBuildTask} onOpenJobs={() => navigate("jobs")} backfillTask={buildBackfillTask} onBackfillApplied={clearBuildBackfillTask} />
          </PagePane>

          <PagePane active={route === "jobs"}>
            <BuildJobsPage tasks={buildTasks} onOpenBuild={() => navigate("build")} onBackfillTask={backfillBuildTask} onNotify={(message) => notify({ kind: "success", message })} />
          </PagePane>

          <PagePane active={route === "json" || route === "logs" || route === "string"}>
            <section className="lf-view-body">
              <WorkspacePageHeader eyebrow={`Tools · ${route === "json" ? "JSON" : route === "logs" ? "Logs" : "String"}`} title="工具" description={route === "logs" ? "查看当前环境的请求、转发与系统事件；带应答的记录可直接带入 JSON 可视化。" : "轻量处理与格式转换。工具页签保留当前输入，切换分类不会丢失内容。"} />
              <div className="lf-tab-bar" role="tablist" aria-label="工具类别">{workspaceGroups.tools.items.map((item) => <button className={route === item.route ? "active" : ""} type="button" role="tab" aria-selected={route === item.route} key={item.route} onClick={() => navigate(item.route)}><WorkspaceIcon name={item.icon} className="lf-icon lf-icon-sm" />{item.label}</button>)}</div>
              <KeepAlivePane active={route === "json"}><JsonPreviewPage prefillText={jsonPrefill} onPrefillApplied={() => setJsonPrefill(undefined)} /></KeepAlivePane>
              <KeepAlivePane active={route === "logs"}><LogPanel logs={logs} selected={selectedLog} onSelect={setSelectedLog} onClear={clearLogs} onFillJson={fillJsonPreview} /></KeepAlivePane>
              <KeepAlivePane active={route === "string"}><StringToolPage config={config} /></KeepAlivePane>
            </section>
          </PagePane>

          <PagePane active={route === "appearance"}>
            <section className="lf-view-body">
              <WorkspacePageHeader eyebrow="Settings · Appearance" title="外观" description="主题跟随系统或手动切换，界面密度保持工作台级信息量。所有主题都使用原型中的绿色交互色。" />
              <AppearancePage mode={mode} theme={theme} onModeChange={setMode} />
            </section>
          </PagePane>

          <PagePane active={route === "update"}>
            <UpdateSettingsPage appVersion={appVersion || updateState.currentVersion} updateState={updateState} onCheck={() => { void checkForUpdates(); }} onDownload={() => { void downloadUpdate(); }} onInstall={() => { void installUpdate(); }} onCancel={() => { void stopUpdateDownload(); }} />
          </PagePane>

          <PagePane active={route === "advanced"}>
            <AdvancedSettingsPage config={config} version={appVersion || updateState.currentVersion} onExportConfig={exportConfig} onNotify={(message) => notify({ kind: "success", message })} />
          </PagePane>
        </main>
        {dockOpen && <WorkspaceDock logs={logs} selected={selectedLog} tab={dockTab} onTabChange={setDockTab} onSelectLog={setSelectedLog} onClear={() => { void clearLogs(); }} onClose={() => setDockOpen(false)} onFillJson={fillJsonPreview} />}
      </div>
    </div>
    <WorkspaceStatusbar selectedInstance={selectedInstance} fallbackStatus={status} logCount={logs.length} version={appVersion || updateState.currentVersion} dockOpen={dockOpen} onToggleDock={() => setDockOpen((current) => !current)} />
    <CommandPalette open={commandOpen} commands={commands} onClose={() => setCommandOpen(false)} />
    {loginSuccessNotice !== undefined && <LoginSuccessCard notice={loginSuccessNotice} onClose={() => setLoginSuccessNotice(undefined)} onOpenCache={openLoginCache} />}
    <UpdateCard state={updateState} dismissedVersion={dismissedUpdateVersion} hiddenDuringDownloadVersion={hiddenDownloadVersion} onDownload={downloadUpdate} onInstall={installUpdate} onDismiss={dismissUpdate} />
    {updateDismissPrompt && updateState.state === "downloading" && <UpdateCancelDialog version={updateState.update?.version} busy={updateCancelBusy} onContinue={continueUpdateDownload} onHide={hideUpdateDuringDownload} onStop={stopUpdateDownload} />}
  </main>;
}

function App() {
  return <ToastProvider><AppContent /></ToastProvider>;
}

export default App;
