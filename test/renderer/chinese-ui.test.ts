import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { workspaceGroups } from "../../src/renderer/workspace-navigation";

const rendererFiles = [
  "src/renderer/App.tsx",
  "src/renderer/components/ConfigPages.tsx",
  "src/renderer/components/LocalCachePage.tsx",
  "src/renderer/components/LocalVariablesPage.tsx",
  "src/renderer/components/LogPanel.tsx",
  "src/renderer/components/RuleList.tsx",
  "src/renderer/components/RuntimePanel.tsx",
  "src/renderer/index.html",
];

const rendererStyleFiles = ["src/renderer/styles.css"];

const visibleEnglishLabels = [
  "Local Forwarder",
  "Intel Mac service",
  "Overview",
  "Control center",
  "Forwarding rules",
  "Service status",
  "Start service",
  "Stop service",
  "Search rules",
  "No matching rules.",
  "All levels",
  "Filter logs",
  "No logs yet.",
  "Import legacy config",
  "Export legacy config",
];

test("renderer uses Chinese labels for the operation panel", async () => {
  const source = (await Promise.all(rendererFiles.map((file) => readFile(file, "utf8")))).join("\n");
  for (const label of visibleEnglishLabels) {
    assert.equal(source.includes(label), false, `found untranslated label: ${label}`);
  }
});

test("environment details exposes hq, jy, and zx forwarding address settings", async () => {
  const source = await readFile("src/renderer/components/WorkspacePages.tsx", "utf8");
  for (const label of ["转发地址", '"hq"', '"jy"', '"zx"', "tcpTargets", "addressDrafts"]) {
    assert.equal(source.includes(label), true, `missing forwarding address setting: ${label}`);
  }
});

