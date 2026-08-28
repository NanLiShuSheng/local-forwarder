import test from "node:test";
import assert from "node:assert/strict";
import { IPC_CHANNELS, type RuntimeStatus } from "../../src/shared/contracts";

test("IPC channels expose stable runtime commands", () => {
  assert.deepEqual(IPC_CHANNELS, {
    getConfig: "config:get",
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
  });
  const status: RuntimeStatus = { state: "stopped", requestCount: 0, tcpConnections: 0 };
  assert.equal(status.state, "stopped");
});
