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
    ...( { sharedValues: { ACCOUNT: "shared-account" } } as any),
    instances: [
      { id: "first", name: "行情代理", config: first, ...( { loginCache: { TOKEN: "first-token" } } as any) },
      { id: "second", name: "业务办理代理", config: second, ...( { loginCache: { TOKEN: "second-token" } } as any) },
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

test("starts and stops all proxy instances", async () => {
  const manager = new ForwardingServiceManager({ workspace: workspaceWithTwoInstances(), workspaceStore: { save: async () => undefined }, serviceFactory: fakeFactory() });

  await manager.startAll();
  assert.equal(manager.status("first").state, "running");
  assert.equal(manager.status("second").state, "running");

  await manager.stopAll();
  assert.equal(manager.status("first").state, "stopped");
  assert.equal(manager.status("second").state, "stopped");
});

test("renames a proxy instance and persists the new name", async () => {
  let savedWorkspace: ProxyWorkspace | undefined;
  const manager = new ForwardingServiceManager({ workspace: workspaceWithTwoInstances(), workspaceStore: { save: async (workspace) => { savedWorkspace = workspace; } }, serviceFactory: fakeFactory() });

  await manager.rename("first", "  行情长名称  ");

  assert.equal(manager.list().find((item) => item.id === "first")?.name, "行情长名称");
  assert.equal(savedWorkspace?.instances.find((item) => item.id === "first")?.name, "行情长名称");
  await assert.rejects(() => manager.rename("first", "   "), /代理名称不能为空/);
});

test("removes a proxy instance, stops it, selects the remaining instance, and persists the workspace", async () => {
  let savedWorkspace: ProxyWorkspace | undefined;
  const manager = new ForwardingServiceManager({ workspace: workspaceWithTwoInstances(), workspaceStore: { save: async (workspace) => { savedWorkspace = workspace; } }, serviceFactory: fakeFactory() });

  await manager.start("first");
  await manager.remove("first");

  assert.deepEqual(manager.list().map((instance) => instance.id), ["second"]);
  assert.equal(manager.getSelectedInstanceId(), "second");
  assert.equal(savedWorkspace?.selectedInstanceId, "second");
  assert.deepEqual(savedWorkspace?.instances.map((instance) => instance.id), ["second"]);
  assert.throws(() => manager.status("first"), /代理实例不存在/);
});

test("does not remove the last proxy instance", async () => {
  const workspace = workspaceWithTwoInstances();
  workspace.instances = [workspace.instances[0]!];
  const manager = new ForwardingServiceManager({ workspace, workspaceStore: { save: async () => undefined }, serviceFactory: fakeFactory() });

  await assert.rejects(() => manager.remove("first"), /至少保留一个代理实例/);
  assert.equal(manager.list().length, 1);
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

test("keeps shared values global and login cache isolated by proxy", async () => {
  const workspace = workspaceWithTwoInstances();
  const runtimeValues = new Map<string, Record<string, string>>();
  const manager = new ForwardingServiceManager({
    workspace,
    workspaceStore: { save: async () => undefined },
    serviceFactory: (config, persistence) => {
      const service = fakeFactory()(config, persistence);
      const original = service.getConfig;
      return {
        ...service,
        setRuntimeValues: (values: Record<string, string>) => { runtimeValues.set(config.server.port.toString(), values); },
        getConfig: () => original(),
      } as any;
    },
  });

  assert.deepEqual(manager.getSharedValues(), { ACCOUNT: "shared-account" });
  assert.deepEqual(manager.getLoginCache("first"), { TOKEN: "first-token" });
  await manager.saveSharedValues({ ACCOUNT: "new-account", REGION: "cn" });
  await manager.saveLoginCache({ TOKEN: "updated-first-token" }, "first");

  assert.deepEqual(manager.getLoginCache("first"), { TOKEN: "updated-first-token" });
  assert.deepEqual(manager.getLoginCache("second"), { TOKEN: "second-token" });
  assert.deepEqual(runtimeValues.get("18080"), { ACCOUNT: "new-account", REGION: "cn", TOKEN: "updated-first-token" });
  assert.deepEqual(runtimeValues.get("18081"), { ACCOUNT: "new-account", REGION: "cn", TOKEN: "second-token" });
});

test("does not copy login cache when duplicating a proxy", async () => {
  const manager = new ForwardingServiceManager({ workspace: workspaceWithTwoInstances(), workspaceStore: { save: async () => undefined }, serviceFactory: fakeFactory() });
  const duplicate = await manager.duplicate();
  assert.deepEqual(manager.getLoginCache(duplicate.id), {});
});

test("routes automatic login capture into the selected proxy cache", async () => {
  const workspace = workspaceWithTwoInstances();
  const captures = new Map<number, (values: Record<string, string>) => void>();
  const manager = new ForwardingServiceManager({
    workspace,
    workspaceStore: { save: async () => undefined },
    serviceFactory: (config, persistence, options) => {
      if (options?.onLoginValuesChanged !== undefined) captures.set(config.server.port, options.onLoginValuesChanged);
      return fakeFactory()(config, persistence);
    },
  });

  captures.get(18080)?.({ SESSIONNO: "9" });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(manager.getLoginCache("first").SESSIONNO, "9");
  assert.equal(manager.getLoginCache("second").SESSIONNO, undefined);
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
