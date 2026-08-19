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

test("renderer exposes manual login cache and project directory controls", async () => {
  const source = (await Promise.all(rendererFiles.map((file) => readFile(file, "utf8")))).join("\n");
  for (const label of ["粘贴登录缓存", "保存登录缓存", "选择项目目录"]) {
    assert.equal(source.includes(label), true, `missing manual configuration control: ${label}`);
  }
  assert.match(source, /parseLocalCacheText/);
  assert.match(source, /selectProjectDirectory/);
});
