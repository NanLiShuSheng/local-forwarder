import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createTrustedIpcHandler, createSaveConfigHandler } from "../../electron/ipc";
import { createRendererSecurityPolicy } from "../../electron/security";

const policy = createRendererSecurityPolicy({
  mode: "development",
  devServerUrl: "http://localhost:5173",
  rendererFilePath: path.resolve("dist/index.html"),
});
const validConfig = {
  server: { bindHost: "127.0.0.1", port: 8080, timeoutMs: 30000, loggingEnabled: true },
  httpRules: [],
  tcpTargets: [],
  localValues: {},
  mapValues: {},
  accounts: {},
  cache: { rootDir: "", downloadTarget: "", decryptEnabled: false, autoDownload: false },
};

test("trusted IPC handler rejects untrusted sender frames", () => {
  const handler = createTrustedIpcHandler(policy, () => ({ ok: true }));
  assert.throws(
    () => handler({ senderFrame: { url: "https://evil.example/" } }),
    /untrusted renderer/,
  );
});

test("save config handler rejects invalid payload and accepts valid payload", () => {
  const handler = createTrustedIpcHandler(
    policy,
    createSaveConfigHandler(() => ({ ok: true })),
  );
  const trustedEvent = { senderFrame: { url: "http://localhost:5173/" } };

  assert.deepEqual(handler(trustedEvent, null), {
    ok: false,
    error: "Invalid configuration payload.",
  });
  assert.deepEqual(handler(trustedEvent, validConfig), { ok: true });
});
