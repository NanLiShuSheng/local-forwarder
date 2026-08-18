import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  importLegacyConfig,
  parseLegacyConfigJs,
  parseLegacyJson,
  parseSysConfig,
} from "../../../src/core/config/legacy-parser";

const fixtureDirectory = path.resolve("test/fixtures/legacy");

test("imports legacy config and normalizes keys case-insensitively", async () => {
  const config = await importLegacyConfig("test/fixtures/legacy");

  assert.equal(config.server.port, 83);
  assert.equal(config.localValues.TOKEN, "fixture-token");
  assert.equal(config.mapValues.FIXTURE_KEY, "fixture-value");
  assert.equal(config.httpRules[0].match, "/qdymanage");
  assert.equal(config.tcpTargets[0].host, "127.0.0.1");
  assert.equal(config.tcpTargets[0].port, 9100);
  assert.equal(config.accounts.ptjy.password, "fixture-password");
  assert.equal(config.legacy.extra.unknownfixturefield, "preserve-me");
  assert.equal(config.legacy.extra["server.unknown"], "server-preserved");
  assert.deepEqual(config.legacy.extra["cache.unknown"], { value: "cache-preserved" });
  assert.equal(config.legacy.extra["conifg./qdymanage.unknown_rule"], "rule-preserved");
  assert.deepEqual(config.legacy.extra.unknownjsonfield, { preserve: true });
  assert.deepEqual(config.legacy.files["config.json"], {
    server: { port: 83 },
    localValues: { JSON_VALUE: "fixture-json" },
    unknownJsonField: { preserve: true },
  });
});

test("parses sysconfig with uppercase keys and last duplicate value", () => {
  const parsed = parseSysConfig("# comment\ntoken = old\nTOKEN = new ; comment\nFlag=on");

  assert.deepEqual(parsed, { TOKEN: "new", FLAG: "on" });
});

test("converts reqxml http targets to numeric tcp targets and other entries to http rules", () => {
  const config = parseLegacyConfigJs(`module.exports = {
    conifg: {
      "/reqxml": { target: "http://127.0.0.1:9001" },
      "/health": { target: "http://health.example.test/check" }
    }
  }`);

  assert.deepEqual(config.tcpTargets.map(({ host, port }) => ({ host, port })), [
    { host: "127.0.0.1", port: 9001 },
  ]);
  assert.equal(config.httpRules[0].match, "/health");
  assert.equal(config.httpRules[0].target, "http://health.example.test/check");
});

test("rejects invalid ports with the source filename and field name", () => {
  assert.throws(
    () => parseLegacyJson('{ "server": { "port": "not-a-port" } }', "config.json"),
    /config\.json.*server\.port/i,
  );
  assert.throws(
    () => parseLegacyConfigJs('module.exports = { server: { port: 70000 } }', "config.js"),
    /config\.js.*server\.port/i,
  );
});

test("executes config.js in a restricted vm sandbox", () => {
  assert.throws(
    () => parseLegacyConfigJs("module.exports = { value: require('fs') }", "config.js"),
    /config\.js/i,
  );
  assert.throws(
    () => parseLegacyConfigJs("while (true) {}", "config.js"),
    /config\.js/i,
  );
});

test("reports malformed JSON and missing legacy files with filenames", async () => {
  await assert.rejects(
    () => importLegacyConfig(path.join(fixtureDirectory, "missing")),
    /config\.json|config\.js|sysconfig\.ini/i,
  );
  assert.throws(() => parseLegacyJson("{", "config.json"), /config\.json/i);
});

test("does not print sensitive fixture values while importing", async () => {
  const originalLog = console.log;
  const output: unknown[] = [];
  console.log = (...args: unknown[]) => output.push(args);
  try {
    await importLegacyConfig(fixtureDirectory);
  } finally {
    console.log = originalLog;
  }
  assert.equal(output.length, 0);
  assert.equal((await readFile(path.join(fixtureDirectory, "config.js"), "utf8")).includes("real-token"), false);
});