test("renderer places forwarding address editing inside environment details without a separate route", async () => {
  const [appSource, pageSource, styleSource] = await Promise.all([
    readFile("src/renderer/App.tsx", "utf8"),
    readFile("src/renderer/components/WorkspacePages.tsx", "utf8"),
    readFile("src/renderer/styles.css", "utf8"),
  ]);
  assert.doesNotMatch(appSource, /route === "addresses"/);
  assert.match(pageSource, /<ProxyInstancePanel[\s\S]*?<section className="lf-panel lf-forwarding-settings"/);
  assert.match(styleSource, /\.lf-address-grid[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/);
});

test("renderer exposes manual login cache and project directory controls", async () => {
  const source = (await Promise.all(rendererFiles.map((file) => readFile(file, "utf8")))).join("\n");
  const panelSource = await readFile("src/renderer/components/ProxyInstancePanel.tsx", "utf8");
  for (const label of ["登录缓存", "选择项目目录"]) {
    assert.equal(source.includes(label) || panelSource.includes(label), true, `missing manual configuration control: ${label}`);
  }
  assert.equal(source.includes("粘贴登录缓存"), false);
  assert.equal(source.includes("保存登录缓存"), false);
  assert.match(source, /parseLocalCacheText/);
  assert.match(source, /selectProjectDirectory/);
  assert.match(panelSource, /parseDirectoryInput/);
  assert.match(panelSource, /projectPathDraft/);
  assert.match(panelSource, /proxy-instance-project-field/);
  assert.doesNotMatch(panelSource, /<input value=\{config\.projectPath \?\? ""\} readOnly/);
});

test("renderer exposes local variables as a structured editable page", async () => {
  const [source, dataSource, styleSource] = await Promise.all([
    readFile("src/renderer/components/LocalVariablesPage.tsx", "utf8"),
    readFile("src/renderer/local-variable-data.ts", "utf8"),
    readFile("src/renderer/styles.css", "utf8"),
  ]);
  assert.match(source, /window\.forwarder\.getSharedValues\(\)/);
  assert.match(source, /window\.forwarder\.saveSharedValues\(next\)/);
  assert.match(source, /local-variables-workspace/);
  assert.match(source, /local-variables-row/);
  assert.match(source, /local-variables-label/);
  assert.match(source, /local-variables-type long">长文本/);
  assert.doesNotMatch(source, /local-variables-type text">文本/);
  assert.match(source, /local-variables-code-view/);
  assert.match(source, /parseLocalCacheText\(text\)/);
  assert.match(source, /formatLocalCacheText\(copy\)/);
  assert.match(source, /复制占位符/);
  assert.match(source, /保存更改/);
  assert.match(source, /批量文本/);
  assert.match(dataSource, /LOCAL_VARIABLE_LONG_THRESHOLD/);
  assert.match(styleSource, /\.local-variables-row[^\n]*min-height:\s*49px/);
  const labelRule = styleSource.match(/\.local-variables-label\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(labelRule, /flex:\s*0 1 auto/);
  assert.doesNotMatch(labelRule, /max-width:/);
  assert.match(styleSource, /\.local-variables-code-view[^\n]*white-space:\s*pre-wrap/);
  assert.match(styleSource, /\.local-variables-textarea[^\n]*white-space:\s*pre-wrap/);
});

test("data workspace gives login session and workspace variables separate routes", async () => {
  const [appSource, dataSource] = await Promise.all([
    readFile("src/renderer/App.tsx", "utf8"),
    readFile("src/renderer/components/DataBrowserPage.tsx", "utf8"),
  ]);
  assert.deepEqual(workspaceGroups.data.items.map((item) => item.route), ["session", "kv", "files", "variables"]);
  assert.match(appSource, /<DataBrowserPage tab=\{dataTab\}/);
  assert.match(dataSource, /tab === "session"/);
  assert.match(dataSource, /tab === "variables"/);
  assert.match(dataSource, /onSaveSession/);
  assert.match(dataSource, /saveSharedValues/);
});

test("renderer simplifies configuration page headings and enlarges text areas", async () => {
  const [pageSource, styleSource] = await Promise.all([
    readFile("src/renderer/components/ConfigPages.tsx", "utf8"),
    readFile("src/renderer/styles.css", "utf8"),
  ]);
  assert.doesNotMatch(pageSource, /<p className="eyebrow">本地变量<\/p>/);
  assert.doesNotMatch(pageSource, /<p className="eyebrow">登录状态<\/p>/);
  assert.doesNotMatch(pageSource, /<p className="eyebrow">H5 资源编码<\/p>/);
  assert.doesNotMatch(pageSource, /<p className="eyebrow">配置<\/p><h2>设置<\/h2>/);
  assert.match(pageSource, /className="config-textarea login-cache-input"/);
  assert.match(pageSource, /rows=\{14\}/);
  assert.match(styleSource, /\.login-cache-input[^\{]*\{[^}]*min-height:\s*340px/);
  assert.match(styleSource, /\.config-textarea-panel \{ display: flex; flex-direction: column; \}/);
  assert.match(styleSource, /\.config-textarea-hint \{ margin: 0 0 12px; line-height: 1\.55; \}/);
});

test("renderer does not repeat page tab labels as right-side headings", async () => {
  const pageSource = await readFile("src/renderer/components/ConfigPages.tsx", "utf8");
  for (const heading of ["本地变量", "登录缓存", "设置", "选择目录并开始加密"]) {
    assert.doesNotMatch(pageSource, new RegExp(`<h2>${heading}</h2>`));
  }
});

test("renderer displays operation errors as bottom-right auto-hidden toasts", async () => {
  const [appSource, runtimeSource, pagesSource, errorSource, styleSource] = await Promise.all([
    readFile("src/renderer/App.tsx", "utf8"),
    readFile("src/renderer/components/RuntimePanel.tsx", "utf8"),
    readFile("src/renderer/components/ConfigPages.tsx", "utf8"),
    readFile("src/renderer/components/DismissibleError.tsx", "utf8").catch(() => ""),
    readFile("src/renderer/styles.css", "utf8"),
  ]);
  assert.match(errorSource, /export function DismissibleError/);
  assert.match(appSource, /<ToastProvider><AppContent \/><\/ToastProvider>/);
  assert.match(appSource, /notifyError/);
  assert.match(runtimeSource, /useToast/);
  assert.match(pagesSource, /useToast/);
  assert.doesNotMatch(appSource, /<DismissibleError/);
  assert.doesNotMatch(runtimeSource, /<DismissibleError/);
  assert.doesNotMatch(pagesSource, /<DismissibleError/);
  assert.match(styleSource, /\.toast-viewport[^\{]*\{[^}]*position:\s*fixed/);
  assert.match(styleSource, /\.toast-viewport[^\{]*\{[^}]*right:\s*20px/);
  assert.match(styleSource, /\.toast-viewport[^\{]*\{[^}]*bottom:\s*20px/);
});

test("forwarding address and request controls use the shared green light and dark themes", async () => {
  const [pageSource, requestSource, styleSource] = await Promise.all([
    readFile("src/renderer/components/WorkspacePages.tsx", "utf8"),
    readFile("src/renderer/components/RequestPage.tsx", "utf8"),
    readFile("src/renderer/styles.css", "utf8"),
  ]);
  assert.match(pageSource, /className="lf-address-field"/);
  assert.match(pageSource, /className="lf-control mono"/);
  assert.match(requestSource, /className="lf-control mono"/);
  assert.match(styleSource, /\.lf-control\s*\{[^}]*color:\s*var\(--text-primary\);[^}]*background:\s*var\(--lf-panel-2\)/);
  assert.match(styleSource, /\.app-shell\s*\{[\s\S]*?--accent:\s*#4d9375;/);
  assert.match(styleSource, /\.app-shell\[data-theme="light"\]\s*\{[\s\S]*?--accent:\s*#0f9f76;/);
  assert.doesNotMatch(styleSource, /#111e32|#e8effa/i);
});
