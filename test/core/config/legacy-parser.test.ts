import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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

test("converts a reqxml target string array into tcp targets", () => {
  const config = parseLegacyConfigJs(`module.exports = {
    conifg: {
      "/reqxml": { target: ["http://one.example.test:8001", "https://two.example.test:8443"] }
    }
  }`);

  assert.deepEqual(config.tcpTargets.map(({ host, port, protocol, id, name, enabled }) => ({ host, port, protocol, id, name, enabled })), [
    { host: "one.example.test", port: 8001, protocol: "http", id: "tcp-1", name: "/reqxml", enabled: true },
    { host: "two.example.test", port: 8443, protocol: "https", id: "tcp-2", name: "/reqxml", enabled: true },
  ]);
});

test("reports the index of an invalid reqxml target array item", () => {
  assert.throws(
    () => parseLegacyConfigJs(`module.exports = { conifg: { "/reqxml": { target: ["http://one.example.test:8001", "not-a-url"] } } }`),
    /conifg.*\/reqxml.*target\[1\]/,
  );
});

test("converts reqxml targets with protocol default ports to tcp targets", () => {
  const httpConfig = parseLegacyConfigJs(`module.exports = { conifg: { "/reqxml": { target: "http://127.0.0.1:80" } } }`);
  const httpsConfig = parseLegacyConfigJs(`module.exports = { conifg: { "/reqxml": { target: "https://127.0.0.1:443" } } }`);

  assert.deepEqual(httpConfig.tcpTargets.map(({ host, port }) => ({ host, port })), [
    { host: "127.0.0.1", port: 80 },
  ]);
  assert.deepEqual(httpsConfig.tcpTargets.map(({ host, port }) => ({ host, port })), [
    { host: "127.0.0.1", port: 443 },
  ]);
});

test("rejects invalid types in canonical HTTP rules and TCP targets", () => {
  const httpBase = { id: "id", name: "name", match: "/match", target: "http://fixture.example.test:1", enabled: true };
  assert.throws(
    () => parseLegacyConfigJs(`module.exports = { HTTPRULES: [${JSON.stringify({ ...httpBase, id: 1 })}] }`, "config.js"),
    /httpRules\[0\]\.id/,
  );
  assert.throws(
    () => parseLegacyConfigJs(`module.exports = { HTTPRULES: [${JSON.stringify({ ...httpBase, name: 1 })}] }`, "config.js"),
    /httpRules\[0\]\.name/,
  );
  assert.throws(
    () => parseLegacyConfigJs(`module.exports = { HTTPRULES: [${JSON.stringify({ ...httpBase, rewrite: 1 })}] }`, "config.js"),
    /httpRules\[0\]\.rewrite/,
  );
  assert.throws(
    () => parseLegacyConfigJs(`module.exports = { HTTPRULES: [${JSON.stringify({ ...httpBase, enabled: "true" })}] }`, "config.js"),
    /httpRules\[0\]\.enabled/,
  );

  const tcpBase = { id: "id", name: "name", host: "fixture.example.test", port: 1, enabled: true };
  assert.throws(
    () => parseLegacyConfigJs(`module.exports = { TCPTARGETS: [${JSON.stringify({ ...tcpBase, id: 1 })}] }`, "config.js"),
    /tcpTargets\[0\]\.id/,
  );
  assert.throws(
    () => parseLegacyConfigJs(`module.exports = { TCPTARGETS: [${JSON.stringify({ ...tcpBase, name: 1 })}] }`, "config.js"),
    /tcpTargets\[0\]\.name/,
  );
  assert.throws(
    () => parseLegacyConfigJs(`module.exports = { TCPTARGETS: [${JSON.stringify({ ...tcpBase, enabled: "false" })}] }`, "config.js"),
    /tcpTargets\[0\]\.enabled/,
  );
});

test("imports legacy HTTP rule metadata and supports target/url-only entries", () => {
  const config = parseLegacyConfigJs(`module.exports = { CONIFG: {
    "/custom": { target: "https://custom.example.test", rewrite: "/rewritten", id: "custom-id", name: "Custom", enabled: false },
    "/legacy": { url: "http://legacy.example.test" }
  } }`);

  assert.deepEqual(config.httpRules, [
    {
      id: "custom-id",
      name: "Custom",
      match: "/custom",
      target: "https://custom.example.test",
      rewrite: "/rewritten",
      enabled: false,
    },
    {
      id: "http-2",
      name: "/legacy",
      match: "/legacy",
      target: "http://legacy.example.test",
      enabled: true,
    },
  ]);
});

test("rejects dangerous legacy keys without polluting host prototypes", () => {
  const cases = [
    ["account.__proto__", '{"account":{"__proto__":{"polluted":"yes"}}}'],
    ["local.__proto__", '{"local":{"__proto__":"value"}}'],
    ["map.prototype", '{"map":{"prototype":"value"}}'],
    ["unknown.constructor", '{"unknown":{"constructor":{"value":true}}}'],
    ["legacy.extra.__proto__", '{"legacy":{"extra":{"__proto__":{"polluted":"yes"}}}}'],
    ["legacy.files.__proto__", '{"legacy":{"files":{"__proto__":{"polluted":"yes"}}}}'],
  ] as const;

  for (const [field, raw] of cases) {
    const source = `module.exports = JSON.parse(${JSON.stringify(raw)});`;
    const escapedField = field.replace(/[.[\]]/g, "\\$&");
    try {
      assert.throws(() => parseLegacyConfigJs(source, "config.js"), new RegExp(`config\\.js.*${escapedField}`));
    } finally {
      delete (Object.prototype as Record<string, unknown>).polluted;
    }
    assert.equal(({} as Record<string, unknown>).polluted, undefined);
  }
});

