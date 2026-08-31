import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("overview renders proxy instance management actions", async () => {
  const panel = await readFile("src/renderer/components/ProxyInstancePanel.tsx", "utf8");
  const app = await readFile("src/renderer/App.tsx", "utf8");
  const runtime = await readFile("src/renderer/components/RuntimePanel.tsx", "utf8");
  assert.match(app, /ProxyInstancePanel/);
  assert.match(app, /ProxyInstanceSidebar/);
  assert.match(app, /listProxyInstances/);
  assert.match(app, /selectProxyInstance/);
  assert.match(app, /createProxyInstance/);
  assert.match(app, /duplicateProxyInstance/);
  assert.doesNotMatch(panel, /复制当前代理/);
  assert.doesNotMatch(panel, /登录缓存/);
  assert.doesNotMatch(panel, /loginCacheCount/);
  assert.doesNotMatch(panel, /jy 上游地址/);
  assert.match(panel, /onStart/);
  assert.doesNotMatch(panel, /代理实例 \/ 概览/);
  assert.doesNotMatch(panel, /当前代理 ·/);
  assert.match(runtime, /代理状态/);
});

test("overview exposes project directory and editable local server settings", async () => {
  const panel = await readFile("src/renderer/components/ProxyInstancePanel.tsx", "utf8");
  assert.match(panel, /项目目录/);
  assert.match(panel, /选择项目目录/);
  assert.match(panel, /监听主机/);
  assert.match(panel, /监听端口/);
  assert.match(panel, /超时时间（毫秒）/);
  assert.match(panel, /onChange/);
  assert.match(panel, /proxy-instance-project-card/);
  assert.match(panel, /proxy-instance-overview-field/);
  assert.match(panel, /proxy-instance-overview-fields/);
  assert.doesNotMatch(panel, /当前代理使用的 H5 项目路径/);
  assert.doesNotMatch(panel, /<strong>项目目录<\/strong>/);
  assert.doesNotMatch(panel, /当前实例专属/);
  assert.doesNotMatch(panel, /aria-label="编辑 jy 上游地址"/);
});

test("overview places the proxy name and status above the project directory", async () => {
  const panel = await readFile("src/renderer/components/ProxyInstancePanel.tsx", "utf8");
  assert.ok(panel.indexOf("proxy-instance-overview-heading") < panel.indexOf("proxy-instance-project-card"));
  assert.ok(panel.indexOf("status-pill") < panel.indexOf("编辑代理名称"));
  assert.doesNotMatch(panel, /proxy-instance-overview-footer/);
  assert.match(panel, /proxy-instance-overview-heading[\s\S]*proxy-instance-actions/);
  assert.match(panel, /status\.state === "running" \? "停止代理" : "启动代理"/);
  assert.doesNotMatch(panel, /切换左侧代理后，右侧内容会跟随当前选中实例更新/);
});

test("overview disables editable data while the proxy is running", async () => {
  const panel = await readFile("src/renderer/components/ProxyInstancePanel.tsx", "utf8");
  assert.match(panel, /<input(?=[^>]*aria-label="编辑代理名称")(?=[^>]*disabled=\{running \|\| busy\})[^>]*>/);
  assert.match(panel, /<input(?=[^>]*aria-label="项目目录")(?=[^>]*disabled=\{running \|\| busy\})[^>]*>/);
  assert.match(panel, /<button(?=[^>]*disabled=\{running \|\| busy\})[^>]*>选择项目目录<\/button>/);
  assert.match(panel, /<input(?=[^>]*aria-label="监听主机")(?=[^>]*disabled=\{running \|\| busy\})[^>]*>/);
  assert.match(panel, /<input(?=[^>]*aria-label="监听端口")(?=[^>]*disabled=\{running \|\| busy\})[^>]*>/);
  assert.match(panel, /<input(?=[^>]*aria-label="超时时间")(?=[^>]*disabled=\{running \|\| busy\})[^>]*>/);
  assert.match(panel, /className=\{running \? "proxy-instance-sidebar-action stop" : "primary-button"\}/);
});

test("settings tab and legacy config actions are removed from the renderer", async () => {
  const [app, pages] = await Promise.all([
    readFile("src/renderer/App.tsx", "utf8"),
    readFile("src/renderer/components/ConfigPages.tsx", "utf8"),
  ]);
  assert.doesNotMatch(app, /label: "设置"/);
  assert.doesNotMatch(app, /importLegacy/);
  assert.doesNotMatch(app, /exportConfig/);
  assert.doesNotMatch(pages, /onImport/);
  assert.doesNotMatch(pages, /onExport/);
  assert.doesNotMatch(pages, /page === "settings"/);
});

test("original request and encryption navigation remain available", async () => {
  const app = await readFile("src/renderer/App.tsx", "utf8");
  assert.match(app, /label: "请求"/);
  assert.match(app, /label: "加密"/);
  assert.match(app, /onEncryptDirectory/);
  assert.match(app, /onSendRequest/);
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

test("proxy instances live in the sidebar above the original feature tabs", async () => {
  const [app, sidebar, styles] = await Promise.all([
    readFile("src/renderer/App.tsx", "utf8"),
    readFile("src/renderer/components/ProxyInstanceSidebar.tsx", "utf8").catch(() => ""),
    readFile("src/renderer/styles.css", "utf8"),
  ]);
  assert.match(app, /ProxyInstanceSidebar/);
  assert.match(app, /sidebar-nav/);
  assert.match(sidebar, /instances\.map/);
  assert.match(sidebar, /新增/);
  assert.match(sidebar, /instance\.target/);
  assert.match(styles, /\.proxy-instance-sidebar-list/);
  assert.match(styles, /max-height:/);
  assert.match(styles, /overflow-y:\s*auto/);
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
  assert.match(styles, /\.proxy-instance-sidebar-title code[^}]*flex:\s*0 0 auto/);
  assert.match(styles, /\.proxy-instance-sidebar-title code[^}]*text-align:\s*right/);
});

test("proxy sidebar supports editing names and bulk runtime actions", async () => {
  const [app, panel, sidebar, styles] = await Promise.all([
    readFile("src/renderer/App.tsx", "utf8"),
    readFile("src/renderer/components/ProxyInstancePanel.tsx", "utf8"),
    readFile("src/renderer/components/ProxyInstanceSidebar.tsx", "utf8"),
    readFile("src/renderer/styles.css", "utf8"),
  ]);
  assert.match(app, /renameProxyInstance/);
  assert.match(app, /startAll/);
  assert.match(app, /stopAll/);
  assert.match(app, /onRename={renameProxyInstance}/);
  assert.match(panel, /编辑代理名称/);
  assert.match(panel, /onRename/);
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
