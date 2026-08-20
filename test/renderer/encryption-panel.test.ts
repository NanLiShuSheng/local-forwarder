import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("navigation exposes the encryption page", async () => {
  const source = await readFile("src/renderer/App.tsx", "utf8");
  assert.match(source, /id: "encryption", label: "加密"/);
});

test("encryption page exposes two directory selectors and an execution action", async () => {
  const source = await readFile("src/renderer/components/ConfigPages.tsx", "utf8");
  for (const label of ["加密前文件夹目录", "加密后文件夹目录", "选择加密前目录", "选择加密后目录", "开始加密", "处理进度", "最近结果"]) {
    assert.match(source, new RegExp(label));
  }
  assert.match(source, /onSelectEncryptionDirectory/);
  assert.match(source, /onEncryptDirectory/);
  assert.match(source, /encryptionRunning/);
  assert.match(source, /disabled=\{encryptionRunning/);
});

test("encryption page has dedicated directory layout and status styling", async () => {
  const source = await readFile("src/renderer/styles.css", "utf8");
  assert.match(source, /\.encryption-directory-field/);
  assert.match(source, /\.encryption-status/);
  assert.match(source, /\.encryption-log/);
});
