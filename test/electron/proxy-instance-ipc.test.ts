import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("main process uses the proxy workspace manager for instance operations", async () => {
  const source = await readFile("electron/main.ts", "utf8");
  assert.match(source, /ProxyWorkspaceStore/);
  assert.match(source, /ForwardingServiceManager/);
  assert.match(source, /IPC_CHANNELS\.listProxyInstances/);
  assert.match(source, /IPC_CHANNELS\.selectProxyInstance/);
  assert.match(source, /IPC_CHANNELS\.createProxyInstance/);
  assert.match(source, /IPC_CHANNELS\.duplicateProxyInstance/);
  assert.match(source, /manager\.stopAll\(\)/);
});

test("preload exposes current proxy instance operations", async () => {
  const source = await readFile("electron/preload.ts", "utf8");
  assert.match(source, /listProxyInstances/);
  assert.match(source, /selectProxyInstance/);
  assert.match(source, /createProxyInstance/);
  assert.match(source, /duplicateProxyInstance/);
});
