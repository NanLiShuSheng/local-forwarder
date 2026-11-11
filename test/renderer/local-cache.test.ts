import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { describeLocalCacheEntry, filterLocalCacheEntries, localCacheStats } from "../../src/renderer/local-cache-data";

test("renderer exposes local cache as a separate structured and editable tab", async () => {
  const [appSource, pageSource, cacheSource, styles] = await Promise.all([
    readFile("src/renderer/App.tsx", "utf8"),
    readFile("src/renderer/components/ConfigPages.tsx", "utf8"),
    readFile("src/renderer/components/LocalCachePage.tsx", "utf8"),
    readFile("src/renderer/styles.css", "utf8"),
  ]);

  assert.match(appSource, /\{ id: "local-cache", label: "本地缓存", icon: "cache" \}/);
  assert.match(appSource, /<LocalCachePage instanceId=\{selectedInstance\?\.id\} \/>/);
  assert.match(pageSource, /Page = .*"local-cache"/);
  assert.match(cacheSource, /window\.forwarder\.getMapValues\(instanceId\)/);
  assert.match(cacheSource, /window\.forwarder\.saveMapValues\(next, targetInstanceId\)/);
  assert.match(cacheSource, /formatLocalCacheText/);
  assert.match(cacheSource, /parseLocalCacheText\(text\)/);
  assert.match(cacheSource, /local-cache-workspace/);
  assert.match(cacheSource, /local-cache-key-row/);
  assert.match(cacheSource, /local-cache-code-shell/);
  assert.match(cacheSource, /onBlur=/);
  assert.match(cacheSource, /className="config-textarea local-cache-input"/);
  assert.doesNotMatch(cacheSource, /查看当前代理通过/);
  assert.doesNotMatch(cacheSource, /local-cache-instance/);
  assert.doesNotMatch(cacheSource, /local-cache-summary/);
  assert.doesNotMatch(cacheSource, /local-cache-shortcut-hint/);
  assert.match(styles, /\.local-cache-input[^\n]*white-space:\s*pre-wrap/);
  assert.match(styles, /\.local-cache-code-line[^\n]*font:/);
  assert.match(styles, /\.local-cache-key-row[^\n]*min-height:\s*40px/);
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
});

test("local cache page does not reuse the local variable page data source", async () => {
  const source = await readFile("src/renderer/components/LocalCachePage.tsx", "utf8");

  assert.doesNotMatch(source, /sharedValues/);
  assert.doesNotMatch(source, /loginCache/);
});

test("local cache page clears the selected proxy after a second confirmation", async () => {
  const [source, styles] = await Promise.all([
    readFile("src/renderer/components/LocalCachePage.tsx", "utf8"),
    readFile("src/renderer/styles.css", "utf8"),
  ]);

  assert.match(source, /const \[confirmingClear, setConfirmingClear\] = useState\(false\)/);
  assert.match(source, /className="local-cache-button danger"/);
  assert.match(source, /disabled=\{busy \|\| !loaded \|\| stats\.total === 0\}/);
  assert.match(source, /确定清空当前代理的全部本地缓存吗？其他端口不受影响，此操作不可撤销。/);
  assert.match(source, /await persistValues\(\{\}\)/);
  assert.match(source, /message: "本地缓存已清空"/);
  assert.match(styles, /\.local-cache-button\.danger[^\n]*var\(--danger-border\)/);
  assert.match(styles, /\.local-cache-dialog-overlay[^\n]*position:\s*fixed/);
});
