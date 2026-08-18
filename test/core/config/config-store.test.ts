import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { importLegacyConfig } from "../../../src/core/config/legacy-parser";
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

test("ConfigStore load reports invalid internal JSON with filename and field", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "local-forwarder-invalid-"));
  const filePath = path.join(directory, "internal.json");
  const { writeFile } = await import("node:fs/promises");
  await writeFile(filePath, JSON.stringify({ server: { port: "bad" } }), "utf8");
  const store = new ConfigStore(filePath);

  await assert.rejects(() => store.load(), /internal\.json.*server\.port/i);
});
