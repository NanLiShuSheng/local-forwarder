import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { encodeFileCacheValue } from "../../src/shared/file-cache-value";
import { describeLocalCacheEntry, filterLocalCacheEntries, localCacheStats } from "../../src/renderer/local-cache-data";
import { localVariableLabel } from "../../src/renderer/local-variable-data";

test("unified data browser exposes key-value cache as a structured and editable tab", async () => {
  const [appSource, pageSource, styles] = await Promise.all([
    readFile("src/renderer/App.tsx", "utf8"),
    readFile("src/renderer/components/DataBrowserPage.tsx", "utf8"),
    readFile("src/renderer/styles.css", "utf8"),
  ]);

  assert.match(appSource, /const dataTab = route === "session" \|\| route === "kv" \|\| route === "files" \|\| route === "variables" \? route : "session"/);
  assert.match(appSource, /<DataBrowserPage tab=\{dataTab\} selectedInstance=\{selectedInstance\}/);
  assert.doesNotMatch(appSource, /<LocalCachePage/);
  assert.match(pageSource, /window\.forwarder\.getMapValues\(instanceId\)/);
  assert.match(pageSource, /tab === "kv" \? "\/reqsavemap"/);
  assert.match(pageSource, /window\.forwarder\.saveMapValues\(next, instanceId\)/);
  assert.match(pageSource, /formatLocalCacheText\(next\)/);
  assert.match(pageSource, /parseLocalCacheText\(text\)/);
  assert.match(pageSource, /className="[^"]*lf-data-shell"/);
  assert.match(pageSource, /className="lf-data-tabs"/);
  assert.match(pageSource, /className=\{`lf-data-row/);
  assert.match(pageSource, /className="lf-detail-code"/);
  assert.match(pageSource, /pageMode === "text"/);
  assert.match(pageSource, /结构化/);
  assert.match(pageSource, /文本/);
  assert.match(styles, /\.lf-data-shell\s*\{/);
  assert.match(styles, /\.lf-data-row\.active\s*\{/);
  assert.match(styles, /\.lf-detail-code\s*\{/);
});

test("recognizes JSON, empty, and plain text cache values", () => {
  const objectValue = describeLocalCacheEntry("OBJECT", '{"name":"test","count":2}');
  assert.equal(objectValue.kind, "json-object");
  assert.equal(objectValue.label, "JSON 对象");
  assert.equal(objectValue.formatted, '{\n  "name": "test",\n  "count": 2\n}');
  assert.equal(objectValue.isJson, true);

  const arrayValue = describeLocalCacheEntry("ARRAY", '["one","two"]');
  assert.equal(arrayValue.kind, "json-array");
  assert.equal(arrayValue.label, "JSON 数组");
  assert.equal(arrayValue.formattedLines, 4);

  const plainValue = describeLocalCacheEntry("PLAIN", "6.03.039");
  assert.equal(plainValue.kind, "text");
  assert.equal(plainValue.formatted, "6.03.039");
  assert.equal(plainValue.isJson, false);

  const emptyValue = describeLocalCacheEntry("EMPTY", "");
  assert.equal(emptyValue.kind, "empty");
  assert.equal(emptyValue.label, "空值");
  assert.equal(emptyValue.preview, "空值");
});

test("decodes percent-encoded file cache values for formatted display and search", () => {
  const encoded = encodeFileCacheValue('{"name":"中文","count":2}');
  const entry = describeLocalCacheEntry("ENCODED", encoded);

  assert.equal(encoded, "%7B%22name%22:%22%E4%B8%AD%E6%96%87%22,%22count%22:2%7D");
  assert.equal(entry.value, encoded);
  assert.equal(entry.isJson, true);
  assert.equal(entry.formatted, '{\n  "name": "中文",\n  "count": 2\n}');
  assert.equal(entry.preview, '{"name":"中文","count":2}');
  assert.deepEqual(filterLocalCacheEntries({ ENCODED: encoded }, "中文", "all").map((item) => item.key), ["ENCODED"]);
});

test("filters cache entries by query and value type", () => {
  const values = {
    FIRST: '{"name":"first"}',
    SECOND: "",
    THIRD: "plain text",
    FOURTH: '["one","two"]',
    FIFTH: "x".repeat(2000),
  };

  assert.deepEqual(filterLocalCacheEntries(values, "", "all").map((entry) => entry.key), ["FIRST", "SECOND", "THIRD", "FOURTH", "FIFTH"]);
  assert.deepEqual(filterLocalCacheEntries(values, "", "value").map((entry) => entry.key), ["FIRST", "THIRD", "FOURTH", "FIFTH"]);
  assert.deepEqual(filterLocalCacheEntries(values, "", "empty").map((entry) => entry.key), ["SECOND"]);
  assert.deepEqual(filterLocalCacheEntries(values, "", "json").map((entry) => entry.key), ["FIRST", "FOURTH"]);
  assert.deepEqual(filterLocalCacheEntries(values, "plain", "all").map((entry) => entry.key), ["THIRD"]);
  assert.deepEqual(localCacheStats(values), { total: 5, nonEmpty: 4, empty: 1, json: 2, long: 1 });
  assert.deepEqual(
    filterLocalCacheEntries({ MOBILECODE: "17000000000", CUSTOM: "custom" }, "手机号", "all", localVariableLabel).map((entry) => entry.key),
    ["MOBILECODE"],
  );
});

test("data browser keeps cache and workspace variable loaders separate", async () => {
  const source = await readFile("src/renderer/components/DataBrowserPage.tsx", "utf8");

  assert.match(source, /tab === "kv"[\s\S]*?\? await window\.forwarder\.getMapValues\(instanceId\)/);
  assert.match(source, /tab === "files"[\s\S]*?await window\.forwarder\.getFileValues\(instanceId\)[\s\S]*?: await window\.forwarder\.getSharedValues\(\)/);
  assert.match(source, /window\.forwarder\.saveSharedValues\(next\)/);
});

test("data browser confirms a destructive clear and clears file caches through the dedicated API", async () => {
  const [source, styles] = await Promise.all([
    readFile("src/renderer/components/DataBrowserPage.tsx", "utf8"),
    readFile("src/renderer/styles.css", "utf8"),
  ]);

  assert.match(source, /window\.confirm\("确定清空当前数据分类吗？此操作不可撤销。"\)/);
  assert.match(source, /window\.forwarder\.clearFileValues\(instanceId\)/);
  assert.match(source, /notify\(\{ kind: "success", message: "数据已清空" \}\)/);
  assert.match(source, /disabled=\{busy \|\| stats\.total === 0\}/);
  assert.match(styles, /\.lf-btn\.danger\s*\{[^}]*color:\s*var\(--danger\)/);
});

test("data browser keeps long values scrolling inside the detail pane", async () => {
  const [source, styles] = await Promise.all([
    readFile("src/renderer/components/DataBrowserPage.tsx", "utf8"),
    readFile("src/renderer/styles.css", "utf8"),
  ]);

  assert.match(source, /<pre className="lf-detail-code">/);
  assert.match(styles, /\.lf-data-workspace\s*\{[^}]*height:\s*456px[^}]*\}/);
  assert.match(styles, /\.lf-data-detail\s*\{[^}]*height:\s*100%[^}]*overflow:\s*hidden[^}]*\}/);
  assert.match(styles, /\.lf-detail-code\s*\{[^}]*overflow:\s*auto[^}]*\}/);
});

test("data rows hide plain-text and empty badges and keep meaningful badges inline", async () => {
  const [source, styles] = await Promise.all([
    readFile("src/renderer/components/DataBrowserPage.tsx", "utf8"),
    readFile("src/renderer/styles.css", "utf8"),
  ]);

  assert.match(source, /function DataTypeBadge\(\{ entry \}: \{ entry: LocalCacheEntry \}\)/);
  assert.match(source, /entry\.kind === "empty" \|\| badge\.className === "text"\) return null/);
  assert.match(source, /<span className="lf-row-key-line"><span className="lf-row-key">\{entry\.key\}<\/span><DataTypeBadge entry=\{entry\} \/><VariableLabelBadge label=\{variableLabel\} \/><\/span>/);
  assert.match(source, /entry\.kind !== "empty" && <span className="lf-row-preview">/);
  assert.doesNotMatch(styles, /\.lf-data-row > \.lf-type-badge/);
  assert.match(styles, /\.lf-data-row\s*\{[^}]*gap:\s*2px 8px[^}]*padding:\s*7px 11px/);
});

test("cache editors keep the green focus ring inside the clipped detail pane", async () => {
  const styles = await readFile("src/renderer/styles.css", "utf8");

  assert.match(styles, /\.lf-app \.lf-data-editor:focus-visible,\s*\n\.lf-app \.lf-data-text-panel textarea:focus-visible\s*\{[^}]*outline:\s*none[^}]*box-shadow:\s*inset 0 0 0 2px var\(--accent\)/);
});
