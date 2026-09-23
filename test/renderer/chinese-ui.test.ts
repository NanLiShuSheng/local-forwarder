import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rendererFiles = [
  "src/renderer/App.tsx",
  "src/renderer/components/ConfigPages.tsx",
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
  "Variables",
  "Settings",
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

test("renderer exposes the hq, jy, and zx forwarding address settings", async () => {
  const source = (await Promise.all(rendererFiles.map((file) => readFile(file, "utf8")))).join("\n");
  for (const label of ["转发地址", "hq", "jy", "zx", "tcpTargets"]) {
    assert.equal(source.includes(label), true, `missing forwarding address setting: ${label}`);
  }
});

test("renderer places forwarding addresses below overview without a separate tab", async () => {
  const [source, styleSource] = await Promise.all([
    readFile("src/renderer/App.tsx", "utf8"),
    readFile("src/renderer/styles.css", "utf8"),
  ]);
  assert.doesNotMatch(source, /\{ id: "addresses", label: "转发地址" \}/);
  assert.match(source, /page === "runtime"/);
  assert.match(source, /<ConfigPages page="addresses"/);
  assert.match(styleSource, /\.dashboard-grid \+ \.panel[^\{]*\{[^}]*margin-top:\s*18px/);
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

test("renderer keeps the local variable input after saving without a duplicate saved list", async () => {
  const source = await readFile("src/renderer/components/ConfigPages.tsx", "utf8");
  assert.match(source, /本地变量输入/);
  assert.match(source, /onBlur/);
  assert.match(source, /parseLocalCacheText\(localText\)/);
  assert.match(source, /onSaveSharedValues\(parsed\)/);
  assert.match(source, /formatLocalCacheText\(sharedValues\)/);
  assert.doesNotMatch(source, /setLocalText\(""\)/);
  assert.doesNotMatch(source, /className="value-list"/);
});

test("renderer gives local variables a separate menu from login cache", async () => {
  const appSource = await readFile("src/renderer/App.tsx", "utf8");
  const pageSource = await readFile("src/renderer/components/ConfigPages.tsx", "utf8");
  assert.match(appSource, /\{ id: "local", label: "本地变量", icon: "local" \}/);
  assert.match(appSource, /\{ id: "values", label: "登录缓存", icon: "values" \}/);
  const localStart = pageSource.indexOf('if (page === "local")');
  const valuesStart = pageSource.indexOf('if (page === "values")');
  const loginSaveStart = pageSource.indexOf("const saveLoginCache");
  assert.ok(localStart >= 0 && valuesStart > localStart);
  assert.ok(loginSaveStart >= 0 && valuesStart > loginSaveStart);
  const localPage = pageSource.slice(localStart, valuesStart);
  const loginPage = pageSource.slice(valuesStart);
  const loginSaveLogic = pageSource.slice(loginSaveStart, valuesStart);
  assert.match(localPage, /className="panel config-textarea-panel"/);
  assert.match(loginPage, /className="panel config-textarea-panel"/);
  assert.match(localPage, /className="muted config-textarea-hint"/);
  assert.match(loginPage, /className="muted config-textarea-hint"/);
  assert.match(localPage, /className="config-textarea local-values-input"/);
  assert.match(loginPage, /className="config-textarea login-cache-input"/);
  const localHint = localPage.indexOf("config-textarea-hint");
  const localInput = localPage.indexOf("local-values-input");
  const cacheHint = loginPage.indexOf("config-textarea-hint");
  const cacheInput = loginPage.indexOf("login-cache-input");
  assert.ok(localHint >= 0 && localHint < localInput);
  assert.ok(cacheHint >= 0 && cacheHint < cacheInput);
  assert.match(localPage, /本地变量输入/);
  assert.doesNotMatch(localPage, /粘贴登录缓存/);
  assert.match(loginPage, /onBlur/);
  assert.match(loginSaveLogic, /parseLocalCacheText\(cacheText\)/);
  assert.match(loginSaveLogic, /onSaveLoginCache\(pasted\)/);
  assert.match(pageSource, /formatLocalCacheText\(loginCache\)/);
  assert.doesNotMatch(loginPage, /保存登录缓存/);
  assert.doesNotMatch(loginPage, /本地变量输入/);
});

test("renderer wraps long local variable input values instead of forcing horizontal scrolling", async () => {
  const source = (await Promise.all(rendererStyleFiles.map((file) => readFile(file, "utf8")))).join("\n");
  assert.match(source, /\.local-values-input[^\n]*white-space:\s*pre-wrap/);
  assert.match(source, /\.local-values-input[^\n]*overflow-wrap:\s*anywhere/);
  assert.match(source, /\.local-values-input[^\n]*word-break:\s*break-word/);
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
  assert.match(pageSource, /className="config-textarea local-values-input"/);
  assert.match(pageSource, /className="config-textarea login-cache-input"/);
  assert.match(pageSource, /rows=\{18\}/);
  assert.match(pageSource, /rows=\{14\}/);
  assert.match(styleSource, /\.local-values-input[^\{]*\{[^}]*min-height:\s*420px/);
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

test("renderer gives forwarding address and request transport controls a dark theme", async () => {
  const [pageSource, requestSource, styleSource] = await Promise.all([
    readFile("src/renderer/components/ConfigPages.tsx", "utf8"),
    readFile("src/renderer/components/RequestPage.tsx", "utf8"),
    readFile("src/renderer/styles.css", "utf8"),
  ]);
  assert.match(pageSource, /address-input/);
  assert.match(requestSource, /className="select-control request-transport-select"/);
  assert.match(styleSource, /\.select-control\s*\{/);
  assert.match(styleSource, /\.address-input[^\{]*\{[^}]*background:\s*var\(--input-background\)/);
  assert.match(styleSource, /\.select-control[^\{]*\{[^}]*background-color:\s*var\(--input-background\)/);
  assert.match(styleSource, /\.address-input[^\{]*\{[^}]*color:\s*var\(--text-primary\)/);
  assert.match(styleSource, /\.select-control[^\{]*\{[^}]*color:\s*var\(--text-primary\)/);
  assert.doesNotMatch(styleSource, /\.address-input[^\{]*\{[^}]*background:\s*#111e32/);
  assert.doesNotMatch(styleSource, /\.select-control[^\{]*\{[^}]*background-color:\s*#111e32/);
  assert.doesNotMatch(styleSource, /\.address-input[^\{]*\{[^}]*color:\s*#e8effa/);
  assert.doesNotMatch(styleSource, /\.select-control[^\{]*\{[^}]*color:\s*#e8effa/);
});
