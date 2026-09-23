import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { importLegacyConfig, parseLegacyConfigJs } from "../../../src/core/config/legacy-parser";
import { createDefaultConfig } from "../../../src/core/config/model";
import { parseLocalCacheText } from "../../../src/shared/local-cache";
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

test("saves multiline pasted login cache values and reloads them", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "local-forwarder-login-cache-"));
  const config = createDefaultConfig();
  Object.assign(config.localValues, parseLocalCacheText("ErrorMsg5 = first line\nsecond line\nToken = cache-token"));
  const store = new ConfigStore(path.join(directory, "internal.json"));

  try {
    await store.save(config);
    const restored = await store.load();
    assert.equal(restored.localValues.ERRORMSG5, "first line\nsecond line");
    assert.equal(restored.localValues.TOKEN, "cache-token");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("persists the local variable input text for the next application launch", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "local-forwarder-local-input-"));
  const store = new ConfigStore(path.join(directory, "internal.json"));
  const config = { ...createDefaultConfig(), localText: "Foo = bar\nLongValue = first\nsecond" };

  try {
    await store.save(config);
    const restored = await store.load() as typeof config;
    assert.equal(restored.localText, config.localText);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("persists request IP, port, and pasted parameters for the next application launch", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "local-forwarder-request-input-"));
  const store = new ConfigStore(path.join(directory, "internal.json"));
  const config = {
    ...createDefaultConfig(),
    request: { host: "192.168.1.20", port: 8088, paramsText: "Action=100\naccount=600554432" },
  };

  try {
    await store.save(config);
    const restored = await store.load();
    assert.deepEqual(restored.request, config.request);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
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

test("ConfigStore.save removes the temporary file when rename fails", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "local-forwarder-save-failure-"));
  const targetPath = path.join(directory, "internal.json");
  await mkdir(targetPath);
  const store = new ConfigStore(targetPath);
  const original = await importLegacyConfig("test/fixtures/legacy");

  await assert.rejects(() => store.save(original));
  assert.deepEqual(await readdir(directory), ["internal.json"]);
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

test("ConfigStore round-trips IPv6 TCP authorities without brackets in host", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "local-forwarder-ipv6-"));
  const store = new ConfigStore(path.join(directory, "internal.json"));
  const source = parseLegacyConfigJs('module.exports = { CONIFG: { "/reqxml": { TARGET: "http://[::1]:8080" } } };');

  assert.equal(source.tcpTargets[0].host, "::1");
  await store.exportLegacy(source, directory);
  assert.match(await readFile(path.join(directory, "config.js"), "utf8"), /http:\/\/\[::1\]:8080/);
  const restored = await store.importLegacy(directory);
  assert.equal(restored.tcpTargets[0].host, "::1");
  assert.equal(restored.tcpTargets[0].port, 8080);
});

test("ConfigStore.importLegacy rejects symlinked legacy files", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "local-forwarder-import-symlink-"));
  await symlink(path.resolve("test/fixtures/legacy/config.js"), path.join(directory, "config.js"));
  await writeFile(path.join(directory, "config.json"), "{}\n", "utf8");
  await writeFile(path.join(directory, "sysconfig.ini"), "\n", "utf8");
  const store = new ConfigStore(path.join(directory, "internal.json"));

  await assert.rejects(() => store.importLegacy(directory), /config\.js.*symlink|regular file/i);
});

test("ConfigStore.exportLegacy rejects an existing symlink target", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "local-forwarder-export-symlink-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "local-forwarder-export-outside-"));
  const outsideConfig = path.join(outside, "config.js");
  await writeFile(outsideConfig, "outside-content\n", "utf8");
  await symlink(outsideConfig, path.join(directory, "config.js"));
  const source = await importLegacyConfig("test/fixtures/legacy");
  const store = new ConfigStore(path.join(directory, "internal.json"));

  await assert.rejects(() => store.exportLegacy(source, directory), /config\.js.*symlink|regular file/i);
  assert.equal(await readFile(outsideConfig, "utf8"), "outside-content\n");
});

