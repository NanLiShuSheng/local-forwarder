import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { IPC_CHANNELS, type RuntimeStatus } from "../../src/shared/contracts";

test("IPC channels expose stable runtime commands", () => {
  assert.deepEqual(IPC_CHANNELS, {
    getConfig: "config:get",
    getAppVersion: "app:version:get",
    getUpdateState: "update:state:get",
    checkForUpdates: "update:check",
    downloadUpdate: "update:download",
    installUpdate: "update:install",
    updateState: "update:state",
    saveConfig: "config:save",
    importLegacy: "config:import-legacy",
    exportConfig: "config:export",
    selectProjectDirectory: "config:select-project-directory",
    selectEncryptionDirectory: "encryption:select-directory",
    getEncryptionPreferences: "encryption:get-preferences",
    saveEncryptionPreferences: "encryption:save-preferences",
    encryptDirectory: "encryption:run",
    sendRequest: "request:send",
    listProxyInstances: "proxy-instances:list",
    selectProxyInstance: "proxy-instances:select",
    createProxyInstance: "proxy-instances:create",
    duplicateProxyInstance: "proxy-instances:duplicate",
    start: "runtime:start",
    stop: "runtime:stop",
    status: "runtime:status",
    logs: "runtime:logs",
    clearLogs: "runtime:logs:clear",
  });
  const status: RuntimeStatus = { state: "stopped", requestCount: 0, tcpConnections: 0 };
  assert.equal(status.state, "stopped");
});

test("update installation verifies that all proxy instances stopped", async () => {
  const source = await readFile("electron/main.ts", "utf8");
  assert.match(source, /function stopAllForUpdate/);
  assert.match(source, /manager\.list\(\)\.every\(\(instance\) => instance\.status\.state === "stopped"\)/);
});
