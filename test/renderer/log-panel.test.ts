import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("log panel supports expandable request and response details with wrapped text", async () => {
  const [panelSource, styleSource] = await Promise.all([
    readFile("src/renderer/components/LogPanel.tsx", "utf8"),
    readFile("src/renderer/styles.css", "utf8"),
  ]);
  assert.match(panelSource, /requestParams/);
  assert.match(panelSource, /responseData/);
  assert.match(panelSource, /onClick/);
  assert.match(panelSource, /日志详情/);
  assert.match(styleSource, /\.log-message[^\{]*\{[^}]*overflow-wrap:\s*anywhere/);
  assert.match(styleSource, /\.log-detail-body[^\{]*\{[^}]*white-space:\s*pre-wrap/);
  assert.match(styleSource, /\.log-detail-body[^\{]*\{[^}]*overflow-wrap:\s*anywhere/);
});

test("log panel keeps the list visible beside the selected detail", async () => {
  const [panelSource, styleSource] = await Promise.all([
    readFile("src/renderer/components/LogPanel.tsx", "utf8"),
    readFile("src/renderer/styles.css", "utf8"),
  ]);
  assert.match(panelSource, /log-workspace/);
  assert.match(panelSource, /log-detail-empty/);
  assert.match(panelSource, /选择一条日志查看详情/);
  assert.match(styleSource, /\.log-workspace[^\{]*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(320px, 1\.05fr\)/);
  assert.match(styleSource, /\.log-list[^}]*max-height:\s*520px/);
  assert.match(styleSource, /\.log-list[^}]*overflow-y:\s*auto/);
  assert.match(styleSource, /@media\s*\(max-width:\s*820px\)[^{]*\{[^{}]*\.log-workspace[^{}]*grid-template-columns:\s*1fr/);
});
