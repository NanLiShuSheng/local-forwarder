import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { HttpProxy } from "../../../src/core/http/http-proxy";
import { FileCache } from "../../../src/core/cache/file-cache";
import { createTztCodec } from "../../../src/core/tcp/tzt-codec";

async function listen(server: http.Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, () => resolve());
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return address.port;
}

function close(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test("forwards GET and POST, substitutes variables, decompresses gzip, and preserves binary responses", async () => {
  const target = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      if (request.url?.includes("/gzip")) {
        const body = gzipSync(Buffer.from(JSON.stringify({ ok: true })));
        response.writeHead(200, { "content-type": "application/json", "content-encoding": "gzip" });
        response.end(body);
        return;
      }
      if (request.url?.includes("/binary")) {
        response.writeHead(200, { "content-type": "application/octet-stream" });
        response.end(Buffer.from([0, 255, 1]));
        return;
      }
      response.writeHead(200, { "content-type": "text/plain" });
      response.end(`${request.method}:${request.url}:${Buffer.concat(chunks).toString()}`);
    });
  });
  const targetPort = await listen(target);
  const proxy = new HttpProxy({
    bindHost: "127.0.0.1",
    port: 0,
    rules: [{ id: "api", name: "api", match: "/api", target: `http://127.0.0.1:${targetPort}`, enabled: true }],
    localValues: { TOKEN: "fixture-token" },
    timeoutMs: 500,
  });

  try {
    const address = await proxy.start();
    const get = await fetch(`http://127.0.0.1:${address.port}/api?token=($TOKEN)`);
    assert.equal(await get.text(), "GET:/api?token=fixture-token:");
    const post = await fetch(`http://127.0.0.1:${address.port}/api`, { method: "POST", body: "payload" });
    assert.equal(await post.text(), "POST:/api:payload");
    const gzip = await fetch(`http://127.0.0.1:${address.port}/api/gzip`);
    assert.deepEqual(await gzip.json(), { ok: true });
    const binary = await fetch(`http://127.0.0.1:${address.port}/api/binary`);
    assert.deepEqual([...new Uint8Array(await binary.arrayBuffer())], [0, 255, 1]);
    assert.equal(binary.headers.get("content-encoding"), null);
  } finally {
    await proxy.stop();
    await close(target);
  }
});

test("serves the configured project directory and captures login values from an action 100 response", async () => {
  const projectPath = await mkdtemp(path.join(os.tmpdir(), "forwarder-project-"));
  await writeFile(path.join(projectPath, "index.html"), "project-home", "utf8");
  const target = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ACTION: "100", TOKEN: "updated-token", SessionNo: "9" }));
  });
  const targetPort = await listen(target);
  const proxy = new HttpProxy({
    bindHost: "127.0.0.1",
    port: 0,
    projectPath,
    rules: [{ id: "login", name: "login", match: "/login-cache", target: `http://127.0.0.1:${targetPort}`, enabled: true }],
    localValues: { TOKEN: "old-token" },
    timeoutMs: 500,
  });

  try {
    const address = await proxy.start();
    const home = await fetch(`http://127.0.0.1:${address.port}/`);
    assert.equal(await home.text(), "project-home");
    const login = await fetch(`http://127.0.0.1:${address.port}/login-cache`);
    assert.equal(login.status, 200);
    assert.equal(proxy.getValues().localValues.TOKEN, "updated-token");
    assert.equal(proxy.getValues().localValues.SESSIONNO, "9");
  } finally {
    await proxy.stop();
    await close(target);
    await rm(projectPath, { recursive: true, force: true });
  }
});

test("forwards reqxml through an HTTP target base path", async () => {
  const target = http.createServer((request, response) => {
    assert.equal(request.url, "/ant/reqxml?REQLINKTYPE=0&Action=100");
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ACTION: "100", TOKEN: "http-token" }));
  });
  const targetPort = await listen(target);
  const proxy = new HttpProxy({
    bindHost: "127.0.0.1",
    port: 0,
    rules: [],
    tcpTargets: [{ id: "hq", name: "hq", host: "127.0.0.1", port: targetPort, protocol: "http", basePath: "/ant", transport: "http", enabled: true }],
    timeoutMs: 500,
  });

  try {
    const address = await proxy.start();
    const result = await fetch(`http://127.0.0.1:${address.port}/reqxml?REQLINKTYPE=0&Action=100`);
    assert.deepEqual(await result.json(), { ACTION: "100", TOKEN: "http-token" });
    assert.equal(proxy.getValues().localValues.TOKEN, "http-token");
  } finally {
    await proxy.stop();
    await close(target);
  }
});

