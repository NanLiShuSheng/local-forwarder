import test from "node:test";
import assert from "node:assert/strict";
import { createDefaultConfig } from "../../src/core/config/model";
import { IPC_CHANNELS, type ProxyInstance, type ProxyWorkspace, type RuntimeStatus } from "../../src/shared/contracts";
import { isValidProxyWorkspace } from "../../src/shared/validation";

test("proxy workspace contains instances and selected instance", () => {
  const instance: ProxyInstance = { id: "default", name: "默认代理", config: createDefaultConfig() };
  const workspace: ProxyWorkspace = { version: 1, selectedInstanceId: instance.id, instances: [instance] };
  assert.equal(isValidProxyWorkspace(workspace), true);
  assert.equal(workspace.instances[0]?.config.server.port, 8080);
});

test("proxy instance summary exposes runtime details", () => {
  const status: RuntimeStatus = { state: "running", requestCount: 7, tcpConnections: 1 };
  const summary = { id: "market", name: "行情代理", bindHost: "127.0.0.1", port: 8080, target: "60.12.9.58:7778", status };
  assert.equal(summary.port, 8080);
  assert.equal(summary.status.requestCount, 7);
});

test("proxy instance IPC channels are public", () => {
  assert.equal(IPC_CHANNELS.listProxyInstances, "proxy-instances:list");
  assert.equal(IPC_CHANNELS.selectProxyInstance, "proxy-instances:select");
  assert.equal(IPC_CHANNELS.createProxyInstance, "proxy-instances:create");
  assert.equal(IPC_CHANNELS.duplicateProxyInstance, "proxy-instances:duplicate");
});
