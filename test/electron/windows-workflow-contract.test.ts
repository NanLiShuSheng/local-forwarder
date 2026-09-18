import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Windows workflow builds and uploads the x64 package", async () => {
  const workflow = await readFile(".github/workflows/windows.yml", "utf8");
  const resourceSmoke = await readFile("scripts/smoke-win-resources.mjs", "utf8");

  assert.match(workflow, /windows-latest/);
  assert.match(workflow, /npm ci/);
  assert.match(workflow, /npm test/);
  assert.match(workflow, /npm run build/);
  assert.match(workflow, /npm run package:win:x64/);
  assert.match(workflow, /node scripts\/smoke-win-resources\.mjs/);
  assert.match(workflow, /npx tsx --test test\/core\/runtime\/port-recovery\.windows\.test\.ts/);
  assert.match(workflow, /dist\/\*\.exe/);
  assert.match(workflow, /dist\/win-unpacked/);
  assert.match(resourceSmoke, /win-unpacked/);
  assert.match(resourceSmoke, /h5encode-win-x86\.exe/);
  assert.match(resourceSmoke, /node\.exe/);
  assert.match(resourceSmoke, /v16\.13\.0/);
  assert.match(resourceSmoke, /tzt-node16-helper\.js/);
  assert.match(resourceSmoke, /gunzipSync/);
});