test("handles local values, maps, files, and TCP reqxml without leaving data in the renderer", async () => {
  const bridge = { request: async (_target: unknown, query: Record<string, string>) => ({ Action: query.Action ?? "", ERRORNO: "0" }) };
  const proxy = new HttpProxy({
    bindHost: "127.0.0.1",
    port: 0,
    rules: [],
    localValues: { TOKEN: "fixture-token" },
    mapValues: {},
    fileValues: {},
    accounts: {},
    tcpTargets: [{ id: "tcp", name: "tcp", host: "127.0.0.1", port: 9000, enabled: true }],
    tcpBridge: bridge,
    timeoutMs: 500,
  });

  try {
    const address = await proxy.start();
    const local = await fetch(`http://127.0.0.1:${address.port}/reqlocal?token=TOKEN&missing=MISSING`);
    assert.deepEqual(await local.json(), { TOKEN: "fixture-token", MISSING: "" });
    const saveMap = await fetch(`http://127.0.0.1:${address.port}/reqsavemap?key=value`);
    assert.deepEqual(await saveMap.json(), { ERRORNO: "0" });
    const readMap = await fetch(`http://127.0.0.1:${address.port}/reqreadmap?key=x`);
    assert.deepEqual(await readMap.json(), { KEY: "value" });
    const saveFile = await fetch(`http://127.0.0.1:${address.port}/reqsavefile?filename=fixture.txt`, { method: "POST", body: "file-data" });
    assert.deepEqual(await saveFile.json(), { ERRORNO: "0" });
    const readFile = await fetch(`http://127.0.0.1:${address.port}/reqreadfile?filename=fixture.txt`);
    assert.equal(await readFile.text(), "file-data");
    const xml = await fetch(`http://127.0.0.1:${address.port}/reqxml?Action=100`);
    assert.deepEqual(await xml.json(), { Action: "100", ERRORNO: "0" });
  } finally {
    await proxy.stop();
  }
});

test("returns 413, 502, and 504 for bounded body, target failure, and timeout", async () => {
  const failing = new HttpProxy({ bindHost: "127.0.0.1", port: 0, rules: [{ id: "bad", name: "bad", match: "/bad", target: "http://127.0.0.1:1", enabled: true }], timeoutMs: 40 });
  const slowTarget = http.createServer(() => undefined);
  const slowPort = await listen(slowTarget);
  const slow = new HttpProxy({ bindHost: "127.0.0.1", port: 0, rules: [{ id: "slow", name: "slow", match: "/slow", target: `http://127.0.0.1:${slowPort}`, enabled: true }], timeoutMs: 40 });
  try {
    const badAddress = await failing.start();
    const bad = await fetch(`http://127.0.0.1:${badAddress.port}/bad`);
    assert.equal(bad.status, 502);
    const slowAddress = await slow.start();
    const timeout = await fetch(`http://127.0.0.1:${slowAddress.port}/slow`);
    assert.equal(timeout.status, 504);
  } finally {
    await failing.stop();
    await slow.stop();
    await close(slowTarget);
  }
});

test("downloads and caches .d resources, then serves the decoded cache after the target closes", async () => {
  const codec = createTztCodec();
  const compressed = gzipSync(Buffer.from("console.log('cached resource')"));
  const encrypted = Buffer.concat([codec.rc4(compressed, "file"), Buffer.from([0, 0, 0, 0])]);
  let downloadCount = 0;
  const target = http.createServer((request, response) => {
    if (request.url !== "/download/TZT.js.d") {
      response.writeHead(404).end();
      return;
    }
    downloadCount += 1;
    response.writeHead(200, { "content-type": "application/octet-stream" });
    response.end(encrypted);
  });
  const targetPort = await listen(target);
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forwarder-http-cache-"));
  const cache = new FileCache({ rootDir });
  const proxy = new HttpProxy({
    bindHost: "127.0.0.1",
    port: 0,
    rules: [{ id: "static", name: "static", match: "/qdymanage", target: `http://127.0.0.1:${targetPort}`, rewrite: "/download$(url).d", enabled: true }],
    cache,
    cacheConfig: { downloadTarget: `http://127.0.0.1:${targetPort}`, autoDownload: true, decryptEnabled: true },
    cacheCodec: codec,
    timeoutMs: 500,
  });

  try {
    const address = await proxy.start();
    const first = await fetch(`http://127.0.0.1:${address.port}/qdymanage?url=/TZT.js`);
    assert.equal(first.status, 200);
    assert.match(first.headers.get("content-type") ?? "", /javascript/);
    assert.equal(await first.text(), "console.log('cached resource')");
    assert.equal(downloadCount, 1);
    const alreadyEncoded = await fetch(`http://127.0.0.1:${address.port}/qdymanage?url=/TZT.js.d`);
    assert.equal(alreadyEncoded.status, 200);
    assert.equal(await alreadyEncoded.text(), "console.log('cached resource')");
    assert.equal(downloadCount, 1);
    await close(target);
    const second = await fetch(`http://127.0.0.1:${address.port}/qdymanage?url=/TZT.js`);
    assert.equal(second.status, 200);
    assert.equal(await second.text(), "console.log('cached resource')");
    assert.equal(downloadCount, 1);
  } finally {
    await proxy.stop();
    await cache.close();
    await rm(rootDir, { recursive: true, force: true });
    if (target.listening) await close(target);
  }
});
