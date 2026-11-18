import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("renderer exposes reqsavefile cache viewing, adding, editing, deletion, and clearing", async () => {
  const [appSource, pageSource, pagesSource] = await Promise.all([
    readFile("src/renderer/App.tsx", "utf8"),
    readFile("src/renderer/components/FileCachePage.tsx", "utf8"),
    readFile("src/renderer/components/ConfigPages.tsx", "utf8"),
  ]);

  assert.match(appSource, /\{ id: "file-cache", label: "文件缓存", icon: "file" \}/);
  assert.match(appSource, /<FileCachePage instanceId=\{selectedInstance\?\.id\} \/>/);
  assert.match(pagesSource, /Page = .*"file-cache"/);
  assert.match(pageSource, /window\.forwarder\.getFileValues\(instanceId\)/);
  assert.match(pageSource, /window\.forwarder\.saveFileValue\(key, persistedValue, targetInstanceId\)/);
  assert.match(pageSource, /encodeFileCacheValue\(value\)/);
  assert.match(pageSource, /effectiveViewMode === "formatted" \? selectedEntry\.formatted : encodeFileCacheValue\(selectedEntry\.value\)/);
  assert.match(pageSource, /setDraft\(encodeFileCacheValue\(selectedEntry\.value\)\)/);
  assert.match(pageSource, /copyTextToClipboard\(encodeFileCacheValue\(selectedEntry\.value\)\)/);
  assert.match(pageSource, /window\.forwarder\.deleteFileValue\(selectedEntry\.key, targetInstanceId\)/);
  assert.match(pageSource, /window\.forwarder\.clearFileValues\(targetInstanceId\)/);
  assert.match(pageSource, /<h2>文件缓存<\/h2>/);
  assert.match(pageSource, /<h2>文件缓存<\/h2>\s*<span className="local-cache-api-pill">\/reqsavefile<\/span>/);
  assert.doesNotMatch(pageSource, /\/reqsavefile · \{stats\.total\} 个文件/);
  assert.match(pageSource, /搜索文件缓存/);
  assert.match(pageSource, /新增文件缓存/);
  assert.match(pageSource, /添加并保存/);
  assert.match(pageSource, /编辑原文/);
  assert.doesNotMatch(pageSource, /文本模式/);
  assert.doesNotMatch(pageSource, /转 JSON\.stringify/);
  assert.doesNotMatch(pageSource, /formatSaveFileMesg/);
  assert.match(pageSource, /local-cache-value-editor/);
  assert.match(pageSource, /删除此文件缓存/);
  assert.match(pageSource, /清空文件缓存/);
  assert.match(pageSource, /文件缓存已清空/);
  assert.match(pageSource, /dirtyRef\.current \|\| interactingRef\.current/);
});
