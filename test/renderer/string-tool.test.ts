import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { applyStringOperation } from "../../src/shared/string-tool";
import { getAppConfigValidationError } from "../../src/shared/validation";

test("applies the supported string editing operations", () => {
  assert.equal(applyStringOperation("action=100\naction=101", "replace", "action", "Action"), "Action=100\nAction=101");
  assert.equal(applyStringOperation("a-b-c", "remove", "-", ""), "abc");
  assert.equal(applyStringOperation("Abc", "uppercase", "", ""), "ABC");
  assert.equal(applyStringOperation("AbC", "lowercase", "", ""), "abc");
  assert.equal(applyStringOperation("中文/action", "url-encode", "", ""), "%E4%B8%AD%E6%96%87%2Faction");
  assert.equal(applyStringOperation("%E4%B8%AD%E6%96%87%2Faction", "url-decode", "", ""), "中文/action");
  assert.equal(applyStringOperation('{"a":1}', "json-format", "", ""), '{\n  "a": 1\n}');
});

test("validates and accepts persisted string tool state", () => {
  assert.equal(getAppConfigValidationError({
    server: { bindHost: "127.0.0.1", port: 8080, timeoutMs: 30000, loggingEnabled: true },
    httpRules: [],
    tcpTargets: [],
    localValues: {},
    mapValues: {},
    accounts: {},
    cache: { rootDir: "", downloadTarget: "", decryptEnabled: false, autoDownload: false },
    stringTool: { inputText: "abc", outputText: "ABC", operation: "uppercase", findText: "", replaceText: "" },
  }), undefined);
});

test("exposes the string tool as a tab without repeating its title in the page", async () => {
  const [appSource, pageSource] = await Promise.all([
    readFile("src/renderer/App.tsx", "utf8"),
    readFile("src/renderer/components/StringToolPage.tsx", "utf8"),
  ]);
  assert.match(appSource, /\{ id: "string", label: "字符串", icon: "string" \}/);
  assert.match(pageSource, /string-tool-panel/);
  assert.doesNotMatch(pageSource, /<h2>字符串工具<\/h2>/);
  assert.match(pageSource, /复制结果/);
  assert.match(pageSource, /className="secondary-button" onClick=\{\(\) => void clear\(\)\}>清空/);
  assert.match(pageSource, /<select className="select-control" value=\{draft\.operation\}/);
  assert.doesNotMatch(pageSource, /onBlur/);
});

test("keeps string processing independent from configuration persistence", async () => {
  const pageSource = await readFile("src/renderer/components/StringToolPage.tsx", "utf8");
  assert.doesNotMatch(pageSource, /onChange:\s*\(config/);
  assert.doesNotMatch(pageSource, /saveDraft/);
  assert.doesNotMatch(pageSource, /window\.forwarder\.saveConfig/);
  assert.match(pageSource, /setDraft\(next\)/);
  assert.doesNotMatch(pageSource, /配置未保存，请先停止服务/);
  assert.doesNotMatch(pageSource, /结果已生成，但配置未保存/);
});
