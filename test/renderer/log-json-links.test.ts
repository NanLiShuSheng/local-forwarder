import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LogPanel } from "../../src/renderer/components/LogPanel";
import { ActivityPage, RequestHistoryPage } from "../../src/renderer/components/WorkspacePages";
import { WorkspaceDock } from "../../src/renderer/components/WorkspaceChrome";
import type { LogEntry } from "../../src/shared/contracts";

const responseLog: LogEntry = {
  timestamp: "2026-11-23T10:00:00.000Z",
  level: "info",
  message: "POST /reqxml",
  direction: "outbound",
  protocol: "http",
  statusCode: 200,
  durationMs: 18,
  requestType: "http",
  requestPath: "/reqxml",
  requestParams: "POST /reqxml\n\nAction=49055&serviceId=esb.wwygt.zhcx.cxzjzhxx",
  responseData: '{"ERRORNO":"0"}',
};

function renderActivity(entry: LogEntry): string {
  return renderToStaticMarkup(createElement(ActivityPage, {
    logs: [entry],
    instanceName: "测试环境",
    onClear: async () => true,
    onInspect: () => undefined,
    onFillJson: () => undefined,
  }));
}

test("every log surface links response data to JSON visualization", () => {
  const activity = renderActivity(responseLog);
  assert.match(activity, /JSON 可视化/);

  const history = renderToStaticMarkup(createElement(RequestHistoryPage, {
    logs: [responseLog],
    instanceName: "测试环境",
    onInspect: () => undefined,
    onFillJson: () => undefined,
    onOpenDebug: () => undefined,
  }));
  assert.match(history, /JSON 可视化/);

  const panel = renderToStaticMarkup(createElement(LogPanel, {
    logs: [responseLog],
    selected: responseLog,
    onSelect: () => undefined,
    onClear: async () => true,
    onFillJson: () => undefined,
  }));
  assert.match(panel, /JSON 可视化/);

  const dock = renderToStaticMarkup(createElement(WorkspaceDock, {
    logs: [responseLog],
    selected: responseLog,
    tab: "request",
    onTabChange: () => undefined,
    onSelectLog: () => undefined,
    onClear: () => undefined,
    onClose: () => undefined,
    onFillJson: () => undefined,
  }));
  assert.match(dock, /JSON 可视化/);
});

test("log surfaces hide the JSON action when no response body exists", () => {
  const entry = { ...responseLog, responseData: "" };
  assert.doesNotMatch(renderActivity(entry), /class="lf-text-button"[^>]*>JSON 可视化/);
});

test("log surfaces label reqxml rows with the action and service id like the legacy client", () => {
  const expected = /reqxml\/<span class="log-request-action">49055<\/span>\/esb\.wwygt\.zhcx\.cxzjzhxx/;
  assert.match(renderActivity(responseLog), expected);

  const history = renderToStaticMarkup(createElement(RequestHistoryPage, {
    logs: [responseLog],
    instanceName: "测试环境",
    onInspect: () => undefined,
    onFillJson: () => undefined,
    onOpenDebug: () => undefined,
  }));
  assert.match(history, expected);

  const dock = renderToStaticMarkup(createElement(WorkspaceDock, {
    logs: [responseLog],
    selected: responseLog,
    tab: "request",
    onTabChange: () => undefined,
    onSelectLog: () => undefined,
    onClear: () => undefined,
    onClose: () => undefined,
    onFillJson: () => undefined,
  }));
  assert.match(dock, expected);
  assert.doesNotMatch(renderActivity(responseLog), /HTTP \/reqxml/);
});

test("App routes every log JSON action through the shared JSON prefill and closes the console", async () => {
  const source = await readFile("src/renderer/App.tsx", "utf8");
  assert.match(source, /<ActivityPage logs=\{logs\}[\s\S]*?onFillJson=\{fillJsonPreview\}/);
  assert.match(source, /<RequestHistoryPage logs=\{logs\}[\s\S]*?onFillJson=\{fillJsonPreview\}/);
  assert.match(source, /<WorkspaceDock logs=\{logs\}[\s\S]*?onFillJson=\{fillJsonPreview\}/);
  assert.match(source, /const fillJsonPreview = \(text: string\) => \{[\s\S]*?setJsonPrefill\(responseTextToJsonPreview\(text\)\);[\s\S]*?setDockOpen\(false\);[\s\S]*?navigate\("json"\);/);
});
