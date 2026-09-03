import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("navigation hides forwarding rules and cache pages", async () => {
  const source = await readFile("src/renderer/App.tsx", "utf8");
  assert.doesNotMatch(source, /\{ id: "rules", label: "转发规则" \}/);
  assert.doesNotMatch(source, /\{ id: "cache", label: "缓存" \}/);
});

test("sidebar navigation removes the visible feature heading without changing its accessible name", async () => {
  const source = await readFile("src/renderer/App.tsx", "utf8");
  const styles = await readFile("src/renderer/styles.css", "utf8");

  assert.match(source, /<nav className="sidebar-nav" aria-label="功能导航">/);
  assert.doesNotMatch(source, /<span className="sidebar-nav-label">功能<\/span>/);
  assert.match(styles, /\.sidebar-nav::before/);
});
