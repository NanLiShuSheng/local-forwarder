import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { createDefaultConfig } from "../../../src/core/config/model";
import { ForwardingService } from "../../../src/core/runtime/forwarding-service";
import type { AppConfig, LogEntry } from "../../../src/shared/contracts";

async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen({ host: "127.0.0.1", port: 0 }, () => resolve()); });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

test("service starts, reports status, and stops all listeners", async () => {
  const config = createDefaultConfig();
  config.server.port = await freePort();
  config.cache.rootDir = await mkdtemp(path.join(os.tmpdir(), "forwarder-service-"));
  const service = new ForwardingService({ config });
  try {
    assert.equal(service.status().state, "stopped");
    await service.start();
    assert.equal(service.status().state, "running");
    await service.stop();
    assert.equal(service.status().state, "stopped");
    await service.stop();
  } finally {
    await service.stop();
  }
});

test("saves forwarding address changes while running and applies them to the live proxy", async () => {
  const config = createDefaultConfig();
  config.server.port = await freePort();
  config.cache.rootDir = await mkdtemp(path.join(os.tmpdir(), "forwarder-service-"));
  let applied: { tcpTargets?: unknown } | undefined;
  const service = new ForwardingService({
    config,
    httpFactory: () => ({
      start: async () => ({ host: "127.0.0.1", port: config.server.port }),
      stop: async () => undefined,
      getStats: () => ({ requestCount: 0, successCount: 0, totalDurationMs: 0, tcpConnections: 0 }),
      getValues: () => ({ localValues: {}, mapValues: {}, fileValues: {} }),
      updateOptions: (patch: { tcpTargets?: unknown }) => { applied = patch; },
    }) as never,
  });
  try {
    await service.start();
    const next = service.getConfig();
    next.tcpTargets = [{ id: "jy", name: "jy", host: "10.0.0.1", port: 9000 }];
    next.cardTargetId = "jy";
    await service.saveConfig(next);
    assert.deepEqual(applied, { tcpTargets: [{ id: "jy", name: "jy", host: "10.0.0.1", port: 9000 }] });
    assert.equal(service.getConfig().tcpTargets[0]?.host, "10.0.0.1");
  } finally {
    await service.stop();
  }
});

test("saves project directory changes while running and applies them to the live proxy", async () => {
  const config = createDefaultConfig();
  config.server.port = await freePort();
  config.cache.rootDir = await mkdtemp(path.join(os.tmpdir(), "forwarder-service-"));
  let applied: { tcpTargets?: unknown; projectPath?: string } | undefined;
  const service = new ForwardingService({
    config,
    httpFactory: () => ({
      start: async () => ({ host: "127.0.0.1", port: config.server.port }),
      stop: async () => undefined,
      getStats: () => ({ requestCount: 0, successCount: 0, totalDurationMs: 0, tcpConnections: 0 }),
      getValues: () => ({ localValues: {}, mapValues: {}, fileValues: {} }),
      updateOptions: (patch: { tcpTargets?: unknown; projectPath?: string }) => { applied = patch; },
    }) as never,
  });
  try {
    await service.start();
    const next = service.getConfig();
    next.projectPath = "/tmp/project-a";
    await service.saveConfig(next);
    assert.equal(applied?.projectPath, "/tmp/project-a");
    assert.equal(service.getConfig().projectPath, "/tmp/project-a");
  } finally {
    await service.stop();
  }
});

test("applyTcpTargets updates the live proxy without persisting", async () => {
  const config = createDefaultConfig();
  config.server.port = await freePort();
  config.cache.rootDir = await mkdtemp(path.join(os.tmpdir(), "forwarder-service-"));
  const saved: AppConfig[] = [];
  let applied: { tcpTargets?: unknown } | undefined;
  const service = new ForwardingService({
    config,
    configStore: { save: async (next: AppConfig) => { saved.push(JSON.parse(JSON.stringify(next)) as AppConfig); } },
    httpFactory: () => ({
      start: async () => ({ host: "127.0.0.1", port: config.server.port }),
      stop: async () => undefined,
      getStats: () => ({ requestCount: 0, successCount: 0, totalDurationMs: 0, tcpConnections: 0 }),
      getValues: () => ({ localValues: {}, mapValues: {}, fileValues: {} }),
      updateOptions: (patch: { tcpTargets?: unknown }) => { applied = patch; },
    }) as never,
  });
  try {
    await service.start();
    service.applyTcpTargets([{ id: "jy", name: "jy", host: "10.0.0.2", port: 9001 }]);
    assert.deepEqual(applied, { tcpTargets: [{ id: "jy", name: "jy", host: "10.0.0.2", port: 9001 }] });
    assert.equal(saved.length, 0);
  } finally {
    await service.stop();
  }
});