test("ConfigStore export rejects dangerous legacy paths without polluting Object.prototype", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "local-forwarder-export-prototype-"));
  const store = new ConfigStore(path.join(directory, "internal.json"));
  const source = await importLegacyConfig("test/fixtures/legacy");
  const extra = Object.create(null) as Record<string, unknown>;
  extra["conifg.__proto__.polluted"] = "yes";
  const dangerous = {
    ...source,
    localValues: Object.assign(Object.create(null), source.localValues, { __proto__: "value" }),
    mapValues: Object.assign(Object.create(null), source.mapValues, { prototype: "value" }),
    accounts: Object.assign(Object.create(null), source.accounts, {
      constructor: Object.assign(Object.create(null), { password: "value" }),
    }),
    legacy: { ...source.legacy, extra },
  };

  try {
    await assert.rejects(() => store.exportLegacy(dangerous, directory), /config\.js.*(?:conifg.*__proto__|map\.prototype|account\.constructor)/);
  } finally {
    delete (Object.prototype as Record<string, unknown>).polluted;
  }
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test("ConfigStore export rejects dangerous preserved legacy JSON without pollution", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "local-forwarder-export-files-prototype-"));
  const store = new ConfigStore(path.join(directory, "internal.json"));
  const source = await importLegacyConfig("test/fixtures/legacy");
  const legacyJson = Object.create(null) as Record<string, unknown>;
  Object.defineProperty(legacyJson, "__proto__", { value: { polluted: "yes" }, enumerable: true });
  const files = Object.assign(Object.create(null), source.legacy.files, { "config.json": legacyJson });
  const dangerous = { ...source, legacy: { ...source.legacy, files } };

  try {
    await assert.rejects(() => store.exportLegacy(dangerous, directory), /config\.js.*legacy\.files\.config\.json.*__proto__/);
  } finally {
    delete (Object.prototype as Record<string, unknown>).polluted;
  }
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test("ConfigStore preserves HTTP and TCP rules that both use /reqxml", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "local-forwarder-reqxml-conflict-"));
  const store = new ConfigStore(path.join(directory, "internal.json"));
  const source = parseLegacyConfigJs(`module.exports = {
    HTTPRULES: [{ id: "http-reqxml", name: "HTTP reqxml", match: "/reqxml", target: "https://http.example.test/api", rewrite: "/rewritten", enabled: false }]
  };`);
  const edited = {
    ...source,
    tcpTargets: [{ id: "tcp-reqxml", name: "TCP reqxml", host: "127.0.0.1", port: 9100, protocol: "https" as const, enabled: true }],
  };

  await store.exportLegacy(edited, directory);
  const exportedJs = await readFile(path.join(directory, "config.js"), "utf8");
  const restored = await store.importLegacy(directory);

  assert.match(exportedJs, /HTTPRULES/);
  assert.match(exportedJs, /conifg/i);
  assert.deepEqual(restored.httpRules, edited.httpRules);
  assert.deepEqual(restored.tcpTargets, edited.tcpTargets);
});

test("ConfigStore preserves all edited TCP target metadata through legacy array export", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "local-forwarder-multi-target-"));
  const source = await importLegacyConfig("test/fixtures/legacy");
  const store = new ConfigStore(path.join(directory, "internal.json"));
  const edited = {
    ...source,
    tcpTargets: [
      { ...source.tcpTargets[0], id: "first", name: "primary", enabled: false, protocol: "http" as const },
      { ...source.tcpTargets[0], id: "second", name: "secure", enabled: true, protocol: "https" as const, host: "secure.example.test", port: 9443 },
    ],
  };

  await store.exportLegacy(edited, directory);
  const exportedJs = await readFile(path.join(directory, "config.js"), "utf8");
  const restored = await store.importLegacy(directory);

  assert.match(exportedJs, /"target": \[/);
  assert.deepEqual(restored.tcpTargets, edited.tcpTargets);
});

test("ConfigStore preserves HTTP rule metadata through legacy export and import", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "local-forwarder-http-rule-roundtrip-"));
  const source = await importLegacyConfig("test/fixtures/legacy");
  const store = new ConfigStore(path.join(directory, "internal.json"));
  const edited = {
    ...source,
    httpRules: [{
      id: "custom-rule",
      name: "Custom rule",
      match: "/custom",
      target: "https://edited.example.test/target",
      rewrite: "/rewritten",
      enabled: false,
    }],
  };

  await store.exportLegacy(edited, directory);
  const restored = await store.importLegacy(directory);

  assert.deepEqual(restored.httpRules, edited.httpRules);
});

