import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("update card exposes download and install actions", async () => {
  const source = await readFile("src/renderer/components/UpdateCard.tsx", "utf8").catch(() => "");
  assert.match(source, /下载更新/);
  assert.match(source, /立即重启更新/);
  assert.match(source, /稍后更新/);
  assert.match(source, /下载进度/);
});

test("update card is persistent and visually separated from five-second toasts", async () => {
  const source = await readFile("src/renderer/components/UpdateCard.tsx", "utf8").catch(() => "");
  const styles = await readFile("src/renderer/styles.css", "utf8");
  const app = await readFile("src/renderer/App.tsx", "utf8");
  assert.match(app, /UpdateCard/);
  assert.match(styles, /\.update-card[^\{]*\{[^}]*position:\s*fixed/);
  assert.match(styles, /\.update-card[^\{]*\{[^}]*bottom:\s*88px/);
  assert.match(styles, /\.update-card[^\{]*\{[^}]*background:/);
  assert.doesNotMatch(source, /TOAST_DURATION_MS/);
});

test("appearance page exposes current version and manual check", async () => {
  const source = await readFile("src/renderer/components/AppearancePage.tsx", "utf8");
  assert.match(source, /当前版本/);
  assert.match(source, /检查更新/);
});
