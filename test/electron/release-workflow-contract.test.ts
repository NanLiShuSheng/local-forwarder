import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("release workflow builds and publishes Windows and macOS update assets", async () => {
  const workflow = await readFile(".github/workflows/release.yml", "utf8");

  assert.match(workflow, /tags:/);
  assert.match(workflow, /v\*/);
  assert.match(workflow, /contents:\s*write/);
  assert.match(workflow, /windows-latest/);
  assert.match(workflow, /package:release:win:x64/);
  assert.match(workflow, /needs:\s*[\s\S]*build-windows[\s\S]*build-macos/);
  assert.match(workflow, /dist\/Local-Forwarder-Setup-\*\.exe\.blockmap/);
  assert.match(workflow, /release-assets\/windows\/\*\.exe\.blockmap/);
  assert.match(workflow, /latest\.yml/);
  assert.match(workflow, /macos-latest/);
  assert.match(workflow, /package:release:mac:x64-arm64/);
  assert.match(workflow, /release-assets\/macos\/\*\.dmg/);
  assert.match(workflow, /release-assets\/macos\/mac-update\.json/);
  assert.match(workflow, /gh release create/);
});
