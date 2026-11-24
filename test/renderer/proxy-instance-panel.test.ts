import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type { ProxyInstanceSummary, RuntimeState } from "../../src/shared/contracts";
import { orderProxyInstancesForDisplay } from "../../src/renderer/components/ProxyInstanceSidebar";
import { workspaceGroups } from "../../src/renderer/workspace-navigation";

function proxySummary(id: string, state: ProxyInstanceSummary["status"]["state"]): ProxyInstanceSummary {
  return {
    id,
    name: id,
    selected: false,
    bindHost: "127.0.0.1",
    port: 8080,
    target: "127.0.0.1:8080",
    loginCacheCount: 0,
    status: { state, requestCount: 0, tcpConnections: 0 },
  };
}

type WorkbenchProxyAction = {
  label: string;
  icon: "play" | "stop" | "refresh";
  busy: boolean;
  active: boolean;
};

type ProxyToggleActionForState = (state: RuntimeState) => WorkbenchProxyAction;

async function loadProxyToggleActionForState(): Promise<ProxyToggleActionForState> {
  const module = await import("../../src/renderer/components/WorkspacePages") as unknown as { proxyToggleActionForState?: unknown };
  assert.equal(typeof module.proxyToggleActionForState, "function");
  return module.proxyToggleActionForState as ProxyToggleActionForState;
}

test("proxy sidebar moves started proxies above stopped ones while preserving manual order", () => {
  const instances = [
    proxySummary("stopped-a", "stopped"),
    proxySummary("running-b", "running"),
    proxySummary("stopped-c", "stopped"),
    proxySummary("starting-d", "starting"),
  ];

  assert.deepEqual(
    orderProxyInstancesForDisplay(instances, instances.map((instance) => instance.id)).map((instance) => instance.id),
    ["running-b", "starting-d", "stopped-a", "stopped-c"],
  );
});

test("proxy sidebar keeps the manual order when every proxy is running", () => {
  const instances = [
    proxySummary("running-a", "running"),
    proxySummary("starting-b", "starting"),
    proxySummary("starting-c", "starting"),
  ];

  assert.deepEqual(
    orderProxyInstancesForDisplay(instances, ["running-a", "starting-b", "starting-c"]).map((instance) => instance.id),
    ["running-a", "starting-b", "starting-c"],
  );
});

test("workbench renders proxy instance management actions", async () => {
  const environment = await readFile("src/renderer/components/WorkspacePages.tsx", "utf8");
  const app = await readFile("src/renderer/App.tsx", "utf8");
  const styles = await readFile("src/renderer/styles.css", "utf8");
  assert.match(environment, /className="lf-panel lf-workbench-config"/);
  assert.match(environment, /onCreate/);
  assert.match(environment, /onDuplicate/);
  assert.match(environment, /onDelete/);
  assert.match(app, /listProxyInstances/);
  assert.match(app, /selectProxyInstance/);
  assert.match(app, /createProxyInstance/);
  assert.match(app, /duplicateProxyInstance/);
  assert.doesNotMatch(app, /<EnvironmentPage/);
  assert.doesNotMatch(environment, /ProxyInstancePanel|当前环境配置|Environment details/);
  assert.match(environment, /className="lf-mini-action danger"[\s\S]*name="trash"/);
  assert.match(styles, /\.lf-mini-action\s*\{[^}]*place-items:\s*center[^}]*padding:\s*0[^}]*line-height:\s*0/);
  assert.match(styles, /\.lf-mini-action > \.lf-icon\s*\{[^}]*display:\s*block/);
});

test("workbench places the project and listener controls above metrics", async () => {
  const page = await readFile("src/renderer/components/WorkspacePages.tsx", "utf8");
  const workbench = page.match(/export function WorkbenchPage[\s\S]*?export interface ActivityPageProps/)?.[0] ?? "";
  assert.match(page, /项目目录/);
  assert.match(page, /选择项目目录/);
  assert.match(page, /监听主机/);
  assert.match(page, /监听端口/);
  assert.match(page, /超时时间（毫秒）/);
  assert.match(page, /onChange/);
  assert.match(page, /lf-project-bar/);
  assert.match(page, /proxy-instance-overview-field/);
  assert.match(page, /proxy-instance-overview-fields/);
  assert.ok(page.indexOf("lf-workbench-config") < page.indexOf("lf-forwarding-settings"));
  assert.ok(page.indexOf("lf-forwarding-settings") < page.indexOf("lf-metrics"));
  assert.doesNotMatch(page, /当前环境配置|Environment details/);
  assert.doesNotMatch(workbench, /未配置|已启用/);
});

