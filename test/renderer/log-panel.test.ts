import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { filterLogEntries, LogPanel, resolveLogTypeSelection } from "../../src/renderer/components/LogPanel";
import { LOG_TYPE_STORAGE_KEY } from "../../src/renderer/log-type-preference";
import type { LogTypeStorage } from "../../src/renderer/log-type-preference";
import type { LogEntry } from "../../src/shared/contracts";
import { ALL_LOG_TYPES } from "../../src/shared/log-types";

type ClearLogHandlerFactory = (
  onClear: () => Promise<boolean>,
  callbacks: { onCleared: () => void; onBusyChange: (isBusy: boolean) => void },
) => () => Promise<boolean>;

type PersistLogTypeSelection = (
  nextType: string,
  storage: LogTypeStorage | undefined,
  setLogType: (nextType: string) => void,
) => void;

async function loadClearLogHandlerFactory(): Promise<ClearLogHandlerFactory> {
  const module = await import("../../src/renderer/components/LogPanel") as unknown as { createLogClearHandler?: unknown };
  assert.equal(typeof module.createLogClearHandler, "function");
  return module.createLogClearHandler as ClearLogHandlerFactory;
}

async function loadPersistLogTypeSelection(): Promise<PersistLogTypeSelection> {
  const module = await import("../../src/renderer/components/LogPanel") as unknown as { persistLogTypeSelection?: unknown };
  assert.equal(typeof module.persistLogTypeSelection, "function");
  return module.persistLogTypeSelection as PersistLogTypeSelection;
}

function createMemoryLogTypeStorage(initialValue: string | null, onSet?: (value: string) => void): LogTypeStorage {
  let value = initialValue;
  return {
    getItem: (key) => {
      assert.equal(key, LOG_TYPE_STORAGE_KEY);
      return value;
    },
    setItem: (key, nextValue) => {
      assert.equal(key, LOG_TYPE_STORAGE_KEY);
      value = nextValue;
      onSet?.(nextValue);
    },
  };
}

function withWindow<T>(windowValue: unknown, callback: () => T): T {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: windowValue });
  try {
    return callback();
  } finally {
    if (descriptor) {
      Object.defineProperty(globalThis, "window", descriptor);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  }
}

function logWithResponse(responseData: string): LogEntry {
  return { timestamp: "2026-09-04T00:00:00.000Z", level: "info", message: "GET /health", requestPath: "/reqxml", responseData };
}

function renderSelectedLog(responseData: string): string {
  const selected = logWithResponse(responseData);
  return renderToStaticMarkup(createElement(LogPanel, {
    logs: [selected],
    selected,
    onSelect: () => undefined,
    onClear: async () => true,
    onFillJson: () => undefined,
  }));
}

