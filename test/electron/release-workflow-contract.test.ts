import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("release workflow builds and publishes Windows update assets", async () => {
  const workflow = await readFile(".github/workflows/release.yml", "utf8");

  assert.match(workflow, /tags:/);
  assert.match(workflow, /v\*/);
  assert.match(workflow, /contents:\s*write/);
  assert.match(workflow, /windows-latest/);
  assert.match(workflow, /package:release:win:x64/);
  assert.match(workflow, /needs:\s*build-windows/);
  assert.match(workflow, /dist\/Local-Forwarder-Setup-\*\.exe\.blockmap/);
  assert.match(workflow, /release-assets\/windows\/\*\.exe\.blockmap/);
  assert.match(workflow, /latest\.yml/);
  assert.match(workflow, /gh release create/);
  assert.doesNotMatch(workflow, /macos|latest-mac\.yml|MACOS_CERTIFICATE_/i);
});