test("workbench proxy toggle reflects the selected proxy runtime state", async () => {
  const proxyToggleActionForState = await loadProxyToggleActionForState();

  assert.deepEqual(proxyToggleActionForState("running"), { label: "停止代理", icon: "stop", busy: false, active: true });
  assert.deepEqual(proxyToggleActionForState("stopped"), { label: "打开代理", icon: "play", busy: false, active: false });
  assert.deepEqual(proxyToggleActionForState("error"), { label: "打开代理", icon: "play", busy: false, active: false });
  assert.deepEqual(proxyToggleActionForState("starting"), { label: "启动中…", icon: "refresh", busy: true, active: false });
  assert.deepEqual(proxyToggleActionForState("stopping"), { label: "停止中…", icon: "refresh", busy: true, active: true });
});

test("workbench header replaces send request with the selected proxy toggle", async () => {
  const pages = await readFile("src/renderer/components/WorkspacePages.tsx", "utf8");
  const workbench = pages.match(/export function WorkbenchPage[\s\S]*?export interface ActivityPageProps/)?.[0] ?? "";

  assert.match(workbench, /proxyToggleActionForState\(selectedInstance\.status\.state\)/);
  assert.match(workbench, /onToggleInstance\(selectedInstance\)/);
  assert.match(workbench, /proxyAction\?\.label/);
  assert.doesNotMatch(workbench, /发送请求/);
});

test("workbench edits the proxy name in the page title", async () => {
  const page = await readFile("src/renderer/components/WorkspacePages.tsx", "utf8");
  assert.match(page, /aria-label="编辑代理名称"/);
  assert.match(page, /className="lf-page-title-input"/);
  assert.match(page, /className="lf-page-title-context">当前代理/);
  assert.match(page, /const commitName = async \(\) =>/);
  assert.ok(page.indexOf("编辑代理名称") < page.indexOf("lf-workbench-config"));
  assert.doesNotMatch(page, /proxy-instance-overview-heading|>停止代理<|>启动代理</);
});

test("workbench locks project and listener settings while the proxy is running", async () => {
  const page = await readFile("src/renderer/components/WorkspacePages.tsx", "utf8");
  assert.match(page, /const configLocked = selectedStatus\.state !== "stopped" && selectedStatus\.state !== "error";/);
  assert.match(page, /if \(notifyConfigLocked\(\)\) return; set/);
  assert.match(page, /aria-label="项目目录"[\s\S]*?readOnly=\{configLocked\}[\s\S]*?aria-readonly=\{configLocked\}[\s\S]*?aria-disabled=\{configLocked\}/);
  assert.match(page, /<button(?=[^>]*disabled=\{configLocked\})[^>]*>[\s\S]*?选择项目目录<\/button>/);
  assert.match(page, /aria-label="监听主机"[\s\S]*?readOnly=\{configLocked\}[\s\S]*?aria-readonly=\{configLocked\}[\s\S]*?aria-disabled=\{configLocked\}/);
  assert.match(page, /aria-label="监听端口"[\s\S]*?readOnly=\{configLocked\}[\s\S]*?aria-readonly=\{configLocked\}[\s\S]*?aria-disabled=\{configLocked\}/);
  assert.match(page, /aria-label="超时时间"[\s\S]*?readOnly=\{configLocked\}[\s\S]*?aria-readonly=\{configLocked\}[\s\S]*?aria-disabled=\{configLocked\}/);
});

