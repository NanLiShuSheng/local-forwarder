import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("only the local download route enables macOS downloads", async () => {
  const [homeSource, routeSource, scriptSource] = await Promise.all([
    readFile("website/index.html", "utf8"),
    readFile("website/local/download/index.html", "utf8"),
    readFile("website/main.js", "utf8"),
  ]);

  assert.match(homeSource, /macOS · 暂不可用/);
  assert.doesNotMatch(homeSource, /data-download="mac-(?:x64|arm64)"/);

  assert.doesNotMatch(routeSource, /macOS · 暂不可用/);
  assert.match(routeSource, /data-download="mac-x64"/);
  assert.match(routeSource, /data-download="mac-arm64"/);

  assert.match(scriptSource, /mac-update\.json/);
  assert.match(scriptSource, /parseMacManifest/);
  assert.match(scriptSource, /data-download="mac-x64"/);
  assert.match(scriptSource, /data-download="mac-arm64"/);

  for (const source of [homeSource, routeSource]) {
    assert.match(source, /ICP备案号：/);
    assert.match(source, /浙ICP备2026103133号/);
    assert.match(source, /href="https:\/\/beian\.miit\.gov\.cn\/"/);
  }
});
