import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LogPanel } from "../../src/renderer/components/LogPanel";
import type { LogEntry } from "../../src/shared/contracts";

type ClearLogHandlerFactory = (
  onClear: () => Promise<boolean>,
  callbacks: { onCleared: () => void; onBusyChange: (isBusy: boolean) => void },
) => () => Promise<boolean>;

async function loadClearLogHandlerFactory(): Promise<ClearLogHandlerFactory> {
  const module = await import("../../src/renderer/components/LogPanel") as unknown as { createLogClearHandler?: unknown };
  assert.equal(typeof module.createLogClearHandler, "function");
  return module.createLogClearHandler as ClearLogHandlerFactory;
}

function logWithResponse(responseData: string): LogEntry {
  return { timestamp: "2026-09-04T00:00:00.000Z", level: "info", message: "GET /health", responseData };
}

function renderSelectedLog(responseData: string): string {
  const selected = logWithResponse(responseData);
  return renderToStaticMarkup(createElement(LogPanel, {
    logs: [selected],
    initialSelected: selected,
    onClear: async () => true,
    onFillJson: () => undefined,
  }));
}

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
  assert.match(panelSource, /createLogClearHandler/);
  assert.match(panelSource, /onCleared:\s*\(\) => setSelected\(undefined\)/);
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

  assert.match(panelSource, /export function createLogClearHandler/);
  assert.match(panelSource, /if\s*\(isBusy\)\s*return false/);
  assert.match(panelSource, /try\s*\{[\s\S]*?await onClear\(\)[\s\S]*?\}\s*catch\s*\{[\s\S]*?return false/);
  assert.match(panelSource, /finally\s*\{[\s\S]*?callbacks\.onBusyChange\(false\)/);
  assert.match(panelSource, /const \[isClearing, setIsClearing\] = useState\(false\)/);
  assert.match(panelSource, /onBusyChange:\s*setIsClearing/);
  assert.match(panelSource, /disabled=\{logs\.length === 0 \|\| isClearing\}/);
});

test("log panel only offers JSON fill for non-empty response strings", async () => {
  const panelSource = await readFile("src/renderer/components/LogPanel.tsx", "utf8");

  assert.match(panelSource, /typeof selected\.responseData === "string" && selected\.responseData\.length > 0/);
  assert.match(panelSource, /回填到 JSON 可视化/);
});

test("clear helper swallows rejection without clearing the selected detail", async () => {
  const createLogClearHandler = await loadClearLogHandlerFactory();
  let clearSelectionCalls = 0;
  const clearLogs = createLogClearHandler(async () => {
    throw new Error("clear failed");
  }, {
    onCleared: () => { clearSelectionCalls += 1; },
    onBusyChange: () => undefined,
  });

  await assert.doesNotReject(() => clearLogs());
  assert.equal(clearSelectionCalls, 0);
});

test("clear helper clears the selected detail once after a successful clear", async () => {
  const createLogClearHandler = await loadClearLogHandlerFactory();
  let clearCalls = 0;
  let clearSelectionCalls = 0;
  const clearLogs = createLogClearHandler(async () => {
    clearCalls += 1;
    return true;
  }, {
    onCleared: () => { clearSelectionCalls += 1; },
    onBusyChange: () => undefined,
  });

  assert.equal(await clearLogs(), true);
  assert.equal(clearCalls, 1);
  assert.equal(clearSelectionCalls, 1);
});

test("clear helper ignores a concurrent second clear request", async () => {
  const createLogClearHandler = await loadClearLogHandlerFactory();
  let clearCalls = 0;
  let clearSelectionCalls = 0;
  let resolveClear: (result: boolean) => void = () => undefined;
  const clearLogs = createLogClearHandler(() => {
    clearCalls += 1;
    return new Promise<boolean>((resolve) => { resolveClear = resolve; });
  }, {
    onCleared: () => { clearSelectionCalls += 1; },
    onBusyChange: () => undefined,
  });

  const firstClear = clearLogs();
  assert.equal(await clearLogs(), false);
  assert.equal(clearCalls, 1);
  resolveClear(true);
  assert.equal(await firstClear, true);
  assert.equal(clearSelectionCalls, 1);
});

test("server-rendered log panel hides the JSON fill button for an empty response", () => {
  assert.doesNotMatch(renderSelectedLog(""), /回填到 JSON 可视化/);
});

test("server-rendered log panel shows the JSON fill button for a non-empty response", () => {
  assert.match(renderSelectedLog('{"ok":true}'), /回填到 JSON 可视化/);
});