test("settings pages are grouped in the redesign and legacy import is removed", async () => {
  const app = await readFile("src/renderer/App.tsx", "utf8");
  assert.deepEqual(workspaceGroups.settings.items.map((item) => item.route), ["appearance", "update", "advanced"]);
  assert.match(app, /<PagePane active=\{route === "advanced"\}>/);
  assert.doesNotMatch(app, /importLegacy/);
});

test("request debugging and the unified build workspace remain available", async () => {
  const app = await readFile("src/renderer/App.tsx", "utf8");
  assert.deepEqual(workspaceGroups.run.items.map((item) => item.route), ["workbench", "debug", "activity"]);
  assert.deepEqual(workspaceGroups.build.items.map((item) => item.route), ["build", "jobs"]);
  assert.match(app, /<BuildPage onCreateTask=\{createBuildTask\}/);
  assert.match(app, /onSendRequest/);
  assert.doesNotMatch(app, /RequestHistoryPage|route === "history"|请求历史/);
});

test("overview does not repeat runtime status and configuration panels", async () => {
  const app = await readFile("src/renderer/App.tsx", "utf8");
  assert.doesNotMatch(app, /<RuntimePanel/);
  assert.doesNotMatch(app, /summary-panel/);
});

test("tabs do not render the global localhost address chip", async () => {
  const app = await readFile("src/renderer/App.tsx", "utf8");
  assert.doesNotMatch(app, /content-toolbar/);
  assert.doesNotMatch(app, /address-chip/);
});

test("environment selection lives in the titlebar and context sidebar", async () => {
  const [app, chrome, styles] = await Promise.all([
    readFile("src/renderer/App.tsx", "utf8"),
    readFile("src/renderer/components/WorkspaceChrome.tsx", "utf8"),
    readFile("src/renderer/styles.css", "utf8"),
  ]);
  assert.match(app, /<WorkspaceTitlebar/);
  assert.match(app, /<WorkspaceContext/);
  assert.match(chrome, /instances\.map/);
  assert.match(chrome, /onDuplicateCurrent/);
  assert.match(chrome, />复制当前<\/button>/);
  assert.doesNotMatch(chrome, /onManageEnvironments|管理全部环境/);
  assert.match(chrome, /instance\.target/);
  assert.match(styles, /\.lf-shell-body\s*\{[^}]*grid-template-columns:/);
  assert.match(styles, /\.lf-context-nav\s*\{[^}]*overflow-y:\s*auto/);
});

