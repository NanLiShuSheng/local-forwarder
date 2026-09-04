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
  assert.match(styleSource, /@media\s*\(max-width:\s*820px\)[\s\S]*?\.log-workspace[\s\S]*?grid-template-columns:\s*1fr/);
});

test("log panel exposes source and parsed request detail actions", async () => {
  const [panelSource, styleSource] = await Promise.all([
    readFile("src/renderer/components/LogPanel.tsx", "utf8"),
    readFile("src/renderer/styles.css", "utf8"),
  ]);
  assert.match(panelSource, /parseLogRequestParams/);
  assert.match(panelSource, /onClear/);
  assert.match(panelSource, /onFillJson/);
  assert.match(panelSource, /清空日志/);
  assert.match(panelSource, /disabled=\{logs\.length === 0 \|\| isClearing\}/);
  assert.match(panelSource, /if\s*\(await onClear\(\)\)\s*\{\s*setSelected\(undefined\)/);
  assert.match(panelSource, /requestView/);
  assert.match(panelSource, /源码/);
  assert.match(panelSource, /解析结果/);
  assert.match(panelSource, /method/);
  assert.match(panelSource, /path/);
  assert.match(panelSource, /query/);
  assert.match(panelSource, /body/);
  assert.match(panelSource, /rawBody/);
  assert.match(panelSource, /回填到 JSON 可视化/);
  assert.match(panelSource, /onFillJson\(selected\.responseData/);
  assert.match(panelSource, /log-detail-key-value/);
  assert.match(panelSource, /log-detail-key/);
  assert.match(panelSource, /log-detail-value/);
  assert.match(styleSource, /\.log-detail-section-title[^\{]*\{/);
  assert.match(styleSource, /\.log-detail-tabs[^\{]*\{/);
  assert.match(styleSource, /\.log-detail-key-value[^\{]*\{/);
  assert.match(styleSource, /\.log-detail-value[^\{]*\{[^}]*overflow-wrap:\s*anywhere/);
  assert.match(styleSource, /\.log-detail-response-actions[^\{]*\{[^}]*flex-wrap:\s*wrap/);
  assert.match(styleSource, /\.log-detail[^\{]*\{[^}]*overflow-y:\s*auto/);
  assert.match(styleSource, /\.log-toolbar[^\{]*\{[^}]*flex-wrap:\s*wrap/);
});

test("log panel handles clearing failures and prevents duplicate clear requests", async () => {
  const panelSource = await readFile("src/renderer/components/LogPanel.tsx", "utf8");
  const clearHandler = panelSource.match(/const clearLogs = async \(\) => \{([\s\S]*?)\n  \};/)?.[1];

  assert.ok(clearHandler);
  assert.match(panelSource, /try\s*\{[\s\S]*?await onClear\(\)[\s\S]*?\}\s*catch\s*\{[\s\S]*?\}/);
  assert.doesNotMatch(clearHandler, /catch[\s\S]*setSelected\(undefined\)/);
  assert.match(panelSource, /const \[isClearing, setIsClearing\] = useState\(false\)/);
  assert.match(panelSource, /setIsClearing\(true\)/);
  assert.match(panelSource, /finally\s*\{[\s\S]*?setIsClearing\(false\)/);
  assert.match(panelSource, /disabled=\{logs\.length === 0 \|\| isClearing\}/);
});

test("log panel only offers JSON fill for non-empty response strings", async () => {
  const panelSource = await readFile("src/renderer/components/LogPanel.tsx", "utf8");

  assert.match(panelSource, /typeof selected\.responseData === "string" && selected\.responseData\.length > 0/);
  assert.match(panelSource, /回填到 JSON 可视化/);
});