test("still rejects non-hot config changes while running", async () => {
  const config = createDefaultConfig();
  config.server.port = await freePort();
  config.cache.rootDir = await mkdtemp(path.join(os.tmpdir(), "forwarder-service-"));
  const service = new ForwardingService({
    config,
    httpFactory: () => ({
      start: async () => ({ host: "127.0.0.1", port: config.server.port }),
      stop: async () => undefined,
      getStats: () => ({ requestCount: 0, successCount: 0, totalDurationMs: 0, tcpConnections: 0 }),
      getValues: () => ({ localValues: {}, mapValues: {}, fileValues: {} }),
    }) as never,
  });
  try {
    await service.start();
    const next = service.getConfig();
    next.server.port = next.server.port + 1;
    await assert.rejects(service.saveConfig(next), /stop the service/);
  } finally {
    await service.stop();
  }
});

test("persists map and file values when the proxy reports a store write", async () => {
  const config = createDefaultConfig();
  config.server.port = await freePort();
  config.cache.rootDir = await mkdtemp(path.join(os.tmpdir(), "forwarder-service-"));
  const saved: AppConfig[] = [];
  let valuesWritten: (() => void) | undefined;
  let notified = 0;
  const service = new ForwardingService({
    config,
    configStore: { save: async (next: AppConfig) => { saved.push(JSON.parse(JSON.stringify(next)) as AppConfig); } },
    onValuesWritten: () => { notified += 1; },
    httpFactory: (options) => {
      valuesWritten = options.onValuesWritten;
      return {
        start: async () => ({ host: "127.0.0.1", port: config.server.port }),
        stop: async () => undefined,
        getStats: () => ({ requestCount: 0, successCount: 0, totalDurationMs: 0, tcpConnections: 0 }),
        getValues: () => ({ localValues: {}, mapValues: { FOO: "bar" }, fileValues: { "FIXTURE.TXT": "file-data" } }),
      } as never;
    },
  });
  try {
    await service.start();
    assert.ok(valuesWritten);
    valuesWritten();
    await service.stop();
    const last = saved.at(-1);
    assert.equal(last?.mapValues.FOO, "bar");
    assert.deepEqual(last?.legacy?.files, { "FIXTURE.TXT": "file-data" });
    assert.equal(notified, 1);
  } finally {
    await service.stop();
  }
});

test("persists runtime values when the service stops", async () => {
  const config = createDefaultConfig();
  config.server.port = await freePort();
  config.cache.rootDir = await mkdtemp(path.join(os.tmpdir(), "forwarder-service-"));
  const saved: AppConfig[] = [];
  const service = new ForwardingService({
    config,
    configStore: { save: async (next: AppConfig) => { saved.push(JSON.parse(JSON.stringify(next)) as AppConfig); } },
    httpFactory: () => ({
      start: async () => ({ host: "127.0.0.1", port: config.server.port }),
      stop: async () => undefined,
      getStats: () => ({ requestCount: 0, successCount: 0, totalDurationMs: 0, tcpConnections: 0 }),
      getValues: () => ({ localValues: { TOKEN: "live-token" }, mapValues: {}, fileValues: {} }),
    }) as never,
  });
  try {
    await service.start();
    assert.equal(saved.length, 0);
    await service.stop();
    assert.equal(saved.at(-1)?.localValues.TOKEN, "live-token");
  } finally {
    await service.stop();
  }
});

test("setStoredValues updates the live proxy stores and persists them", async () => {
  const config = createDefaultConfig();
  config.server.port = await freePort();
  config.cache.rootDir = await mkdtemp(path.join(os.tmpdir(), "forwarder-service-"));
  const saved: AppConfig[] = [];
  const live = { localValues: {} as Record<string, string>, mapValues: { OLD: "0" } as Record<string, string>, fileValues: {} as Record<string, string> };
  const service = new ForwardingService({
    config,
    configStore: { save: async (next: AppConfig) => { saved.push(JSON.parse(JSON.stringify(next)) as AppConfig); } },
    httpFactory: () => ({
      start: async () => ({ host: "127.0.0.1", port: config.server.port }),
      stop: async () => undefined,
      getStats: () => ({ requestCount: 0, successCount: 0, totalDurationMs: 0, tcpConnections: 0 }),
      getValues: () => live,
      updateOptions: (patch: { mapValues?: Record<string, string>; fileValues?: Record<string, string> }) => {
        if (patch.mapValues !== undefined) live.mapValues = patch.mapValues;
        if (patch.fileValues !== undefined) live.fileValues = patch.fileValues;
      },
    }) as never,
  });
  try {
    await service.start();
    service.setStoredValues({ NEW: "1" }, { "F.TXT": "data" });
    assert.deepEqual(live.mapValues, { NEW: "1" });
    assert.deepEqual(live.fileValues, { "F.TXT": "data" });
    await service.stop();
    const last = saved.at(-1);
    assert.deepEqual(last?.mapValues, { NEW: "1" });
    assert.deepEqual(last?.legacy?.files, { "F.TXT": "data" });
  } finally {
    await service.stop();
  }
});

