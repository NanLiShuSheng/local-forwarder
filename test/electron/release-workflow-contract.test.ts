import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("release workflow builds signed platform assets and publishes a GitHub Release", async () => {
  const workflow = await readFile(".github/workflows/release.yml", "utf8");

  assert.match(workflow, /tags:/);
  assert.match(workflow, /v\*/);
  assert.match(workflow, /contents:\s*write/);
  assert.match(workflow, /windows-latest/);
  assert.match(workflow, /macos-13/);
  assert.match(workflow, /package:release:win:x64/);
  assert.match(workflow, /package:release:mac:x64/);
  assert.match(workflow, /latest\.yml/);
  assert.match(workflow, /latest-mac\.yml/);
  assert.match(workflow, /MACOS_CERTIFICATE_BASE64/);
  assert.match(workflow, /gh release create/);
});
