import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "../..");

test("compiled sandbox preload has no runtime dependency on shared contracts", () => {
  const preloadPath = path.join(projectRoot, "dist-electron/electron/preload.js");
  assert.equal(fs.existsSync(preloadPath), true);
  const preload = fs.readFileSync(preloadPath, "utf8");
  assert.doesNotMatch(preload, /src\/shared\/contracts/);
  assert.doesNotMatch(preload, /require\([^)]*contracts/);
  assert.match(preload, /selectProjectDirectory/);
  assert.match(preload, /selectEncryptionDirectory/);
  assert.match(preload, /encryptDirectory/);
});

test("compiled Electron entrypoints have no runtime dependency on shared contracts", () => {
  for (const entrypoint of ["main.js", "preload.js"]) {
    const compiled = fs.readFileSync(path.join(projectRoot, "dist-electron/electron", entrypoint), "utf8");
    assert.doesNotMatch(compiled, /src\/shared\/contracts/);
  }
});