test("keeps canonical HTTP rules and merges distinct legacy rules", () => {
  const config = parseLegacyConfigJs(`module.exports = {
    HTTPRULES: [{ id: "canonical", name: "Canonical", match: "/canonical", target: "http://canonical.example.test", enabled: true }],
    CONIFG: { "/legacy": { target: "http://legacy.example.test", enabled: false } }
  };`);

  assert.deepEqual(config.httpRules.map(({ match, target, enabled }) => ({ match, target, enabled })), [
    { match: "/canonical", target: "http://canonical.example.test", enabled: true },
    { match: "/legacy", target: "http://legacy.example.test", enabled: false },
  ]);
});

test("rejects duplicate matches across canonical and legacy HTTP rules", () => {
  assert.throws(
    () => parseLegacyConfigJs(`module.exports = {
      HTTPRULES: [{ id: "canonical", name: "Canonical", match: "/same", target: "http://canonical.example.test", enabled: true }],
      CONIFG: { "/same": { target: "http://legacy.example.test" } }
    };`, "config.js"),
    /config\.js.*httpRules\[1\]\.match/,
  );
});

test("reports camel-case cache field paths", () => {
  assert.throws(
    () => parseLegacyConfigJs('module.exports = { CACHE: { ROOTDIR: 1 } }', "config.js"),
    /cache\.rootDir/,
  );
  assert.throws(
    () => parseLegacyConfigJs('module.exports = { CACHE: { DOWNLOADTARGET: 1 } }', "config.js"),
    /cache\.downloadTarget/,
  );
});

test("rejects excessively deep or large legacy JSON structures", () => {
  let deep: unknown = "leaf";
  for (let index = 0; index < 70; index += 1) deep = { child: deep };
  assert.throws(() => parseLegacyJson(JSON.stringify(deep), "config.json"), /config\.json/);

  const manyFields = Object.fromEntries(Array.from({ length: 10_001 }, (_, index) => [`field${index}`, index]));
  assert.throws(() => parseLegacyJson(JSON.stringify(manyFields), "config.json"), /config\.json/);
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

test("rejects external backing-memory objects instead of serializing them as empty objects", () => {
  for (const source of [
    "module.exports = new ArrayBuffer(200000000);",
    "module.exports = new SharedArrayBuffer(200000000);",
    "module.exports = new Uint8Array(200000000);",
  ]) {
    assert.throws(() => parseLegacyConfigJs(source, "config.js"), /config\.js.*resource|memory/i);
  }
});

test("does not expose a host module prototype or constructor escape", () => {
  const config = parseLegacyConfigJs(
    "module.exports = { modulePrototypeIsNull: Object.getPrototypeOf(module) === null }",
    "config.js",
  );
  assert.equal(config.legacy.extra.moduleprototypeisnull, true);
  assert.throws(
    () => parseLegacyConfigJs("module.exports = module.constructor.constructor('return typeof process')()", "config.js"),
    /config\.js/,
  );
});

function runParserInChild(source: string) {
  const parserPath = path.resolve("src/core/config/legacy-parser.ts");
  const script = `import { parseLegacyConfigJs } from ${JSON.stringify(parserPath)};
try { parseLegacyConfigJs(${JSON.stringify(source)}, "config.js"); process.exitCode = 1; }
catch (error) { if (!String(error).includes("config.js")) process.exitCode = 2; }`;
  return spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
    cwd: path.resolve("."),
    encoding: "utf8",
    timeout: 4000,
  });
}

function runParserInChildExpecting(source: string, expected: RegExp) {
  const parserPath = path.resolve("src/core/config/legacy-parser.ts");
  const script = `import { parseLegacyConfigJs } from ${JSON.stringify(parserPath)};
try { parseLegacyConfigJs(${JSON.stringify(source)}, "config.js"); process.exitCode = 1; }
catch (error) { if (!${expected}.test(String(error))) process.exitCode = 2; }`;
  return spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
    cwd: path.resolve("."),
    encoding: "utf8",
    timeout: 4000,
  });
}

test("times out getter and Proxy work during VM serialization", () => {
  for (const source of [
    "module.exports = { get value() { while (true) {} } }",
    "module.exports = new Proxy({}, { ownKeys() { while (true) {} } })",
  ]) {
    const result = runParserInChild(source);
    assert.equal(result.status, 0, result.error?.message ?? result.stderr);
  }
});

test("rejects a short config.js that tries to allocate hundreds of megabytes", () => {
  const result = runParserInChildExpecting(
    'module.exports = "x".repeat(300000000);',
    /resource limit|worker.*timeout/i,
  );
  assert.equal(result.status, 0, result.error?.message ?? result.stderr);
});

test("converts worker OOM into a controlled child parser error", () => {
  const result = runParserInChildExpecting(
    "module.exports = Array(10000000);",
    /config\.js.*(resource|worker|timeout|memory)/i,
  );
  assert.equal(result.status, 0, result.error?.message ?? result.stderr);
  assert.equal(result.signal, null);
  assert.doesNotMatch(result.stderr, /ERR_WORKER_OUT_OF_MEMORY|Unhandled 'error'/i);
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
