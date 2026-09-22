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
  assert.match(preload, /saveEncryptionPreferences/);
  assert.match(preload, /encryptDirectory/);
  assert.match(preload, /sendRequest/);
  assert.match(preload, /clearLogs/);
  assert.match(preload, /getAppVersion/);
  assert.match(preload, /getUpdateState/);
  assert.match(preload, /checkForUpdates/);
  assert.match(preload, /downloadUpdate/);
  assert.match(preload, /installUpdate/);
  assert.match(preload, /onUpdateState/);
  assert.match(preload, /getAppVersion: \(\) => (?:ipcRenderer|electron_1\.ipcRenderer)\.invoke\(IPC_CHANNELS\.getAppVersion\)/);
  assert.match(preload, /getUpdateState: \(\) => (?:ipcRenderer|electron_1\.ipcRenderer)\.invoke\(IPC_CHANNELS\.getUpdateState\)/);
  assert.match(preload, /checkForUpdates: \(\) => (?:ipcRenderer|electron_1\.ipcRenderer)\.invoke\(IPC_CHANNELS\.checkForUpdates\)/);
  assert.match(preload, /downloadUpdate: \(\) => (?:ipcRenderer|electron_1\.ipcRenderer)\.invoke\(IPC_CHANNELS\.downloadUpdate\)/);
  assert.match(preload, /installUpdate: \(\) => (?:ipcRenderer|electron_1\.ipcRenderer)\.invoke\(IPC_CHANNELS\.installUpdate\)/);
  assert.match(preload, /onUpdateState: \(listener\)[\s\S]*?(?:ipcRenderer|electron_1\.ipcRenderer)\.on\(IPC_CHANNELS\.updateState, handler\)[\s\S]*?return \(\) => (?:ipcRenderer|electron_1\.ipcRenderer)\.removeListener\(IPC_CHANNELS\.updateState, handler\)/);
});

test("compiled Electron entrypoints have no runtime dependency on shared contracts", () => {
  for (const entrypoint of ["main.js", "preload.js"]) {
    const compiled = fs.readFileSync(path.join(projectRoot, "dist-electron/electron", entrypoint), "utf8");
    assert.doesNotMatch(compiled, /src\/shared\/contracts/);
  }
});
