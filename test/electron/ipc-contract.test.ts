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
    getSharedValues: "values:shared:get",
    saveSharedValues: "values:shared:save",
    getLoginCache: "values:login:get",
    saveLoginCache: "values:login:save",
    selectProjectDirectory: "config:select-project-directory",
    selectEncryptionDirectory: "encryption:select-directory",
    getEncryptionPreferences: "encryption:get-preferences",
    saveEncryptionPreferences: "encryption:save-preferences",
    encryptDirectory: "encryption:run",
    encryptionProgress: "encryption:progress",
    sendRequest: "request:send",
    listProxyInstances: "proxy-instances:list",
    selectProxyInstance: "proxy-instances:select",
    createProxyInstance: "proxy-instances:create",
    duplicateProxyInstance: "proxy-instances:duplicate",
    renameProxyInstance: "proxy-instances:rename",
    deleteProxyInstance: "proxy-instances:delete",
    start: "runtime:start",
    stop: "runtime:stop",
    startAll: "runtime:start-all",
    stopAll: "runtime:stop-all",
    status: "runtime:status",
    logs: "runtime:logs",
    clearLogs: "runtime:logs:clear",
  });
  const status: RuntimeStatus = { state: "stopped", requestCount: 0, tcpConnections: 0 };
  assert.equal(status.state, "stopped");
});

test("update installation verifies that all proxy instances stopped", async () => {
  const source = await readFile("electron/main.ts", "utf8");
  assert.match(source, /async function stopAllForUpdate/);
  assert.match(source, /await manager\.stopAll\(\);[\s\S]*?if \(!manager\.list\(\)\.every\(\(instance\) => instance\.status\.state === "stopped"\)\) \{[\s\S]*?return \{ ok: false, error: "代理未完全停止" \};/);
  assert.match(source, /stopAll: stopAllForUpdate/);
  assert.match(source, /let updateInstallInProgress = false/);
  assert.match(source, /if \(updateInstallInProgress\) throw new Error\("更新安装中，请稍候"\)/);
  assert.match(source, /onInstallStateChange: \(installing\) =>/);
  assert.match(source, /updateLifecycle\.trackStart\(\(\) => manager\.start\(id\)\)/);
  assert.match(source, /updateLifecycle\.trackStart\(\(\) => manager\.startAll\(\)\)/);
  assert.match(source, /await updateLifecycle\.waitForStarts\(\)/);
});
