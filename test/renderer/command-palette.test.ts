import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { CommandPalette, type WorkspaceCommand } from "../../src/renderer/components/WorkspaceChrome";

const commands: WorkspaceCommand[] = [
  { id: "workbench", label: "工作台", detail: "查看当前环境与运行状态", group: "页面", shortcut: "⌘1", run: () => undefined },
  { id: "logs", label: "日志", detail: "查看请求与系统事件", group: "页面", shortcut: "⌘5", run: () => undefined },
  { id: "start-all", label: "启动全部环境", detail: "启动所有已停止的代理实例", group: "操作", run: () => undefined },
];

test("command palette groups results once with spacious command rows", () => {
  const markup = renderToStaticMarkup(createElement(CommandPalette, { open: true, commands, onClose: () => undefined }));

  assert.equal((markup.match(/lf-command-section-title/g) ?? []).length, 2);
  assert.equal((markup.match(/lf-command-result /g) ?? []).length, 3);
  assert.match(markup, />页面</);
  assert.match(markup, />操作</);
  assert.match(markup, /aria-activedescendant="lf-command-option-0"/);
  assert.match(markup, /3 个结果/);
  assert.doesNotMatch(markup, /lf-command-group/);
});

test("command palette styles increase breathing room and truncate long descriptions", async () => {
  const styles = await readFile("src/renderer/styles.css", "utf8");

  assert.match(styles, /\.lf-command-dialog[^}]*width:\s*min\(660px/);
  assert.match(styles, /\.lf-command-result[^}]*min-height:\s*50px/);
  assert.match(styles, /\.lf-command-copy small[^}]*text-overflow:\s*ellipsis/);
  assert.match(styles, /\.lf-command-section-title[^}]*letter-spacing/);
});
