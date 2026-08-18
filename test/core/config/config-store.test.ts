import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { importLegacyConfig, parseLegacyConfigJs } from "../../../src/core/config/legacy-parser";
import {
  ConfigStore,
  exportInternalJson,
  parseInternalJson,
} from "../../../src/core/config/config-store";

test("export and re-import preserves normalized config", async () => {
  const original = await importLegacyConfig("test/fixtures/legacy");
  const exported = exportInternalJson(original);
  const restored = parseInternalJson(exported);

  assert.deepEqual(restored.httpRules, original.httpRules);
  assert.equal(restored.accounts.ptjy.password, original.accounts.ptjy.password);
  assert.deepEqual(restored.legacy, original.legacy);
});

test("ConfigStore saves atomically and loads the saved config", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "local-forwarder-config-"));
  const filePath = path.join(directory, "internal.json");
  const store = new ConfigStore(filePath);
  const original = await importLegacyConfig("test/fixtures/legacy");

  await store.save(original);

  assert.deepEqual(await store.load(), original);
  assert.deepEqual(await readdir(directory), ["internal.json"]);
  assert.doesNotMatch(await readFile(filePath, "utf8"), /real-token|real-phone|real-account/);
});

test("ConfigStore imports and exports legacy directories", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "local-forwarder-legacy-"));
  const source = await importLegacyConfig("test/fixtures/legacy");
  const store = new ConfigStore(path.join(directory, "internal.json"));

  await store.exportLegacy(source, directory);
  const exportedJs = await readFile(path.join(directory, "config.js"), "utf8");
  const restored = await store.importLegacy(directory);

  assert.match(exportedJs, /\"local\"/);
  assert.match(exportedJs, /\"map\"/);
  assert.match(exportedJs, /\"account\"/);
  assert.doesNotMatch(exportedJs, /\"localValues\"|\"mapValues\"|\"accounts\"/);
  assert.equal(restored.localValues.TOKEN, source.localValues.TOKEN);
  assert.equal(restored.mapValues.FIXTURE_KEY, source.mapValues.FIXTURE_KEY);
  assert.deepEqual(restored.accounts, source.accounts);
  assert.deepEqual(restored.httpRules, source.httpRules);
  assert.equal(restored.server.port, source.server.port);
  assert.deepEqual(restored.legacy.extra, source.legacy.extra);
  assert.deepEqual(restored.legacy.files["config.json"], source.legacy.files["config.json"]);
});

test("ConfigStore export uses the edited normalized config before preserved legacy JSON", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "local-forwarder-overwrite-order-"));
  const source = await importLegacyConfig("test/fixtures/legacy");
  const store = new ConfigStore(path.join(directory, "internal.json"));
  const edited = {
    ...source,
    server: { ...source.server, port: 84 },
    httpRules: [{ ...source.httpRules[0], target: "https://edited.example.test/route" }],
    localValues: { ...source.localValues, TOKEN: "edited-token" },
    mapValues: { ...source.mapValues, FIXTURE_KEY: "edited-map" },
    accounts: { ...source.accounts, ptjy: { ...source.accounts.ptjy, password: "edited-password" } },
  };

  await store.exportLegacy(edited, directory);
  const restored = await store.importLegacy(directory);

  assert.equal(restored.server.port, 84);
  assert.equal(restored.httpRules[0].target, edited.httpRules[0].target);
  assert.equal(restored.localValues.TOKEN, "edited-token");
  assert.equal(restored.mapValues.FIXTURE_KEY, "edited-map");
  assert.equal(restored.accounts.ptjy.password, "edited-password");
  assert.deepEqual(restored.legacy.files["config.json"], source.legacy.files["config.json"]);
});

test("ConfigStore export preserves HTTPS protocol for TCP targets", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "local-forwarder-protocol-"));
  const store = new ConfigStore(path.join(directory, "internal.json"));
  const httpsConfig = parseLegacyConfigJs(
    'module.exports = { CONIFG: { "/reqxml": { TARGET: "https://secure.example.test:9443" } } };',
  );

  await store.exportLegacy(httpsConfig, directory);

  assert.match(await readFile(path.join(directory, "config.js"), "utf8"), /https:\/\/secure\.example\.test:9443/);
});