test("titlebar environment list keeps port-only labels and inline runtime toggles", async () => {
  const [app, chrome, styles] = await Promise.all([
    readFile("src/renderer/App.tsx", "utf8"),
    readFile("src/renderer/components/WorkspaceChrome.tsx", "utf8"),
    readFile("src/renderer/styles.css", "utf8"),
  ]);
  assert.match(app, /onToggleInstance=\{\(instance\) => \{ void toggleProxyInstance\(instance\); \}\}/);
  assert.match(chrome, /onToggleInstance: \(instance: ProxyInstanceSummary\) => void/);
  assert.match(chrome, /`:\$\{selectedInstance\.port\}`/);
  assert.match(chrome, /<code>:\{instance\.port\}<\/code>/);
  assert.doesNotMatch(chrome, /instance\.bindHost/);
  assert.match(chrome, /className=\{`lf-env-toggle/);
  assert.match(chrome, /name=\{busy \? "refresh" : running \? "stop" : "play"\}/);
  assert.match(styles, /\.lf-env-popover\s*\{[^}]*width:\s*274px/);
  assert.match(styles, /\.lf-env-toggle\s*\{[^}]*width:\s*28px/);
});

test("workbench proxy list reuses the runtime toggle, removes the status column, and supports deletion", async () => {
  const [pages, chrome, styles] = await Promise.all([
    readFile("src/renderer/components/WorkspacePages.tsx", "utf8"),
    readFile("src/renderer/components/WorkspaceChrome.tsx", "utf8"),
    readFile("src/renderer/styles.css", "utf8"),
  ]);
  const workbench = pages.match(/export function WorkbenchPage[\s\S]*?export interface ActivityPageProps/)?.[0] ?? "";

  assert.match(chrome, /export function InstanceToggleButton/);
  assert.match(chrome, /event\.stopPropagation\(\); onToggle\(instance\);/);
  assert.match(workbench, /orderProxyInstancesForDisplay\(instances, instances\.map\(\(instance\) => instance\.id\)\)/);
  assert.match(workbench, /filteredInstances\.map/);
  assert.match(workbench, /<th className="lf-wb-port">端口<\/th>/);
  assert.match(workbench, /<td className="lf-cell-mono lf-wb-port">:\{instance\.port\}<\/td>/);
  assert.doesNotMatch(workbench, /<td className="lf-cell-mono lf-wb-port">\{instance\.bindHost\}/);
  assert.doesNotMatch(workbench, /lf-wb-col-status|lf-wb-status|>状态<\/th>/);
  assert.match(workbench, /<th className="lf-wb-actions">操作<\/th>/);
  assert.match(workbench, /<td className="lf-cell-actions" onClick=\{\(event\) => event\.stopPropagation\(\)\}><div className="lf-row-actions"><InstanceToggleButton instance=\{instance\} onToggle=\{onToggleInstance\} \/><button className="lf-mini-action danger"[^>]*title="删除代理"/);
  assert.match(workbench, /<colgroup><col className="lf-wb-col-env" \/><col className="lf-wb-col-port" \/><col className="lf-wb-col-upstream" \/><col className="lf-wb-col-requests" \/><col className="lf-wb-col-login" \/><col className="lf-wb-col-actions" \/><\/colgroup>/);
  assert.match(workbench, /<th className="lf-wb-requests">请求<\/th>/);
  assert.match(styles, /\.lf-workbench-table \.lf-wb-col-env\s*\{[^}]*width:\s*23%/);
  assert.match(styles, /\.lf-workbench-table \.lf-wb-col-port\s*\{[^}]*width:\s*60px/);
  assert.match(styles, /\.lf-workbench-table \.lf-wb-col-requests\s*\{[^}]*width:\s*56px/);
  assert.match(styles, /\.lf-workbench-table \.lf-wb-col-login\s*\{[^}]*width:\s*56px/);
  assert.match(styles, /\.lf-workbench-table \.lf-wb-col-actions\s*\{[^}]*width:\s*82px/);
  assert.match(styles, /\.lf-workbench-table th\.lf-wb-port,[\s\S]*?\.lf-workbench-table td\.lf-wb-port[\s\S]*?text-align:\s*center/);
  assert.match(styles, /\.lf-workbench-table th\.lf-wb-actions,[\s\S]*?\.lf-workbench-table td\.lf-cell-actions\s*\{[^}]*text-align:\s*right/);
  assert.match(styles, /\.lf-workbench-table\s*\{[^}]*table-layout:\s*fixed/);
  assert.match(styles, /\.lf-workbench-table-wrap\s*\{[^}]*overflow-x:\s*clip/);
});

test("titlebar and workbench sort active proxy instances first", async () => {
  const [pages, chrome] = await Promise.all([
    readFile("src/renderer/components/WorkspacePages.tsx", "utf8"),
    readFile("src/renderer/components/WorkspaceChrome.tsx", "utf8"),
  ]);

  assert.match(chrome, /import \{ orderProxyInstancesForDisplay \} from "\.\/ProxyInstanceSidebar"/);
  assert.match(chrome, /const orderedInstances = useMemo\(\s*\(\) => orderProxyInstancesForDisplay\(instances, instances\.map\(\(instance\) => instance\.id\)\),\s*\[instances\],\s*\)/);
  assert.match(chrome, /<div className="lf-env-list"[\s\S]*?\{orderedInstances\.map\(\(instance\) =>/);
  assert.match(pages, /export function WorkbenchPage[\s\S]*?const orderedInstances = useMemo\(\(\) => orderProxyInstancesForDisplay\(instances, instances\.map\(\(instance\) => instance\.id\)\), \[instances\]\);/);
  assert.match(pages, /const filteredInstances = useMemo\(\(\) => orderedInstances\.filter\(\(instance\) =>/);
});

test("workbench proxy table selects from the row and keeps actions separate", async () => {
  const [pages, styles] = await Promise.all([
    readFile("src/renderer/components/WorkspacePages.tsx", "utf8"),
    readFile("src/renderer/styles.css", "utf8"),
  ]);
  const workbench = pages.match(/export function WorkbenchPage[\s\S]*?export interface ActivityPageProps/)?.[0] ?? "";

  assert.match(workbench, /<tr className=\{instance\.selected \? "selected" : ""\} key=\{instance\.id\} onClick=\{\(\) => onSelectInstance\(instance\.id\)\}>/);
  assert.match(workbench, /<InstanceToggleButton instance=\{instance\} onToggle=\{onToggleInstance\} \/>/);
  assert.match(workbench, /<td className="lf-cell-actions" onClick=\{\(event\) => event\.stopPropagation\(\)\}>/);
  assert.doesNotMatch(workbench, />设为当前</);
  assert.doesNotMatch(workbench, /instance\.status\.state === "running" \? "停止" : "启动"/);
  assert.match(styles, /\.lf-row-actions \.lf-env-toggle\s*\{[^}]*margin-right:\s*0/);
});

test("titlebar brand shows the Chinese product label with the runtime version", async () => {
  const [app, chrome, styles] = await Promise.all([
    readFile("src/renderer/App.tsx", "utf8"),
    readFile("src/renderer/components/WorkspaceChrome.tsx", "utf8"),
    readFile("src/renderer/styles.css", "utf8"),
  ]);
  assert.match(app, /appVersion=\{appVersion\}/);
  assert.match(chrome, /appVersion: string/);
  assert.match(chrome, /const versionLabel = appVersion \|\| updateState\.currentVersion/);
  assert.match(chrome, /中焯代理 <b className="lf-brand-version">v\{versionLabel \|\| "—"\}<\/b>/);
  assert.match(styles, /\.lf-brand-version\s*\{[^}]*color:\s*var\(--accent\)/);
});

test("sidebar does not show the application brand block", async () => {
  const app = await readFile("src/renderer/App.tsx", "utf8");
  assert.doesNotMatch(app, /本地转发工具/);
  assert.doesNotMatch(app, /英特尔苹果电脑服务/);
  assert.doesNotMatch(app, /brand-mark/);
});

test("proxy sidebar keeps status beside the name without showing the jy address", async () => {
  const sidebar = await readFile("src/renderer/components/ProxyInstanceSidebar.tsx", "utf8");
  assert.match(sidebar, /proxy-instance-sidebar-status/);
  assert.match(sidebar, /statusText\(instance\)/);
  assert.doesNotMatch(sidebar, /jy 上游地址/);
  assert.match(sidebar, /instance\.target/);
  assert.doesNotMatch(sidebar, /编辑代理名称/);
});

test("proxy sidebar keeps status after the name and pins the port to the right", async () => {
  const sidebar = await readFile("src/renderer/components/ProxyInstanceSidebar.tsx", "utf8");
  const styles = await readFile("src/renderer/styles.css", "utf8");
  const title = sidebar.match(/<span className="proxy-instance-sidebar-title">[\s\S]*?<code>:\{instance\.port\}<\/code><\/span>/)?.[0];
  assert.ok(title);
  assert.match(title, /proxy-instance-sidebar-name/);
  assert.match(title, /proxy-instance-sidebar-status/);
  assert.match(title, /instance\.port/);
  assert.ok(title.indexOf("proxy-instance-sidebar-name") < title.indexOf("proxy-instance-sidebar-status"));
  assert.ok(title.indexOf("proxy-instance-sidebar-status") < title.indexOf("instance.port"));
  assert.match(styles, /\.proxy-instance-sidebar-title > \.status-dot\s*\{[^}]*flex:\s*0 0 8px/);
  assert.match(styles, /\.proxy-instance-sidebar-title code[^}]*flex:\s*0 0 auto/);
  assert.match(styles, /\.proxy-instance-sidebar-title code[^}]*min-width:\s*44px/);
  assert.match(styles, /\.proxy-instance-sidebar-title code[^}]*text-align:\s*right/);
});

test("proxy sidebar leaves room for the port to stay at the far right", async () => {
  const styles = await readFile("src/renderer/styles.css", "utf8");
  assert.match(styles, /\.proxy-instance-sidebar-name[^}]*flex:\s*0 1 auto/);
});

test("proxy sidebar supports editing names and bulk runtime actions", async () => {
  const [app, pages, sidebar, styles] = await Promise.all([
    readFile("src/renderer/App.tsx", "utf8"),
    readFile("src/renderer/components/WorkspacePages.tsx", "utf8"),
    readFile("src/renderer/components/ProxyInstanceSidebar.tsx", "utf8"),
    readFile("src/renderer/styles.css", "utf8"),
  ]);
  assert.match(app, /renameProxyInstance/);
  assert.match(app, /startAll/);
  assert.match(app, /stopAll/);
  assert.match(app, /onRename={renameProxyInstance}/);
  assert.match(pages, /编辑代理名称/);
  assert.match(pages, /onRename/);
  assert.doesNotMatch(app, /onStart=\{start\}|onStop=\{stop\}/);
  assert.doesNotMatch(pages, />停止代理<|>启动代理</);
  assert.doesNotMatch(sidebar, /proxy-instance-sidebar-name-input/);
  assert.match(sidebar, /onStartAll/);
  assert.match(sidebar, /onStopAll/);
  assert.match(sidebar, /onDelete/);
  assert.match(sidebar, /删除代理/);
  assert.match(sidebar, /onContextMenu/);
  assert.match(sidebar, /复制此代理/);
  assert.match(sidebar, /context-menu/);
  assert.doesNotMatch(sidebar, /proxy-instance-sidebar-delete/);
  assert.doesNotMatch(styles, /proxy-instance-sidebar-delete/);
  assert.match(sidebar, /onToggle/);
  assert.match(sidebar, /onDoubleClick/);
  assert.match(app, /toggleProxyInstance/);
  assert.match(sidebar, /一键开启/);
  assert.match(sidebar, /一键关闭/);
  assert.doesNotMatch(sidebar, /点击代理即可切换当前工作环境/);
  assert.doesNotMatch(sidebar, />代理实例</);
  assert.match(styles, /proxy-instance-sidebar-action\.start/);
  assert.match(styles, /proxy-instance-sidebar-action\.stop/);
  assert.match(styles, /\.proxy-instance-sidebar-target code[^}]*display:\s*block/);
  assert.match(styles, /\.proxy-instance-sidebar-list[^}]*padding:\s*2px 5px 4px 2px/);
  assert.doesNotMatch(styles, /scrollbar-gutter:/);
  assert.doesNotMatch(styles, /overflow-x:\s*hidden/);
  assert.match(styles, /sidebar-nav button[^\n]*padding:\s*10px 10px/);
  assert.match(styles, /sidebar-nav button[^\n]*font-size:\s*0\.86rem/);
  assert.match(styles, /text-overflow:\s*ellipsis/);
});

test("proxy sidebar shows three cards and previews the next card", async () => {
  const styles = await readFile("src/renderer/styles.css", "utf8");
  assert.match(styles, /\.proxy-instance-sidebar-list[^}]*grid-auto-rows:\s*64px/);
  assert.match(styles, /\.proxy-instance-sidebar-list[^}]*max-height:\s*calc\(\(64px \* 3\) \+ \(8px \* 2\) \+ 6px \+ 20px\)/);
  assert.match(styles, /\.proxy-instance-sidebar-list[^}]*overflow-y:\s*auto/);
});

test("sidebar and content scroll independently within the viewport", async () => {
  const styles = await readFile("src/renderer/styles.css", "utf8");
  assert.match(styles, /\.app-shell\s*\{[^}]*height:\s*100vh;[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/);
  assert.match(styles, /\.sidebar\s*\{[^}]*height:\s*100vh;[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;/);
  assert.match(styles, /\.content\s*\{[^}]*height:\s*100vh;[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;[^}]*overscroll-behavior:\s*contain;/);
  assert.match(styles, /\.proxy-instance-sidebar-list[^}]*overflow-y:\s*auto/);
});
