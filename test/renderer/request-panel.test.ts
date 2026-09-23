import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseManualRequestPort } from "../../src/shared/manual-request";

test("navigation exposes the request page", async () => {
  const source = await readFile("src/renderer/App.tsx", "utf8");
  assert.match(source, /id: "request", label: "请求"/);
});

test("request page keeps IP, port, and pasted parameters and sends the request", async () => {
  const [source, styles] = await Promise.all([
    readFile("src/renderer/components/RequestPage.tsx", "utf8"),
    readFile("src/renderer/styles.css", "utf8"),
  ]);
  for (const label of ["目标 IP", "端口", "协议", "请求参数", "应答内容", "发送请求"]) assert.match(source, new RegExp(label));
  assert.doesNotMatch(source, /清空/);
  assert.match(source, /TZT TCP/);
  assert.match(source, /分号.*注释/);
  assert.match(source, /重复键.*最后/);
  assert.match(source, /复制应答数据/);
  assert.match(source, /navigator\.clipboard/);
  assert.match(source, /config\.request/);
  assert.match(source, /paramsText/);
  assert.match(source, /onBlur/);
  assert.match(source, /onSendRequest/);
  assert.match(source, /parseManualRequestParams/);
  assert.match(source, /<div className="response-actions">/);
  const responseActions = source.match(/<div className="response-actions">([\s\S]*?)<\/div>\s*<\/div>\s*<div className="response-code">/);
  assert.ok(responseActions, "response-actions should wrap the response metadata controls");
  assert.match(responseActions[1], /className="response-duration"/);
  assert.match(responseActions[1], /className="response-copy-actions"/);
  assert.match(source, /<span className="response-duration">耗时 \{response\?\.durationMs === undefined \? "—" : response\.durationMs\} ms<\/span>/);
  assert.match(styles, /\.request-card-heading\s*\{[^}]*flex-wrap:\s*wrap;/);
  assert.match(styles, /\.response-actions\s*\{[^}]*flex-wrap:\s*wrap;[^}]*gap:\s*14px;/);
  assert.match(styles, /\.response-copy-actions\s*\{[^}]*gap:\s*8px;/);
  assert.match(source, /className="select-control request-transport-select"/);
  assert.match(styles, /\.select-control\s*\{[^}]*appearance:\s*none;/);
  assert.match(styles, /\.select-control\s*\{[^}]*background-position:[^;}]*right 9px center/);
  const selectControlStyles = styles.match(/\.select-control\s*\{[^}]*\}/)?.[0];
  assert.ok(selectControlStyles, ".select-control should define shared select styles");
  assert.match(selectControlStyles, /border:\s*1px solid var\(--border-input\);/);
  assert.match(selectControlStyles, /border-radius:\s*8px;/);
  assert.match(selectControlStyles, /padding:\s*9px 34px 9px 10px;/);
  assert.match(selectControlStyles, /color:\s*var\(--text-primary\);/);
  assert.match(selectControlStyles, /background-color:\s*var\(--input-background\);/);
  assert.match(selectControlStyles, /background-image:\s*linear-gradient\(45deg, transparent 50%, currentColor 50%\),\s*linear-gradient\(135deg, currentColor 50%, transparent 50%\);/);
  assert.match(selectControlStyles, /background-position:\s*right 14px center,\s*right 9px center;/);
  assert.match(selectControlStyles, /background-repeat:\s*no-repeat;/);
  assert.match(selectControlStyles, /background-size:\s*5px 5px,\s*5px 5px;/);
  assert.match(selectControlStyles, /outline:\s*none;/);
  assert.match(selectControlStyles, /min-width:\s*0;/);
  assert.match(selectControlStyles, /max-width:\s*100%;/);
  assert.match(styles, /\.select-control:focus\s*\{[^}]*border-color:\s*var\(--border-selected\);[^}]*\}/);
  assert.match(styles, /\.select-control:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--focus-ring\);[^}]*\}/);
  assert.match(styles, /\.select-control:focus-visible\s*\{[^}]*outline-offset:\s*2px;[^}]*\}/);
  assert.match(styles, /\.filters\s*\{[^}]*min-width:\s*0;/);
  assert.match(styles, /\.filters\s*\{[^}]*max-width:\s*100%;/);
  assert.match(styles, /\.log-toolbar-actions\s*\{[^}]*min-width:\s*0;[^}]*max-width:\s*100%;/);
  assert.match(styles, /\.filters input\s*\{[^}]*min-width:\s*0;[^}]*max-width:\s*100%;/);
});

test("request port remains editable when its draft is cleared", async () => {
  const source = await readFile("src/renderer/components/RequestPage.tsx", "utf8");
  assert.equal(parseManualRequestPort(""), undefined);
  assert.equal(parseManualRequestPort("  "), undefined);
  assert.equal(parseManualRequestPort("6110"), 6110);
  assert.match(source, /const \[portText, setPortText\] = useState/);
  assert.match(source, /value=\{portText\}/);
  assert.match(source, /setPortText\(event\.target\.value\)/);
  assert.match(source, /parseManualRequestPort\(portText\)/);
  assert.doesNotMatch(source, /port: Number\(event\.target\.value\)/);
});

test("renderer does not repeat the selected tab title in the content area", async () => {
  const [appSource, requestSource] = await Promise.all([
    readFile("src/renderer/App.tsx", "utf8"),
    readFile("src/renderer/components/RequestPage.tsx", "utf8"),
  ]);
  assert.doesNotMatch(appSource, /<header className="topbar">/);
  assert.doesNotMatch(appSource, /控制中心/);
  assert.doesNotMatch(appSource, /content-toolbar/);
  assert.doesNotMatch(appSource, /address-chip/);
  assert.doesNotMatch(requestSource, /调试工具/);
  assert.doesNotMatch(requestSource, /<h2>请求<\/h2>/);
  assert.match(appSource, /request-page-content/);
});
