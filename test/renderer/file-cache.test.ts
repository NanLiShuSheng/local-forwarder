import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { workspaceGroups } from "../../src/renderer/workspace-navigation";

test("unified data browser exposes reqsavefile viewing, adding, editing, deletion, and clearing", async () => {
  const [appSource, pageSource, styles] = await Promise.all([
    readFile("src/renderer/App.tsx", "utf8"),
    readFile("src/renderer/components/DataBrowserPage.tsx", "utf8"),
    readFile("src/renderer/styles.css", "utf8"),
  ]);

  assert.deepEqual(workspaceGroups.data.items.map((item) => item.route), ["session", "kv", "files", "variables"]);
  assert.deepEqual(workspaceGroups.data.items.map((item) => item.label), ["登录缓存", "本地缓存", "文件缓存", "工作区变量"]);
  assert.match(appSource, /const isDataRoute = route === "session" \|\| route === "kv" \|\| route === "files" \|\| route === "variables"/);
  assert.match(appSource, /<PagePane active=\{isDataRoute\}>[\s\S]*?<DataBrowserPage tab=\{dataTab\}/);
  assert.match(pageSource, /window\.forwarder\.getFileValues\(instanceId\)/);
  assert.match(pageSource, /window\.forwarder\.saveFileValue\(key, encodeFileCacheValue\(value\), instanceId\)/);
  assert.match(pageSource, /window\.forwarder\.deleteFileValue\(key, instanceId\)/);
  assert.match(pageSource, /window\.forwarder\.clearFileValues\(instanceId\)/);
  assert.match(pageSource, /decodeFileCacheValue\(entry\.value\)/);
  assert.match(pageSource, /decodeFileCacheValue\(selectedEntry\.value\)/);
  assert.match(pageSource, /files: "\/reqsavefile"/);
  assert.match(pageSource, /tab === "files" \? "\/reqsavefile"/);
  assert.match(pageSource, /文件缓存/);
  assert.match(pageSource, /搜索键名或值/);
  assert.match(pageSource, /编辑原文/);
  assert.match(pageSource, /添加并保存/);
  assert.match(pageSource, /删除此键/);
  assert.match(pageSource, /清空/);
  assert.match(pageSource, /确定清空当前数据分类吗？/);
  assert.match(styles, /\.lf-data-shell\s*\{/);
  assert.match(styles, /\.lf-detail-code\s*\{/);
});
