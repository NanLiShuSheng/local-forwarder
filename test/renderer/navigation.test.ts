import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("navigation hides forwarding rules and cache pages", async () => {
  const source = await readFile("src/renderer/App.tsx", "utf8");
  assert.doesNotMatch(source, /\{ id: "rules", label: "转发规则" \}/);
  assert.doesNotMatch(source, /\{ id: "cache", label: "缓存" \}/);
});
