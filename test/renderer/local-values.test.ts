import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { splitH5StoreEntries } from "../../src/shared/local-cache";

test("splitH5StoreEntries routes keys back to their original store and new keys to files", () => {
  const result = splitH5StoreEntries({ "A.MAP": "1", "B.TXT": "2", NEW: "3" }, { "A.MAP": "0" }, { "B.TXT": "0" });
  assert.deepEqual(result, { mapValues: { "A.MAP": "1" }, fileValues: { "B.TXT": "2", NEW: "3" } });
});

test("splitH5StoreEntries deletes keys removed from the text", () => {
  assert.deepEqual(splitH5StoreEntries({}, { OLDMAP: "1" }, { "OLD.TXT": "2" }), { mapValues: {}, fileValues: {} });
});

test("local values page orders h5, login, local sections and all are editable", async () => {
  const source = await readFile("src/renderer/components/ConfigPages.tsx", "utf8");
  const localStart = source.indexOf('if (page === "local")');
  const valuesStart = source.indexOf('if (page === "values")');
  assert.ok(localStart >= 0 && valuesStart > localStart);
  const localPage = source.slice(localStart, valuesStart);
  const h5Index = localPage.indexOf('<p className="eyebrow">h5</p>');
  const loginIndex = localPage.indexOf('<p className="eyebrow">login</p>');
  const localIndex = localPage.indexOf('<p className="eyebrow">local</p>');
  assert.ok(h5Index >= 0 && loginIndex > h5Index && localIndex > loginIndex);
  assert.doesNotMatch(localPage, /readOnly/);
  assert.match(localPage, /H5 写入缓存/);
  assert.match(localPage, /登录缓存（登录后捕获）/);
  assert.match(localPage, /本地缓存（客户端读取）/);
});

test("all three sections save on change with editing guards", async () => {
  const source = await readFile("src/renderer/components/ConfigPages.tsx", "utf8");
  assert.match(source, /void saveH5Values\(event\.target\.value\)/);
  assert.match(source, /void saveLoginSectionValues\(event\.target\.value\)/);
  assert.match(source, /void saveLocalValues\(event\.target\.value\)/);
  assert.match(source, /splitH5StoreEntries\(parseLocalCacheText\(text\), mapValues, fileValues\)/);
  assert.match(source, /onFocus=\{\(\) => setH5Editing\(true\)\}/);
  assert.match(source, /onFocus=\{\(\) => setLoginEditing\(true\)\}/);
  assert.match(source, /onFocus=\{\(\) => setLocalEditing\(true\)\}/);
});

test("renderer subscribes to main-process value change pushes", async () => {
  const source = await readFile("src/renderer/App.tsx", "utf8");
  assert.match(source, /onValuesChanged/);
  assert.match(source, /setSharedValues\(values\.sharedValues\)/);
  assert.match(source, /setLoginCache\(values\.loginCache\)/);
});
