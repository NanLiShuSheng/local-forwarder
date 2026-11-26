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

test("allows request-only config changes while running and rejects runtime changes", async () => {
  const config = createDefaultConfig();
  config.server.port = await freePort();
  config.cache.rootDir = await mkdtemp(path.join(os.tmpdir(), "forwarder-request-config-"));
  const persisted: AppConfig[] = [];
  const service = new ForwardingService({
    config,
    configStore: { save: async (next) => { persisted.push(structuredClone(next)); } },
  });

  try {
    await service.start();
    const requestOnly = service.getConfig();
    requestOnly.request = { host: "127.0.0.1", port: 6064, paramsText: "Action=100", transport: "http" };

    await service.saveConfig(requestOnly);

    assert.equal(service.status().state, "running");
    assert.deepEqual(service.getConfig().request, requestOnly.request);
    assert.deepEqual(persisted.at(-1)?.request, requestOnly.request);

    const runtimeChange = service.getConfig();
    runtimeChange.server.timeoutMs += 1;
    await assert.rejects(
      () => service.saveConfig(runtimeChange),
      /stop the service before changing configuration/,
    );
  } finally {
    await service.stop();
  }
});

test("reads and replaces map values before and during runtime", async () => {
  const config = createDefaultConfig();
  config.server.port = await freePort();
  config.cache.rootDir = await mkdtemp(path.join(os.tmpdir(), "forwarder-map-values-"));
  config.mapValues = { INITIAL: "first-value" };
  const service = new ForwardingService({ config });

  try {
    assert.deepEqual(service.getMapValues(), { INITIAL: "first-value" });
    service.setMapValues({ UPDATED: "second-value" });
    assert.deepEqual(service.getMapValues(), { UPDATED: "second-value" });

    await service.start();
    assert.deepEqual(service.getMapValues(), { UPDATED: "second-value" });
    service.setMapValues({ RUNTIME: "third-value" });
    assert.deepEqual(service.getMapValues(), { RUNTIME: "third-value" });
    assert.deepEqual(service.getConfig().mapValues, { RUNTIME: "third-value" });
  } finally {
    await service.stop();
  }
});

test("reads and deletes file values before and during runtime", async () => {
  const config = createDefaultConfig();
  config.server.port = await freePort();
  config.cache.rootDir = await mkdtemp(path.join(os.tmpdir(), "forwarder-file-values-"));
  config.legacy = { files: { "A.TXT": "first-value", "B.TXT": "second-value" }, extra: {} };
  const service = new ForwardingService({ config });

  try {
    assert.deepEqual(service.getFileValues(), { "A.TXT": "first-value", "B.TXT": "second-value" });
    service.deleteFileValue("a.txt");
    assert.deepEqual(service.getFileValues(), { "B.TXT": "second-value" });

    await service.start();
    assert.deepEqual(service.getFileValues(), { "B.TXT": "second-value" });
    service.deleteFileValue("b.txt");
    assert.deepEqual(service.getFileValues(), {});
    assert.deepEqual(service.getConfig().legacy?.files, {});
  } finally {
    await service.stop();
  }
});

test("clears file values without removing non-string legacy file entries", () => {
  const config = createDefaultConfig();
  config.legacy = { files: { "A.TXT": "first-value", "config.js": { source: true } }, extra: {} };
  const service = new ForwardingService({ config });

  service.clearFileValues();

  assert.deepEqual(service.getFileValues(), {});
  assert.deepEqual(service.getConfig().legacy?.files, { "config.js": { source: true } });
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