function renderLogListWithSelectedEntry(): string {
  const selected = { ...logWithResponse("selected"), message: "selected" };
  const other = { ...logWithResponse("other"), message: "other", timestamp: "2026-09-04T00:00:01.000Z" };
  return renderToStaticMarkup(createElement(LogPanel, {
    logs: [selected, other],
    selected,
    onSelect: () => undefined,
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

test("log panel fills the available page height while keeping its columns scrollable", async () => {
  const [appSource, styleSource] = await Promise.all([
    readFile("src/renderer/App.tsx", "utf8"),
    readFile("src/renderer/styles.css", "utf8"),
  ]);

  assert.match(appSource, /page === "logs" \? "log-page-content" : ""/);
  assert.match(styleSource, /\.log-page-content[^\{]*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column/);
  assert.match(styleSource, /\.log-page-content > \.log-panel[^\{]*\{[^}]*flex:\s*1[^}]*min-height:\s*0/);
  assert.match(styleSource, /\.log-page-content \.log-list[^\{]*\{[^}]*max-height:\s*none/);
  assert.match(styleSource, /\.log-page-content \.log-detail[^\{]*\{[^}]*max-height:\s*none[^}]*min-height:\s*0/);
});

test("log panel marks the selected log row with an accessible selected state", async () => {
  const [markup, panelSource, styles] = await Promise.all([
    Promise.resolve(renderLogListWithSelectedEntry()),
    readFile("src/renderer/components/LogPanel.tsx", "utf8"),
    readFile("src/renderer/styles.css", "utf8"),
  ]);
  assert.match(markup, /class="log-row selected"/);
  assert.match(markup, /aria-current="true"/);
  assert.match(panelSource, /toLocaleTimeString\(undefined, \{ hour12: false \}\)/);
  assert.match(styles, /\.log-row\s*\{[^}]*padding:\s*9px 0 9px 8px;/);
  assert.match(styles, /\.log-row:hover, \.log-row\.selected\s*\{[^}]*background:\s*var\(--selection-background\)/);
  assert.doesNotMatch(styles, /\.log-row\.selected\s*\{[^}]*box-shadow:/);
});

test("log panel exposes source and parsed request detail actions", async () => {
  const [panelSource, styleSource] = await Promise.all([
    readFile("src/renderer/components/LogPanel.tsx", "utf8"),
    readFile("src/renderer/styles.css", "utf8"),
  ]);
  assert.match(panelSource, /parseLogRequestParams/);
  assert.match(panelSource, /onClear/);
  assert.match(panelSource, /onFillJson/);
  assert.match(panelSource, /selected/);
  assert.match(panelSource, /onSelect/);
  assert.match(panelSource, /清空日志/);
  assert.match(panelSource, /disabled=\{logs\.length === 0 \|\| isClearing\}/);
  assert.match(panelSource, /createLogClearHandler/);
  assert.match(panelSource, /onCleared:\s*\(\) => onSelect\(undefined\)/);
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
  assert.match(panelSource, /log-detail-response-button/);
  assert.doesNotMatch(panelSource, /log-detail-response-actions/);
  assert.match(panelSource, /log-detail-key-value/);
  assert.match(panelSource, /log-detail-key/);
  assert.match(panelSource, /log-detail-value/);
  assert.match(styleSource, /\.log-detail-section-title[^\{]*\{/);
  assert.match(styleSource, /\.log-detail-tabs[^\{]*\{/);
  assert.match(styleSource, /\.log-detail-key-value[^\{]*\{/);
  assert.match(styleSource, /\.log-detail-value[^\{]*\{[^}]*overflow-wrap:\s*anywhere/);
  assert.match(styleSource, /\.log-detail-response-button[^\{]*\{/);
  assert.match(styleSource, /\.log-detail[^\{]*\{[^}]*overflow-y:\s*auto/);
  assert.match(styleSource, /\.log-toolbar[^\{]*\{[^}]*flex-wrap:\s*wrap/);
});

test("server-rendered log panel exposes log type filter options", async () => {
  const panelSource = await readFile("src/renderer/components/LogPanel.tsx", "utf8");
  const logs: LogEntry[] = [
    { timestamp: "2026-09-04T00:00:00.000Z", level: "info", message: "reqxml", requestPath: "/reqxml" },
    { timestamp: "2026-09-04T00:00:01.000Z", level: "info", message: "reqreadmap", requestPath: "/reqreadmap" },
    { timestamp: "2026-09-04T00:00:02.000Z", level: "info", message: "login", requestPath: "/login" },
    {
      timestamp: "2026-09-04T00:00:03.000Z",
      level: "info",
      message: "newzt",
      requestPath: "/newzt/components/StepBtns/StepBtns.html",
    },
  ];
  const markup = renderToStaticMarkup(createElement(LogPanel, {
    logs,
    selected: undefined,
    onSelect: () => undefined,
    onClear: async () => true,
    onFillJson: () => undefined,
  }));

  assert.match(panelSource, /getLogTypeOptions/);
  assert.match(panelSource, /matchesLogType/);
  assert.match(panelSource, /readLogType|DEFAULT_LOG_TYPE/);
  assert.match(panelSource, /readLogType/);
  assert.match(panelSource, /writeLogType/);
  assert.match(panelSource, /getLogTypeStorage/);
  assert.match(panelSource, /useState\(\(\) => readLogType\(logTypeStorage\)\)/);
  assert.match(panelSource, /persistLogTypeSelection\(nextType, logTypeStorage, setLogType\)/);
  assert.match(markup, /aria-label="日志类型"/);
  assert.match(panelSource, /<select[^>]*className="select-control"[^>]*aria-label="日志类型"/);
  assert.match(panelSource, /<select[^>]*className="select-control"[^>]*aria-label="日志级别"/);
  assert.match(markup, /<option value="all">全部<\/option>/);
  assert.match(markup, /<option value="\/reqxml"[^>]*>\/reqxml<\/option>/);
  assert.match(markup, /<option value="\/reqreadmap">\/reqreadmap<\/option>/);
  assert.match(markup, /<option value="\/reqlocal">\/reqlocal<\/option>/);
  assert.match(markup, /<option value="\/reqsavemap">\/reqsavemap<\/option>/);
  assert.match(markup, /<option value="\/reqsavefile">\/reqsavefile<\/option>/);
  assert.match(markup, /<option value="\/reqreadfile">\/reqreadfile<\/option>/);
  assert.doesNotMatch(markup, /<option value="\/login">\/login<\/option>/);
  assert.doesNotMatch(markup, /<option value="\/newzt\/components\/StepBtns\/StepBtns\.html">\/newzt\/components\/StepBtns\/StepBtns\.html<\/option>/);
});

test("log panel initializes the log type selection from local storage", () => {
  const storage = createMemoryLogTypeStorage("/reqreadmap");
  const logs: LogEntry[] = [
    { timestamp: "2026-09-04T00:00:00.000Z", level: "info", message: "reqxml", requestPath: "/reqxml" },
    { timestamp: "2026-09-04T00:00:01.000Z", level: "info", message: "reqreadmap", requestPath: "/reqreadmap" },
    { timestamp: "2026-09-04T00:00:02.000Z", level: "info", message: "api data", requestPath: "/api/data" },
  ];

  const markup = withWindow({ localStorage: storage }, () => renderToStaticMarkup(createElement(LogPanel, {
    logs,
    selected: undefined,
    onSelect: () => undefined,
    onClear: async () => true,
    onFillJson: () => undefined,
  })));

  assert.match(markup, /<option value="\/reqreadmap"[^>]*selected[^>]*>\/reqreadmap<\/option>/);
});

test("persistLogTypeSelection updates state before saving all fixed and dynamic types", async () => {
  const persistLogTypeSelection = await loadPersistLogTypeSelection();
  const events: string[] = [];
  const storage = createMemoryLogTypeStorage(null, (value) => events.push(`storage:${value}`));
  let state = "";
  const setLogType = (nextType: string) => {
    state = nextType;
    events.push(`state:${nextType}`);
  };

  for (const nextType of [ALL_LOG_TYPES, "/reqreadmap", "/api/data"]) {
    events.length = 0;
    persistLogTypeSelection(nextType, storage, setLogType);
    assert.deepEqual(events, [`state:${nextType}`, `storage:${nextType}`]);
    assert.equal(state, nextType);
    assert.equal(storage.getItem(LOG_TYPE_STORAGE_KEY), nextType);
  }
});

test("log panel tolerates storage read and write failures", async () => {
  const persistLogTypeSelection = await loadPersistLogTypeSelection();
  const throwingStorage: LogTypeStorage = {
    getItem: () => { throw new Error("read failed"); },
    setItem: () => { throw new Error("write failed"); },
  };

  assert.doesNotThrow(() => withWindow({ localStorage: throwingStorage }, () => renderToStaticMarkup(createElement(LogPanel, {
    logs: [],
    selected: undefined,
    onSelect: () => undefined,
    onClear: async () => true,
    onFillJson: () => undefined,
  }))));

  let state = "";
  assert.doesNotThrow(() => persistLogTypeSelection("/api/data", throwingStorage, (nextType) => { state = nextType; }));
  assert.equal(state, "/api/data");
});

test("filters log entries by type, level, and text while preserving recent reverse order", () => {
  const logs: LogEntry[] = [
    { timestamp: "2026-09-04T00:00:00.000Z", level: "info", message: "target match", requestPath: "/reqxml" },
    { timestamp: "2026-09-04T00:00:01.000Z", level: "error", message: "other", requestPath: "/reqreadmap" },
    { timestamp: "2026-09-04T00:00:02.000Z", level: "info", message: "legacy match" },
    {
      timestamp: "2026-09-04T00:00:03.000Z",
      level: "info",
      message: "unlisted match",
      requestPath: "/newzt/components/StepBtns/StepBtns.html",
    },
  ];

  assert.deepEqual(filterLogEntries(logs, "/reqxml", "all", ""), [logs[0]]);
  assert.deepEqual(filterLogEntries(logs, ALL_LOG_TYPES, "all", ""), [logs[3], logs[2], logs[1], logs[0]]);
  assert.deepEqual(filterLogEntries(logs, ALL_LOG_TYPES, "error", "other"), [logs[1]]);
});

test("resolves a removed log type selection to all log types", () => {
  assert.equal(resolveLogTypeSelection("/api/data", ["/reqxml"]), ALL_LOG_TYPES);
  assert.equal(resolveLogTypeSelection("/reqxml", ["/reqxml"]), "/reqxml");
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
  const markup = renderSelectedLog('{"ok":true}');
  const responseHeading = [...markup.matchAll(/<div class="log-detail-section-heading">[\s\S]*?<\/div>/g)]
    .map(([heading]) => heading)
    .find((heading) => heading.includes("应答数据"));
  assert.ok(responseHeading);
  assert.match(responseHeading, /应答数据/);
  assert.match(responseHeading, /回填到 JSON 可视化/);
});

test("App keeps the selected log while navigating to JSON preview", async () => {
  const [appSource, panelSource] = await Promise.all([
    readFile("src/renderer/App.tsx", "utf8"),
    readFile("src/renderer/components/LogPanel.tsx", "utf8"),
  ]);

  assert.match(appSource, /const \[selectedLog, setSelectedLog\] = useState<LogEntry>\(\);/);
  assert.match(appSource, /<LogPanel logs=\{logs\} selected=\{selectedLog\} onSelect=\{setSelectedLog\}/);
  assert.match(panelSource, /onSelect\(entry\)/);
  assert.match(panelSource, /onCleared: \(\) => onSelect\(undefined\)/);
});
