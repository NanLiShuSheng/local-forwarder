import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { UpdateCancelDialog } from "../../src/renderer/components/UpdateCancelDialog";

test("update cancel dialog offers continue, hide, and stop choices", () => {
  const markup = renderToStaticMarkup(createElement(UpdateCancelDialog, {
    version: "1.1.0",
    busy: false,
    onContinue: () => undefined,
    onHide: () => undefined,
    onStop: () => undefined,
  }));

  assert.match(markup, /role="dialog"/);
  assert.match(markup, /aria-modal="true"/);
  assert.match(markup, /更新正在下载/);
  assert.match(markup, /版本 1\.1\.0/);
  assert.match(markup, /继续下载/);
  assert.match(markup, /仅隐藏窗口/);
  assert.match(markup, /停止更新/);
  assert.match(markup, /隐藏窗口不会停止下载/);
});

test("App prompts before hiding an active download and wires cancellation", async () => {
  const app = await readFile("src/renderer/App.tsx", "utf8");
  assert.match(app, /UpdateCancelDialog/);
  assert.match(app, /cancelUpdate/);
  assert.match(app, /updateDismissPrompt/);
  assert.match(app, /hiddenDownloadVersion/);
  assert.match(app, /hiddenDuringDownloadVersion/);
  assert.match(app, /state === "downloading"/);
});

test("cancel dialog is layered above the persistent update card", async () => {
  const styles = await readFile("src/renderer/styles.css", "utf8");
  assert.match(styles, /\.update-cancel-overlay[^\{]*\{[^}]*position:\s*fixed/);
  assert.match(styles, /\.update-cancel-overlay[^\{]*\{[^}]*z-index:\s*100/);
});
