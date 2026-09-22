import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import type { UpdateState } from "../../src/shared/contracts";
import { UpdateCard } from "../../src/renderer/components/UpdateCard";

const callbacks = { onDownload: () => undefined, onInstall: () => undefined, onDismiss: () => undefined };

function renderCard(state: UpdateState): string {
  return renderToStaticMarkup(createElement(UpdateCard, { state, ...callbacks }));
}

test("update card exposes download and install actions", async () => {
  const source = await readFile("src/renderer/components/UpdateCard.tsx", "utf8").catch(() => "");
  assert.match(source, /下载更新/);
  assert.match(source, /立即重启更新/);
  assert.match(source, /稍后更新/);
  assert.match(source, /下载进度/);
});

test("update card renders state-specific actions and bounded progress semantics", () => {
  const available = renderCard({ state: "available", currentVersion: "1.0.0", update: { version: "1.1.0" } });
  assert.match(available, /发现新版本/);
  assert.match(available, /版本 1\.0\.0 → 1\.1\.0/);
  assert.match(available, /下载更新/);
  assert.match(available, /稍后更新/);
  assert.doesNotMatch(available, /立即重启更新/);

  const downloading = renderCard({
    state: "downloading",
    currentVersion: "1.0.0",
    update: { version: "1.1.0" },
    progress: { percent: Number.NaN, transferred: 20, total: 100, bytesPerSecond: 10 },
  });
  assert.match(downloading, /disabled/);
  assert.match(downloading, /aria-valuenow="0"/);
  assert.match(downloading, /正在下载更新 0%/);

  const downloaded = renderCard({ state: "downloaded", currentVersion: "1.0.0", update: { version: "1.1.0" } });
  assert.match(downloaded, /更新已下载/);
  assert.match(downloaded, /立即重启更新/);
  assert.match(downloaded, /稍后更新/);
  assert.doesNotMatch(downloaded, /下载更新/);
});

test("update card keeps update errors localized and uses the fixed download action", () => {
  const error = renderCard({ state: "error", currentVersion: "1.0.0", update: { version: "1.1.0" }, error: "GitHub request failed" });
  assert.match(error, /更新操作失败，请重试/);
  assert.doesNotMatch(error, /GitHub request failed/);
  assert.match(error, /下载更新/);
  assert.doesNotMatch(error, /重新下载/);
});

test("update card is persistent and visually separated from five-second toasts", async () => {
  const source = await readFile("src/renderer/components/UpdateCard.tsx", "utf8").catch(() => "");
  const styles = await readFile("src/renderer/styles.css", "utf8");
  const app = await readFile("src/renderer/App.tsx", "utf8");
  assert.match(app, /UpdateCard/);
  assert.match(styles, /\.update-card[^\{]*\{[^}]*position:\s*fixed/);
  assert.match(styles, /\.update-card[^\{]*\{[^}]*bottom:\s*88px/);
  assert.match(styles, /\.update-card[^\{]*\{[^}]*background:/);
  assert.match(styles, /--update-background/);
  assert.match(styles, /@media \(max-width: 600px\)[^}]*\.update-card/);
  assert.doesNotMatch(source, /TOAST_DURATION_MS/);
});

test("appearance page exposes current version and manual check", async () => {
  const source = await readFile("src/renderer/components/AppearancePage.tsx", "utf8");
  assert.match(source, /当前版本/);
  assert.match(source, /检查更新/);
});
