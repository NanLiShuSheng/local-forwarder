import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseManualRequestPort } from "../../src/shared/manual-request";
import { workspaceGroups } from "../../src/renderer/workspace-navigation";

test("workspace navigation places request debugging under the workbench and removes request history", () => {
  assert.deepEqual(workspaceGroups.run.items.map((item) => item.route), ["workbench", "debug", "activity"]);
  assert.deepEqual(workspaceGroups.run.items.map((item) => item.label), ["工作台", "请求调试", "活动"]);
  assert.equal("debug" in workspaceGroups, false);
  assert.doesNotMatch(JSON.stringify(workspaceGroups), /请求历史/);
});

test("request page keeps endpoint fields, parameters and responses in the new workspace layout", async () => {
  const [source, styles] = await Promise.all([
    readFile("src/renderer/components/RequestPage.tsx", "utf8"),
    readFile("src/renderer/styles.css", "utf8"),
  ]);
  for (const label of ["目标主机", "端口", "协议", "请求参数", "应答内容", "发送请求", "TZT TCP", "HTTP /reqxml"]) {
    assert.match(source, new RegExp(label));
  }
  assert.match(source, /className="lf-request-workspace"/);
  assert.match(source, /className="lf-panel lf-endpoint-bar"/);
  assert.match(source, /className="lf-btn primary lf-send-button"/);
  assert.match(source, /className="lf-debug-grid"/);
  assert.match(source, /className="lf-response-banner"/);
  assert.match(source, /config\.request/);
  assert.match(source, /paramsText/);
  assert.match(source, /onBlur/);
  assert.match(source, /onSendRequest/);
  assert.match(source, /parseManualRequestParams/);
  assert.match(source, /onFillJson\(responseBody\)/);
  assert.match(source, /回填到 JSON 可视化/);
  assert.match(source, /if \(!active\) return;/);
  assert.match(styles, /\.lf-endpoint-bar\s*\{[^}]*display:\s*grid;/);
  assert.match(styles, /\.lf-debug-grid\s*\{[^}]*grid-template-columns:/);
  assert.match(styles, /\.lf-app \.lf-request-textarea:focus\s*\{[^}]*box-shadow:\s*inset 0 0 0 2px var\(--accent\)/);
  assert.match(styles, /\.lf-btn\.primary\s*\{[^}]*background:\s*var\(--button-primary-background\)/);
  assert.match(styles, /@media \(max-width: 820px\)[\s\S]*?\.lf-debug-view \.request-endpoint/);
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

test("workspace header owns the page title instead of repeating it inside the request page", async () => {
  const [appSource, requestSource] = await Promise.all([
    readFile("src/renderer/App.tsx", "utf8"),
    readFile("src/renderer/components/RequestPage.tsx", "utf8"),
  ]);
  assert.match(appSource, /<WorkspacePageHeader eyebrow="Runtime · Request" title="请求调试"/);
  assert.doesNotMatch(appSource, /请求历史/);
  assert.doesNotMatch(requestSource, /<WorkspacePageHeader/);
  assert.doesNotMatch(requestSource, /<h1>/);
  assert.doesNotMatch(appSource, /<header className="topbar">/);
});