test("recovers an occupied 808x port before retrying startup", async () => {
  const config = createDefaultConfig();
  config.server.port = 8080;
  let startAttempts = 0;
  const recoveredPorts: number[] = [];
  const service = new ForwardingService({
    config,
    recoverOccupiedPort: async (port) => { recoveredPorts.push(port); },
    httpFactory: () => ({
      start: async () => {
        startAttempts += 1;
        if (startAttempts === 1) throw Object.assign(new Error("listen EADDRINUSE"), { code: "EADDRINUSE" });
        return { host: "127.0.0.1", port: 8080 };
      },
      stop: async () => undefined,
      getStats: () => ({ requestCount: 0, successCount: 0, totalDurationMs: 0, tcpConnections: 0 }),
      getValues: () => ({ localValues: {}, mapValues: {}, fileValues: {} }),
    }) as never,
  });

  try {
    const status = await service.start();
    assert.equal(status.state, "running");
    assert.equal(startAttempts, 2);
    assert.deepEqual(recoveredPorts, [8080]);
  } finally {
    await service.stop();
  }
});

test("does not recover a non-808x port after EADDRINUSE", async () => {
  const config = createDefaultConfig();
  config.server.port = 8090;
  let recoveryCalls = 0;
  const service = new ForwardingService({
    config,
    recoverOccupiedPort: async () => { recoveryCalls += 1; },
    httpFactory: () => ({
      start: async () => { throw Object.assign(new Error("listen EADDRINUSE"), { code: "EADDRINUSE" }); },
      stop: async () => undefined,
      getStats: () => ({ requestCount: 0, successCount: 0, totalDurationMs: 0, tcpConnections: 0 }),
      getValues: () => ({ localValues: {}, mapValues: {}, fileValues: {} }),
    }) as never,
  });

  await assert.rejects(() => service.start(), /EADDRINUSE/);
  assert.equal(recoveryCalls, 0);
  await service.stop();
});

test("serializes a stop requested while startup is still completing", async () => {
  const config = createDefaultConfig();
  config.server.port = await freePort();
  config.cache.rootDir = await mkdtemp(path.join(os.tmpdir(), "forwarder-service-race-"));
  const service = new ForwardingService({ config });

  const start = service.start();
  const stop = service.stop();
  await start;
  const stopped = await stop;

  try {
    assert.equal(stopped.state, "stopped");
    assert.equal(service.status().state, "stopped");
    await service.start();
    assert.equal(service.status().state, "running");
  } finally {
    await service.stop();
  }
});

test("service records start failures and can recover after stop", async () => {
  const config = createDefaultConfig();
  config.server.port = await freePort();
  const service = new ForwardingService({ config, httpFactory: () => ({ start: async () => { throw new Error("port failure"); }, stop: async () => undefined }) as never });
  await assert.rejects(() => service.start(), /port failure/);
  assert.equal(service.status().state, "error");
  await service.stop();
  assert.equal(service.status().state, "stopped");
});

test("merges manually captured login values into the active service and config", async () => {
  const config = createDefaultConfig();
  config.localValues = { OLD: "value" };
  const service = new ForwardingService({ config });
  service.mergeLocalValues({ TOKEN: "captured-token" });
  assert.deepEqual(service.getConfig().localValues, { OLD: "value", TOKEN: "captured-token" });
});

test("clears captured logs and accepts new entries afterward", async () => {
  const config = createDefaultConfig();
  let onLog: ((entry: LogEntry) => void) | undefined;
  const service = new ForwardingService({
    config,
    httpFactory: (options) => {
      onLog = options.onLog;
      return {
        start: async () => ({ host: "127.0.0.1", port: config.server.port }),
        stop: async () => undefined,
        getStats: () => ({ requestCount: 0, successCount: 0, totalDurationMs: 0, tcpConnections: 0 }),
        getValues: () => ({ localValues: {}, mapValues: {}, fileValues: {} }),
      } as never;
    },
  });

  try {
    await service.start();
    onLog?.({ timestamp: "2026-09-04T00:00:00.000Z", level: "info", message: "first", requestType: "fetch" });
    assert.equal(service.getLogs().length, 1);

    service.clearLogs();

    assert.deepEqual(service.getLogs(), []);
    onLog?.({ timestamp: "2026-09-04T00:00:01.000Z", level: "info", message: "second", requestType: "xhr" });
    assert.deepEqual(service.getLogs().map((entry) => entry.message), ["second"]);
  } finally {
    await service.stop();
  }
});
