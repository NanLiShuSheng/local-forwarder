import test from "node:test";
import assert from "node:assert/strict";
import { createDefaultConfig } from "../../../src/core/config/model";
import { ForwardingServiceManager, type ManagedForwardingService } from "../../../src/core/runtime/forwarding-service-manager";
import type { AppConfig, ProxyWorkspace, RuntimeStatus } from "../../../src/shared/contracts";

function workspaceWithTwoInstances(): ProxyWorkspace {
  const first = createDefaultConfig();
  first.server.port = 18080;
  first.tcpTargets = [
    { id: "hq", name: "hq", host: "market.example.com", port: 7778, enabled: true },
    { id: "jy", name: "jy", host: "business.example.com", port: 7779, enabled: true },
  ];
  const second = createDefaultConfig();
  second.server.port = 18081;
  second.tcpTargets = [{ id: "second-target", name: "业务", host: "business.example.com", port: 7779, enabled: true }];
  return {
    version: 1,
    selectedInstanceId: "first",
    instances: [
      { id: "first", name: "行情代理", config: first },
      { id: "second", name: "业务办理代理", config: second },
    ],
  };
}

function fakeFactory() {
  return (config: AppConfig, persistence: { save(config: AppConfig): Promise<void> }): ManagedForwardingService => {
    let current = structuredClone(config);
    let state: RuntimeStatus["state"] = "stopped";
    return {
      start: async () => { state = "running"; return { state, requestCount: 0, tcpConnections: 0 }; },
      stop: async () => { state = "stopped"; return { state, requestCount: 0, tcpConnections: 0 }; },
      status: () => ({ state, requestCount: 0, tcpConnections: 0 }),
      getLogs: () => [],
      clearLogs: () => undefined,
      getConfig: () => structuredClone(current),
      saveConfig: async (next) => { current = structuredClone(next); await persistence.save(current); },
      mergeLocalValues: (values) => { current.localValues = { ...current.localValues, ...values }; void persistence.save(current); },
    };
  };
}

test("starts two proxy instances independently", async () => {
  const workspace = workspaceWithTwoInstances();
  const manager = new ForwardingServiceManager({ workspace, workspaceStore: { save: async () => undefined }, serviceFactory: fakeFactory() });

  await manager.start("first");
  await manager.start("second");

  const summaries = manager.list();
  assert.equal(summaries.find((item) => item.id === "first")?.status.state, "running");
  assert.equal(summaries.find((item) => item.id === "second")?.status.state, "running");
});

test("uses the jy forwarding address in the instance summary", () => {
  const manager = new ForwardingServiceManager({ workspace: workspaceWithTwoInstances(), workspaceStore: { save: async () => undefined }, serviceFactory: fakeFactory() });

  assert.equal(manager.list().find((item) => item.id === "first")?.target, "business.example.com:7779");
});

test("rejects a port conflict without stopping the running instance", async () => {
  const workspace = workspaceWithTwoInstances();
  workspace.instances[1]!.config.server.port = workspace.instances[0]!.config.server.port;
  const manager = new ForwardingServiceManager({ workspace, workspaceStore: { save: async () => undefined }, serviceFactory: fakeFactory() });

  await manager.start("first");
  await assert.rejects(() => manager.start("second"), /端口 18080 已被行情代理占用/);
  assert.equal(manager.status("first").state, "running");
  assert.equal(manager.status("second").state, "stopped");
});

test("duplicates the selected proxy with a new port and independent config", async () => {
  const workspace = workspaceWithTwoInstances();
  const manager = new ForwardingServiceManager({ workspace, workspaceStore: { save: async () => undefined }, serviceFactory: fakeFactory() });

  const result = await manager.duplicate();

  assert.notEqual(result.id, "first");
  assert.equal(result.name, "行情代理 副本");
  assert.notEqual(result.port, 18080);
  assert.equal(manager.list().length, 3);
});

test("stopping one proxy does not stop another proxy", async () => {
  const workspace = workspaceWithTwoInstances();
  const manager = new ForwardingServiceManager({ workspace, workspaceStore: { save: async () => undefined }, serviceFactory: fakeFactory() });

  await manager.start("first");
  await manager.start("second");
  await manager.stop("first");

  assert.equal(manager.status("first").state, "stopped");
  assert.equal(manager.status("second").state, "running");
});

test("clears logs on the currently selected proxy instance", async () => {
  const clearedPorts: number[] = [];
  const manager = new ForwardingServiceManager({
    workspace: workspaceWithTwoInstances(),
    workspaceStore: { save: async () => undefined },
    serviceFactory: (config, persistence) => {
      const service = fakeFactory()(config, persistence);
      return { ...service, clearLogs: () => { clearedPorts.push(config.server.port); } };
    },
  });

  manager.clearLogs();
  await manager.select("second");
  manager.clearLogs();

  assert.deepEqual(clearedPorts, [18080, 18081]);
});
