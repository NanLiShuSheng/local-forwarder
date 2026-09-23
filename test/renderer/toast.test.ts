import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { TOAST_DURATION_MS, toUserError } from "../../src/renderer/toast";

test("toast errors auto-hide after five seconds", () => {
  assert.equal(TOAST_DURATION_MS, 5000);
});

test("error toasts use an exclamation icon while the close control keeps its x", async () => {
  const source = await readFile("src/renderer/components/ToastProvider.tsx", "utf8");
  assert.match(source, /if \(kind === "error"\) return "!"/);
  assert.match(source, /className="toast-close"[\s\S]*?>×<\/button>/);
  assert.doesNotMatch(source, /if \(kind === "error"\) return "×"/);
});

test("translates address-in-use errors into one Chinese message", () => {
  const message = toUserError(new Error("EADDRINUSE: address already in use 127.0.0.1:8080"), "代理启动失败");
  assert.equal(message, "端口 8080 已被占用，请先释放该端口后重试");
  assert.doesNotMatch(message, /EADDRINUSE|address already in use/);
});

test("translates English configuration errors without leaking implementation text", () => {
  assert.equal(toUserError("stop the service before changing configuration", "配置保存失败"), "配置未保存，请先停止服务");
  assert.equal(toUserError("Invalid request payload: request.port", "请求失败"), "请求参数无效，请检查输入内容");
  assert.equal(toUserError("unexpected native failure", "操作失败"), "操作失败");
});

test("keeps Chinese domain errors readable", () => {
  assert.equal(toUserError("请按 hq、jy、zx 顺序填写地址", "地址配置无效"), "请按 hq、jy、zx 顺序填写地址");
});

test("falls back when a Chinese instance label is combined with an English failure", () => {
  const message = toUserError("默认代理：unexpected native failure", "一键开启失败");
  assert.equal(message, "一键开启失败");
  assert.doesNotMatch(message, /unexpected native failure/);
});

test("provider renders a fixed bottom-right live toast viewport", async () => {
  const [source, styles] = await Promise.all([
    readFile("src/renderer/components/ToastProvider.tsx", "utf8"),
    readFile("src/renderer/styles.css", "utf8"),
  ]);
  assert.match(source, /export function ToastProvider/);
  assert.match(source, /export function useToast/);
  assert.match(source, /aria-live="polite"/);
  assert.match(source, /window\.setTimeout/);
  assert.match(source, /TOAST_DURATION_MS/);
  assert.match(source, /aria-label="关闭提示"/);
  assert.match(styles, /\.toast-viewport\s*\{[^}]*position:\s*fixed;[^}]*right:\s*20px;[^}]*bottom:\s*20px;/);
});

test("toast cards keep an opaque themed surface outside the app shell", async () => {
  const styles = await readFile("src/renderer/styles.css", "utf8");
  assert.match(styles, /\.toast-viewport\s*\{[^}]*--toast-surface:/);
  assert.match(styles, /\.toast-card\s*\{[^}]*background:\s*var\(--toast-surface\)/);
  assert.match(styles, /\.app-shell\[data-theme="light"\]\s*~\s*\.toast-viewport\s*\{/);
  assert.match(styles, /\.app-shell\[data-theme="light"\][\s\S]*?--toast-surface:\s*#fff/);
});

test("repeated toast messages reuse the existing toast and timer", async () => {
  const source = await readFile("src/renderer/components/ToastProvider.tsx", "utf8");
  assert.match(source, /message === .*message|.*message === message/);
  assert.match(source, /clearTimeout/);
});

test("delegated IPC failures show one normalized toast without page error text", async () => {
  const [requestSource, pagesSource] = await Promise.all([
    readFile("src/renderer/components/RequestPage.tsx", "utf8"),
    readFile("src/renderer/components/ConfigPages.tsx", "utf8"),
  ]);
  assert.doesNotMatch(requestSource, /if \(!saved\) notifyError/);
  assert.doesNotMatch(requestSource, /复制失败：\$\{cause\.message\}/);
  assert.doesNotMatch(pagesSource, /if \(!saved\) notifyError/);
  assert.doesNotMatch(pagesSource, /notifyError\(result\.error \?\? "加密失败"/);
  assert.doesNotMatch(pagesSource, /失败：\$\{result\.error/);
  assert.doesNotMatch(pagesSource, /失败：\$\{message/);
});

test("mounted App content forwards runtime status errors to Toast", async () => {
  const source = await readFile("src/renderer/App.tsx", "utf8");
  assert.match(source, /status\.error/);
  assert.match(source, /notifyError\(status\.error, "代理运行失败"\)/);
});

test("operation errors use Toast instead of page-flow error boxes", async () => {
  const sources = await Promise.all([
    readFile("src/renderer/App.tsx", "utf8"),
    readFile("src/renderer/components/RuntimePanel.tsx", "utf8"),
    readFile("src/renderer/components/ConfigPages.tsx", "utf8"),
    readFile("src/renderer/components/ProxyInstancePanel.tsx", "utf8"),
    readFile("src/renderer/components/RequestPage.tsx", "utf8"),
    readFile("src/renderer/components/StringToolPage.tsx", "utf8"),
  ]);
  for (const source of sources) {
    assert.match(source, /notifyError|useToast/);
    assert.doesNotMatch(source, /<DismissibleError/);
  }
});
