import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { UpdateSettingsPage } from "../../src/renderer/components/WorkspacePages";
import type { UpdateState } from "../../src/shared/contracts";
import { workspaceGroups } from "../../src/renderer/workspace-navigation";

function renderUpdatePage(updateState: UpdateState, appVersion = "1.0.0"): string {
  return renderToStaticMarkup(createElement(UpdateSettingsPage, {
    appVersion,
    updateState,
    onCheck: () => undefined,
    onDownload: () => undefined,
    onInstall: () => undefined,
    onCancel: () => undefined,
  }));
}

test("update settings page is the only global update surface", async () => {
  const [appSource, chromeSource] = await Promise.all([
    readFile("src/renderer/App.tsx", "utf8"),
    readFile("src/renderer/components/WorkspaceChrome.tsx", "utf8"),
  ]);

  assert.deepEqual(workspaceGroups.settings.items.map((item) => item.route), ["appearance", "update", "advanced"]);
  assert.match(appSource, /<PagePane active=\{route === "update"\}>[\s\S]*?<UpdateSettingsPage/);
  assert.doesNotMatch(appSource, /<UpdateCard/);
  assert.doesNotMatch(appSource, /<UpdateCancelDialog/);
  assert.doesNotMatch(chromeSource, /UpdateCard/);
});

test("update settings page exposes the current version and state-specific actions", () => {
  const idle = renderUpdatePage({ state: "idle", currentVersion: "1.0.0" });
  assert.match(idle, /Local Forwarder 1\.0\.0/);
  assert.match(idle, /检查更新/);
  assert.match(idle, /自动检查更新/);
  assert.match(idle, /下载完成后提示安装/);

  const checking = renderUpdatePage({ state: "checking", currentVersion: "1.0.0" });
  assert.match(checking, /正在检查更新/);
  assert.match(checking, /正在检查/);
  assert.match(checking, /disabled/);

  const available = renderUpdatePage({ state: "available", currentVersion: "1.0.0", update: { version: "1.1.0" } });
  assert.match(available, /发现新版本 1\.1\.0/);
  assert.match(available, /下载更新/);

  const downloading = renderUpdatePage({ state: "downloading", currentVersion: "1.0.0", update: { version: "1.1.0" }, progress: { percent: 42.4, transferred: 42, total: 100, bytesPerSecond: 1 } });
  assert.match(downloading, /正在下载 42%/);
  assert.match(downloading, /停止下载/);

  const downloaded = renderUpdatePage({ state: "downloaded", currentVersion: "1.0.0", update: { version: "1.1.0" } });
  assert.match(downloaded, /更新已下载，可以安装/);
  assert.match(downloaded, /安装更新/);

  const latest = renderUpdatePage({ state: "not-available", currentVersion: "1.0.0" });
  assert.match(latest, /当前已是最新版本/);
});

test("App wires update state loading, subscription cleanup, and settings actions", async () => {
  const app = await readFile("src/renderer/App.tsx", "utf8");
  assert.match(app, /getAppVersion\(\)/);
  assert.match(app, /getUpdateState\(\)/);
  assert.match(app, /onUpdateState/);
  assert.match(app, /unsubscribe\(\)/);
  assert.match(app, /const checkForUpdates = async \(\) => \{/);
  assert.match(app, /const downloadUpdate = async \(\) => \{/);
  assert.match(app, /const installUpdate = async \(\) => \{/);
  assert.match(app, /const stopUpdateDownload = async \(\) => \{/);
  assert.match(app, /window\.forwarder\.cancelUpdate\(\)/);
  assert.match(app, /<UpdateSettingsPage appVersion=\{appVersion \|\| updateState\.currentVersion\}/);
  assert.doesNotMatch(app, /readDismissedUpdateVersion|writeDismissedUpdateVersion/);
});

test("appearance page contains only appearance controls while update controls live in settings", async () => {
  const [appearance, updateSource, styles] = await Promise.all([
    readFile("src/renderer/components/AppearancePage.tsx", "utf8"),
    readFile("src/renderer/components/WorkspacePages.tsx", "utf8"),
    readFile("src/renderer/styles.css", "utf8"),
  ]);

  assert.match(appearance, /data-theme-option=\{option\.mode\}/);
  assert.match(appearance, /紧凑模式/);
  assert.doesNotMatch(appearance, /检查更新/);
  assert.doesNotMatch(appearance, /当前版本/);
  assert.match(updateSource, /export function UpdateSettingsPage/);
  assert.match(updateSource, /检查更新/);
  assert.match(updateSource, /停止下载/);
  assert.match(styles, /\.lf-version-card\s*\{/);
  assert.match(styles, /--accent:\s*#0f9f76/);
  assert.match(styles, /--accent:\s*#4d9375/);
});
