import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Windows workflow builds and uploads the x64 package", async () => {
  const workflow = await readFile(".github/workflows/windows.yml", "utf8");

  assert.match(workflow, /windows-latest/);
  assert.match(workflow, /npm ci/);
  assert.match(workflow, /npm test/);
  assert.match(workflow, /npm run build/);
  assert.match(workflow, /npm run package:win:x64/);
  assert.match(workflow, /dist\/\*\.exe/);
  assert.match(workflow, /dist\/win-unpacked/);
});