test("ConfigStore keeps unknown HTTP rule fields in one canonical legacy representation", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "local-forwarder-http-rule-extra-"));
  const store = new ConfigStore(path.join(directory, "internal.json"));
  const source = parseLegacyConfigJs(`module.exports = {
    HTTPRULES: [{ id: "extra-id", name: "Extra", match: "/extra", target: "http://extra.example.test:8080", enabled: false, vendor: { flag: true } }]
  };`);

  await store.exportLegacy(source, directory);
  const exportedJs = await readFile(path.join(directory, "config.js"), "utf8");
  assert.match(exportedJs, /HTTPRULES/);
  assert.doesNotMatch(exportedJs, /conifg.*["']\/extra/);

  const restored = await store.importLegacy(directory);
  assert.deepEqual(restored.httpRules, source.httpRules);
  assert.deepEqual(restored.legacy.extra["httpRules[0].vendor"], { flag: true });
});

test("ConfigStore rejects deeply nested internal legacy data with a field path", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "local-forwarder-internal-depth-"));
  const filePath = path.join(directory, "internal.json");
  const store = new ConfigStore(filePath);
  const original = await importLegacyConfig("test/fixtures/legacy");
  let nested: unknown = "leaf";
  for (let index = 0; index < 12_000; index += 1) nested = { child: nested };
  const invalid = { ...original, legacy: { files: {}, extra: { hostile: nested } } };

  assert.throws(() => exportInternalJson(invalid), /internal\.json.*legacy\.extra\.hostile/i);
  await writeFile(filePath, JSON.stringify(invalid), "utf8");
  await assert.rejects(() => store.load(), /internal\.json.*legacy\.extra\.hostile/i);
});

test("ConfigStore rejects oversized internal legacy data before export", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "local-forwarder-internal-size-"));
  const store = new ConfigStore(path.join(directory, "internal.json"));
  const original = await importLegacyConfig("test/fixtures/legacy");
  const invalid = { ...original, legacy: { files: {}, extra: { hostile: "x".repeat(1_048_577) } } };

  assert.throws(() => exportInternalJson(invalid), /internal\.json.*legacy\.extra\.hostile/i);
  await assert.rejects(() => store.save(invalid), /internal\.json.*legacy\.extra\.hostile/i);
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

test("ConfigStore rejects oversized legacy input before parsing", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "local-forwarder-large-input-"));
  const store = new ConfigStore(path.join(directory, "internal.json"));
  await writeFile(path.join(directory, "config.js"), `module.exports = { value: "${"x".repeat(1_048_577)}" };`, "utf8");
  await writeFile(path.join(directory, "config.json"), "{}\n", "utf8");
  await writeFile(path.join(directory, "sysconfig.ini"), "\n", "utf8");

  await assert.rejects(() => store.importLegacy(directory), /config\.js/);
});

test("ConfigStore rejects duplicate HTTP matches during import, save, and export", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "local-forwarder-duplicate-match-"));
  const store = new ConfigStore(path.join(directory, "internal.json"));
  const source = await importLegacyConfig("test/fixtures/legacy");
  const duplicate = {
    ...source,
    httpRules: [
      { ...source.httpRules[0], match: "/duplicate" },
      { ...source.httpRules[0], id: "second", match: "/duplicate" },
    ],
  };

  await assert.rejects(() => store.save(duplicate), /httpRules\[1\]\.match/);
  await assert.rejects(() => store.exportLegacy(duplicate, directory), /httpRules\[1\]\.match/);
  await writeFile(path.join(directory, "config.js"), `module.exports = { HTTPRULES: ${JSON.stringify(duplicate.httpRules)} };`, "utf8");
  await writeFile(path.join(directory, "config.json"), "{}\n", "utf8");
  await writeFile(path.join(directory, "sysconfig.ini"), "\n", "utf8");
  await assert.rejects(() => store.importLegacy(directory), /httpRules\[1\]\.match/);
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
