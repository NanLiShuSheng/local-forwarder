import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { workspaceGroups, workspaceIconPaths, workspaceRailGroups } from "../../src/renderer/workspace-navigation";

test("navigation exposes the six redesign categories and their page order", () => {
  assert.deepEqual(workspaceRailGroups, ["run", "debug", "data", "build", "tools"]);
  assert.deepEqual(Object.keys(workspaceGroups), ["run", "debug", "data", "build", "tools", "settings"]);
  assert.deepEqual(workspaceGroups.run.items.map((item) => item.label), ["工作台", "环境", "活动"]);
  assert.deepEqual(workspaceGroups.debug.items.map((item) => item.label), ["请求调试", "请求历史"]);
  assert.deepEqual(workspaceGroups.data.items.map((item) => item.label), ["登录缓存", "本地缓存", "文件缓存", "工作区变量"]);
  assert.deepEqual(workspaceGroups.build.items.map((item) => item.label), ["资源构建", "任务记录"]);
  assert.deepEqual(workspaceGroups.tools.items.map((item) => item.label), ["日志", "JSON 可视化", "字符串处理"]);
  assert.deepEqual(workspaceGroups.settings.items.map((item) => item.label), ["外观", "更新", "高级"]);
});

test("workspace navigation keeps accessible group and context labels", async () => {
  const source = await readFile("src/renderer/components/WorkspaceChrome.tsx", "utf8");
  assert.match(source, /<nav className="lf-rail" aria-label="工作区">/);
  assert.match(source, /<aside className="lf-context" aria-label=\{`\$\{group\.label\}导航`\}>/);
  assert.match(source, /<button className=\{`lf-rail-button/);
  assert.match(source, /<button className=\{`lf-context-item/);
});

test("every workspace group and page has a defined icon", () => {
  for (const group of Object.values(workspaceGroups)) {
    assert.ok(workspaceIconPaths[group.icon] !== undefined, `missing group icon: ${group.icon}`);
    for (const item of group.items) assert.ok(workspaceIconPaths[item.icon] !== undefined, `missing page icon: ${item.icon}`);
  }
});

test("tools navigation places logs first, exposes the JSON page second, and binds logs to Command+5", async () => {
  const source = await readFile("src/renderer/App.tsx", "utf8");
  assert.deepEqual(workspaceGroups.tools.items.map((item) => item.route), ["logs", "json", "string"]);
  assert.deepEqual(workspaceGroups.tools.items[0], { route: "logs", label: "日志", icon: "activity" });
  assert.deepEqual(workspaceGroups.tools.items[1], { route: "json", label: "JSON 可视化", icon: "json" });
  assert.match(source, /\^\[1-5\]\$/);
  assert.match(source, /"5": "logs"/);
  assert.match(source, /item\.route === "logs" \? "⌘5"/);
  assert.match(source, /<LogPanel logs=\{logs\} selected=\{selectedLog\} onSelect=\{setSelectedLog\}/);
  assert.match(source, /<JsonPreviewPage prefillText=\{jsonPrefill\}/);
  assert.match(source, /<KeepAlivePane active=\{route === "json"\}><JsonPreviewPage/);
});

test("workbench uses a pastable project directory field with directory selection", async () => {
  const [appSource, pageSource] = await Promise.all([
    readFile("src/renderer/App.tsx", "utf8"),
    readFile("src/renderer/components/WorkspacePages.tsx", "utf8"),
  ]);

  assert.doesNotMatch(pageSource, /lf-env-hero/);
  assert.match(pageSource, /className="lf-panel lf-project-bar" aria-label="项目目录"/);
  assert.match(pageSource, /aria-label="项目目录路径"/);
  assert.match(pageSource, /parseDirectoryInput\(draft\)/);
  assert.match(pageSource, /onBlur=\{\(\) => \{ void saveProjectPath\(\); \}\}/);
  assert.match(pageSource, /event\.key === "Enter"[\s\S]*?void saveProjectPath\(\)/);
  assert.match(pageSource, />选择项目目录<\/button>/);
  assert.match(appSource, /<WorkbenchPage[\s\S]*?onChooseProjectDirectory=\{chooseProjectDirectory\}/);
  assert.match(appSource, /onChangeProjectPath=\{\(projectPath\) => save\(\{ \.\.\.config, projectPath \}\)\}/);
});

test("App wires log clearing and JSON response fill actions", async () => {
  const source = await readFile("src/renderer/App.tsx", "utf8");

  assert.match(source, /const \[jsonPrefill, setJsonPrefill\] = useState<string>\(\);/);
  assert.match(source, /const clearLogs = async \(\): Promise<boolean> => \{/);
  assert.match(source, /const result = await window\.forwarder\.clearLogs\(\);/);
  assert.match(source, /setLogs\(\[\]\);/);
  assert.match(source, /return false;/);
  assert.match(source, /return true;/);
  assert.match(source, /const fillJsonPreview = \(text: string\) => \{[\s\S]*?setJsonPrefill\(responseTextToJsonPreview\(text\)\);[\s\S]*?navigate\("json"\);/);
  assert.match(source, /<JsonPreviewPage prefillText=\{jsonPrefill\} onPrefillApplied=\{\(\) => setJsonPrefill\(undefined\)\} \/>/);
  assert.match(source, /<RequestPage config=\{config\} active=\{route === "debug"\} onChange=\{save\} onSendRequest=\{sendRequest\} onFillJson=\{fillJsonPreview\}/);
  assert.match(source, /const \[selectedLog, setSelectedLog\] = useState<LogEntry>\(\);/);
  assert.match(source, /<WorkspaceDock logs=\{logs\} selected=\{selectedLog\} tab=\{dockTab\} onTabChange=\{setDockTab\} onSelectLog=\{setSelectedLog\}/);
});

test("App reports rejected log clearing IPC calls", async () => {
  const source = await readFile("src/renderer/App.tsx", "utf8");
  const clearLogs = source.match(/const clearLogs = async \(\): Promise<boolean> => \{([\s\S]*?)\n  \};/);

  assert.ok(clearLogs);
  assert.match(clearLogs[1], /try\s*\{[\s\S]*?await window\.forwarder\.clearLogs\(\)/);
  assert.match(clearLogs[1], /catch \(cause\)\s*\{[\s\S]*?notifyError\(cause, "日志清空失败"\);[\s\S]*?return false;/);
});

test("versioned log reader ignores results from invalidated requests", async () => {
  const module = await import("../../src/renderer/App") as unknown as {
    createVersionedLogReader?: unknown;
  };
  assert.equal(typeof module.createVersionedLogReader, "function");
  const createVersionedLogReader = module.createVersionedLogReader as (
    readLogs: () => Promise<unknown[]>,
    applyLogs: (logs: unknown[]) => void,
  ) => { read: () => Promise<void>; invalidate: () => void };
  let resolveRead: (logs: unknown[]) => void = () => undefined;
  const applied: unknown[][] = [];
  const reader = createVersionedLogReader(() => new Promise((resolve) => { resolveRead = resolve; }), (logs) => applied.push(logs));

  const pending = reader.read();
  reader.invalidate();
  resolveRead(["stale"]);
  await pending;

  assert.deepEqual(applied, []);
});

test("versioned log reader only applies the newest overlapping request", async () => {
  const module = await import("../../src/renderer/App") as unknown as {
    createVersionedLogReader?: unknown;
  };
  assert.equal(typeof module.createVersionedLogReader, "function");
  const createVersionedLogReader = module.createVersionedLogReader as (
    readLogs: () => Promise<unknown[]>,
    applyLogs: (logs: unknown[]) => void,
  ) => { read: () => Promise<void>; invalidate: () => void };
  let resolveFirst: (logs: unknown[]) => void = () => undefined;
  let resolveSecond: (logs: unknown[]) => void = () => undefined;
  let readCount = 0;
  const applied: unknown[][] = [];
  const reader = createVersionedLogReader(() => new Promise((resolve) => {
    if (readCount === 0) resolveFirst = resolve;
    else resolveSecond = resolve;
    readCount += 1;
  }), (logs) => applied.push(logs));

  const first = reader.read();
  const second = reader.read();
  resolveSecond(["new"]);
  await second;
  resolveFirst(["old"]);
  await first;

  assert.deepEqual(applied, [["new"]]);
});