test("ConfigStore reports field-level validation paths for every config section", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "local-forwarder-field-validation-"));
  const store = new ConfigStore(path.join(directory, "internal.json"));
  const original = await importLegacyConfig("test/fixtures/legacy");
  const httpRule = original.httpRules[0];
  const tcpTarget = original.tcpTargets[0];
  const invalidCases: Array<[string, typeof original]> = [
    ["server.bindHost", { ...original, server: { ...original.server, bindHost: 1 as never } }],
    ["server.port", { ...original, server: { ...original.server, port: 0 } }],
    ["server.timeoutMs", { ...original, server: { ...original.server, timeoutMs: -1 } }],
    ["server.loggingEnabled", { ...original, server: { ...original.server, loggingEnabled: "yes" as never } }],
    ["httpRules[0].id", { ...original, httpRules: [{ ...httpRule, id: 1 as never }] }],
    ["httpRules[0].name", { ...original, httpRules: [{ ...httpRule, name: 1 as never }] }],
    ["httpRules[0].match", { ...original, httpRules: [{ ...httpRule, match: 1 as never }] }],
    ["httpRules[0].target", { ...original, httpRules: [{ ...httpRule, target: 1 as never }] }],
    ["httpRules[0].enabled", { ...original, httpRules: [{ ...httpRule, enabled: "yes" as never }] }],
    ["tcpTargets[0].id", { ...original, tcpTargets: [{ ...tcpTarget, id: 1 as never }] }],
    ["tcpTargets[0].name", { ...original, tcpTargets: [{ ...tcpTarget, name: 1 as never }] }],
    ["tcpTargets[0].host", { ...original, tcpTargets: [{ ...tcpTarget, host: 1 as never }] }],
    ["tcpTargets[0].port", { ...original, tcpTargets: [{ ...tcpTarget, port: 0 }] }],
    ["tcpTargets[0].enabled", { ...original, tcpTargets: [{ ...tcpTarget, enabled: "yes" as never }] }],
    ["localValues.TOKEN", { ...original, localValues: { TOKEN: 1 as never } }],
    ["mapValues.FIXTURE_KEY", { ...original, mapValues: { FIXTURE_KEY: 1 as never } }],
    ["accounts.ptjy.password", { ...original, accounts: { ptjy: { password: 1 as never } } }],
    ["cache.rootDir", { ...original, cache: { ...original.cache, rootDir: 1 as never } }],
    ["cache.downloadTarget", { ...original, cache: { ...original.cache, downloadTarget: 1 as never } }],
    ["cache.decryptEnabled", { ...original, cache: { ...original.cache, decryptEnabled: "yes" as never } }],
    ["cache.autoDownload", { ...original, cache: { ...original.cache, autoDownload: "yes" as never } }],
  ];

  for (const [field, invalid] of invalidCases) {
    await assert.rejects(() => store.save(invalid), new RegExp(field.replace(/[.[\]]/g, "\\$&")));
    await assert.rejects(() => store.exportLegacy(invalid, directory), new RegExp(field.replace(/[.[\]]/g, "\\$&")));
  }
});

test("ConfigStore validates server and forwarding target ports before save or legacy export", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "local-forwarder-validation-"));
  const store = new ConfigStore(path.join(directory, "internal.json"));
  const original = await importLegacyConfig("test/fixtures/legacy");

  await assert.rejects(
    () => store.save({ ...original, server: { ...original.server, port: 0 } }),
    /server\.port/i,
  );
  await assert.rejects(
    () => store.exportLegacy({
      ...original,
      httpRules: [{ ...original.httpRules[0], target: "http://fixture.example.test:70000/path" }],
    }, directory),
    /httpRules\[0\]\.target(?:\.port)?/i,
  );
});

test("ConfigStore rejects explicit invalid URL and TCP ports with field paths", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "local-forwarder-port-validation-"));
  const store = new ConfigStore(path.join(directory, "internal.json"));
  const original = await importLegacyConfig("test/fixtures/legacy");
  const urlPorts = ["0", "-1", "65536", "abc"];

  for (const port of urlPorts) {
    await assert.rejects(
      () => store.save({
        ...original,
        httpRules: [{ ...original.httpRules[0], target: `http://fixture.example.test:${port}/path` }],
      }),
      /httpRules\[0\]\.target\.port/,
    );
  }

  for (const port of [0, -1, 65536, "abc"]) {
    await assert.rejects(
      () => store.save({
        ...original,
        tcpTargets: [{ ...original.tcpTargets[0], port: port as never }],
      }),
      /tcpTargets\[0\]\.port/,
    );
  }
});

test("ConfigStore.importLegacy validates the normalized config with field paths", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "local-forwarder-import-validation-"));
  const store = new ConfigStore(path.join(directory, "internal.json"));
  const { writeFile } = await import("node:fs/promises");
  const invalidCases: Array<[string, Record<string, unknown>]> = [
    ["server.bindHost", { SERVER: { BINDHOST: "" } }],
    ["httpRules[0].match", { HTTPRULES: [{ id: "id", name: "name", match: "", target: "http://fixture.example.test:1", enabled: true }] }],
    ["httpRules[0].target.port", { HTTPRULES: [{ id: "id", name: "name", match: "/x", target: "http://fixture.example.test:0", enabled: true }] }],
    ["tcpTargets[0].port", { TCPTARGETS: [{ id: "id", name: "name", host: "fixture.example.test", port: 0, enabled: true }] }],
  ];

  for (const [field, invalid] of invalidCases) {
    await writeFile(path.join(directory, "config.js"), `module.exports = ${JSON.stringify(invalid)};\n`, "utf8");
    await writeFile(path.join(directory, "config.json"), "{}\n", "utf8");
    await writeFile(path.join(directory, "sysconfig.ini"), "\n", "utf8");
    await assert.rejects(() => store.importLegacy(directory), new RegExp(field.replace(/[.[\]]/g, "\\$&")));
  }
});

test("ConfigStore load reports invalid internal JSON with filename and field", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "local-forwarder-invalid-"));
  const filePath = path.join(directory, "internal.json");
  const { writeFile } = await import("node:fs/promises");
  const store = new ConfigStore(filePath);

  const original = await importLegacyConfig("test/fixtures/legacy");
  const invalidCases: Array<[string, unknown]> = [
    ["server.port", { ...original, server: { ...original.server, port: "bad" } }],
    ["httpRules[0].id", { ...original, httpRules: [{ ...original.httpRules[0], id: 1 }] }],
    ["tcpTargets[0].host", { ...original, tcpTargets: [{ ...original.tcpTargets[0], host: 1 }] }],
    ["cache.rootDir", { ...original, cache: { ...original.cache, rootDir: 1 } }],
  ];

  for (const [field, invalid] of invalidCases) {
    await writeFile(filePath, JSON.stringify(invalid), "utf8");
    const escapedField = field.replace(/[.[\]]/g, "\\$&");
    await assert.rejects(() => store.load(), new RegExp(`internal\\.json ${escapedField}`));
  }
});
