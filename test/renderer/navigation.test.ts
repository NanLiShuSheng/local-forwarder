import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("navigation hides forwarding rules and cache pages", async () => {
  const source = await readFile("src/renderer/App.tsx", "utf8");
  assert.doesNotMatch(source, /\{ id: "rules", label: "转发规则" \}/);
  assert.doesNotMatch(source, /\{ id: "cache", label: "缓存" \}/);
});

test("sidebar navigation removes the visible feature heading without changing its accessible name", async () => {
  const source = await readFile("src/renderer/App.tsx", "utf8");
  const styles = await readFile("src/renderer/styles.css", "utf8");

  assert.match(source, /<nav className="sidebar-nav" aria-label="功能导航">/);
  assert.doesNotMatch(source, /<span className="sidebar-nav-label">功能<\/span>/);
  assert.match(styles, /\.sidebar-nav::before/);
});

test("sidebar navigation gives every tab an icon without changing its label", async () => {
  const source = await readFile("src/renderer/App.tsx", "utf8");
  const styles = await readFile("src/renderer/styles.css", "utf8");

  assert.match(source, /icon: "runtime"/);
  assert.match(source, /icon: "request"/);
  assert.match(source, /icon: "string"/);
  assert.match(source, /icon: "local"/);
  assert.match(source, /icon: "values"/);
  assert.match(source, /icon: "encryption"/);
  assert.match(source, /icon: "logs"/);
  assert.match(source, /icon: "appearance"/);
  assert.match(source, /className="sidebar-nav-icon"/);
  assert.match(styles, /\.sidebar-nav-icon/);
});

test("sidebar navigation exposes the JSON visualization page", async () => {
  const source = await readFile("src/renderer/App.tsx", "utf8");
  const pagesSource = await readFile("src/renderer/components/ConfigPages.tsx", "utf8");

  assert.match(source, /\{ id: "json", label: "JSON 可视化", icon: "json" \}/);
  assert.match(source, /<JsonPreviewPage prefillText=\{jsonPrefill\}/);
  assert.match(pagesSource, /Page = .*"json"/);
  assert.match(source, /page !== "json"/);
});

test("App wires log clearing and JSON response fill actions", async () => {
  const source = await readFile("src/renderer/App.tsx", "utf8");

  assert.match(source, /const \[jsonPrefill, setJsonPrefill\] = useState<string>\(\);/);
  assert.match(source, /const clearLogs = async \(\): Promise<boolean> => \{/);
  assert.match(source, /const result = await window\.forwarder\.clearLogs\(\);/);
  assert.match(source, /setLogs\(\[\]\);/);
  assert.match(source, /return false;/);
  assert.match(source, /return true;/);
  assert.match(source, /const fillJsonPreview = \(text: string\) => \{[\s\S]*?setJsonPrefill\(text\);[\s\S]*?setPage\("json"\);/);
  assert.match(source, /<JsonPreviewPage prefillText=\{jsonPrefill\} onPrefillApplied=\{\(\) => setJsonPrefill\(undefined\)\} \/>/);
  assert.match(source, /<LogPanel logs=\{logs\} onClear=\{clearLogs\} onFillJson=\{fillJsonPreview\} \/>/);
});

test("App reports rejected log clearing IPC calls", async () => {
  const source = await readFile("src/renderer/App.tsx", "utf8");
  const clearLogs = source.match(/const clearLogs = async \(\): Promise<boolean> => \{([\s\S]*?)\n  \};/);

  assert.ok(clearLogs);
  assert.match(clearLogs[1], /try\s*\{[\s\S]*?await window\.forwarder\.clearLogs\(\)/);
  assert.match(clearLogs[1], /catch \(cause\)\s*\{[\s\S]*?setError\(cause instanceof Error \? cause\.message : "日志清空失败"\);[\s\S]*?return false;/);
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
