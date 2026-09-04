import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { createDefaultConfig } from "../../../src/core/config/model";
import { ForwardingService } from "../../../src/core/runtime/forwarding-service";
import type { LogEntry } from "../../../src/shared/contracts";

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

test("service records start failures and can recover after stop", async () => {
  const config = createDefaultConfig();
  config.server.port = await freePort();
  const service = new ForwardingService({ config, httpFactory: () => ({ start: async () => { throw new Error("port failure"); }, stop: async () => undefined }) as never });
  await assert.rejects(() => service.start(), /port failure/);
  assert.equal(service.status().state, "error");
  await service.stop();
  assert.equal(service.status().state, "stopped");
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
