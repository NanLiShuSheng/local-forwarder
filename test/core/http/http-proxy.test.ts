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
import type { LogEntry } from "../../../src/shared/contracts";

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

function requestAbsoluteTarget(port: number, target: string): Promise<{ statusCode?: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: "127.0.0.1", port, method: "GET", path: target }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.once("end", () => resolve({ statusCode: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
    });
    request.once("error", reject);
    request.end();
  });
}

function requestOriginTarget(port: number, host: string, target: string): Promise<{ statusCode?: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: "127.0.0.1", port, method: "GET", path: target, headers: { host } }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.once("end", () => resolve({ statusCode: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
    });
    request.once("error", reject);
    request.end();
  });
}

test("flattens legacy action 10090 to 10061 navigation into one local redirect", async () => {
  const proxy = new HttpProxy({ bindHost: "127.0.0.1", port: 0, rules: [], timeoutMs: 500 });
  const finalTarget = "/newzt/bei_jiao_suo_he_ge_tou_zi_zhe_ren_ding/html/gzhgtzzrd.html";
  const outerTarget = "http://action:10090/?loginType=1&&longinKind=1&&url=http%3A%2F%2Faction%3A10061%2F%3Ffullscreen%3D1%26%26firsttype%3D10%26%26secondtype%3D9%26%26url%3D%252Fnewzt%252Fbei_jiao_suo_he_ge_tou_zi_zhe_ren_ding%252Fhtml%252Fgzhgtzzrd.html";

  try {
    const address = await proxy.start();
    const first = await requestAbsoluteTarget(address.port, outerTarget);
    assert.equal(first.statusCode, 307);
    assert.equal(first.headers.location, finalTarget);
  } finally {
    await proxy.stop();
  }
});

test("redirects a direct action 10061 URL to its local page path", async () => {
  const proxy = new HttpProxy({ bindHost: "127.0.0.1", port: 0, rules: [], timeoutMs: 500 });
  const actionTarget = "http://action:10061/?secondtype=9&&fullscreen=1&&url=%2Fnewzt%2FkeChuangBanChengZhangCeng%2FSelAccount.html";

  try {
    const address = await proxy.start();
    const result = await requestAbsoluteTarget(address.port, actionTarget);
    assert.equal(result.statusCode, 307);
    assert.equal(result.headers.location, "/newzt/keChuangBanChengZhangCeng/SelAccount.html");
  } finally {
    await proxy.stop();
  }
});

test("handles origin-form action requests identified by the Host header", async () => {
  const proxy = new HttpProxy({ bindHost: "127.0.0.1", port: 0, rules: [], timeoutMs: 500 });
  const directTarget = "/?secondtype=9&&fullscreen=1&&url=%2Fnewzt%2FkeChuangBanChengZhangCeng%2FSelAccount.html";
  const nestedTarget = "/?loginType=1&&longinKind=1&&url=http%3A%2F%2Faction%3A10061%2F%3Ffullscreen%3D1%26%26firsttype%3D10%26%26secondtype%3D9%26%26url%3D%252Fnewzt%252Fbei_jiao_suo_he_ge_tou_zi_zhe_ren_ding%252Fhtml%252Fgzhgtzzrd.html";

  try {
    const address = await proxy.start();
    const direct = await requestOriginTarget(address.port, "action:10061", directTarget);
    assert.equal(direct.statusCode, 307);
    assert.equal(direct.headers.location, "/newzt/keChuangBanChengZhangCeng/SelAccount.html");
    const nested = await requestOriginTarget(address.port, "action:10090", nestedTarget);
    assert.equal(nested.statusCode, 307);
    assert.equal(nested.headers.location, "/newzt/bei_jiao_suo_he_ge_tou_zi_zhe_ren_ding/html/gzhgtzzrd.html");
    const legacy1964 = await requestOriginTarget(address.port, "action:1964", "/?url=%2Fnewzt%2Flegacy-1964.html");
    assert.equal(legacy1964.statusCode, 301);
    assert.equal(legacy1964.headers.location, "/newzt/legacy-1964.html");
  } finally {
    await proxy.stop();
  }
});

test("stops promptly while an upstream request is still pending", async () => {
  let received!: () => void;
  const receivedPromise = new Promise<void>((resolve) => { received = resolve; });
  const target = http.createServer((_request, response) => {
    received();
    response.socket?.on("error", () => undefined);
  });
  const targetPort = await listen(target);
  const proxy = new HttpProxy({
    bindHost: "127.0.0.1",
    port: 0,
    rules: [{ id: "api", name: "api", match: "/api", target: `http://127.0.0.1:${targetPort}`, enabled: true }],
    timeoutMs: 30_000,
  });
  let client: http.ClientRequest | undefined;

  try {
    const address = await proxy.start();
    client = http.get({ host: "127.0.0.1", port: address.port, path: "/api/pending" });
    client.once("error", () => undefined);
    await receivedPromise;
    await Promise.race([
      proxy.stop(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("proxy stop timed out")), 250)),
    ]);
  } finally {
    client?.destroy();
    target.closeAllConnections();
    await proxy.stop();
    await close(target);
  }
});

test("preserves the legacy action 1964 redirect and 10002 history response", async () => {
  const proxy = new HttpProxy({ bindHost: "127.0.0.1", port: 0, rules: [], timeoutMs: 500 });

  try {
    const address = await proxy.start();
    const redirect = await requestAbsoluteTarget(address.port, "http://action:1964/?url=%2Fnewzt%2Flegacy-1964.html");
    assert.equal(redirect.statusCode, 301);
    assert.equal(redirect.headers.location, "/newzt/legacy-1964.html");

    const history = await requestAbsoluteTarget(address.port, "http://action:10002/");
    assert.equal(history.statusCode, 200);
    assert.match(history.headers["content-type"] ?? "", /text\/html/i);
    assert.match(history.body.toString(), /window\.history\.go\(-2\)/);
  } finally {
    await proxy.stop();
  }
});

test("does not forward native-only action URLs and unwraps native URL wrappers locally", async () => {
  const proxy = new HttpProxy({ bindHost: "127.0.0.1", port: 0, rules: [], timeoutMs: 500 });

  try {
    const address = await proxy.start();
    const nativeOnly = await requestOriginTarget(address.port, "action:10075", "/?hqmenuitem=303");
    assert.equal(nativeOnly.statusCode, 204);

    const wrapper = await requestAbsoluteTarget(address.port, "http://action:58300/?url=http%3A%2F%2Faction%3A10061%2F%3Furl%3D%252Fnewzt%252Fwrapped.html");
    assert.equal(wrapper.statusCode, 307);
    assert.equal(wrapper.headers.location, "/newzt/wrapped.html");
  } finally {
    await proxy.stop();
  }
});

test("logs only fetch or XHR requests and captures request and response details", async () => {
  const target = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.once("end", () => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ received: Buffer.concat(chunks).toString("utf8") }));
    });
  });
  const targetPort = await listen(target);
  const logs: LogEntry[] = [];
  const proxy = new HttpProxy({
    bindHost: "127.0.0.1",
    port: 0,
    rules: [{ id: "api", name: "api", match: "/api", target: `http://127.0.0.1:${targetPort}`, enabled: true }],
    timeoutMs: 500,
    onLog: (entry) => logs.push(entry),
  });

  try {
    const address = await proxy.start();
    await requestAbsoluteTarget(address.port, "/api/navigation");
    const response = await fetch(`http://127.0.0.1:${address.port}/api/data?from=query`, {
      method: "POST",
      headers: { "sec-fetch-dest": "empty" },
      body: "from=body",
    });
    assert.equal(response.status, 200);
    const xhrResponse = await fetch(`http://127.0.0.1:${address.port}/api/xhr`, { headers: { "x-requested-with": "XMLHttpRequest" } });
    assert.equal(xhrResponse.status, 200);
    assert.equal(logs.length, 2);
    assert.equal(logs[0]?.requestType, "fetch");
    assert.equal(logs[0]?.requestPath, "/api/data");
    assert.match(logs[0]?.requestParams ?? "", /from=query/);
    assert.match(logs[0]?.requestParams ?? "", /from=body/);
    assert.match(logs[0]?.responseData ?? "", /RECEIVED/);
    assert.equal(logs[1]?.requestType, "xhr");
    assert.equal(logs[1]?.requestPath, "/api/xhr");
  } finally {
    await proxy.stop();
    await close(target);
  }
});

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
    assert.deepEqual(await gzip.json(), { OK: true });
    const binary = await fetch(`http://127.0.0.1:${address.port}/api/binary`);
    assert.deepEqual([...new Uint8Array(await binary.arrayBuffer())], [0, 255, 1]);
    assert.equal(binary.headers.get("content-encoding"), null);
  } finally {
    await proxy.stop();
    await close(target);
  }
});

test("substitutes local variables in ordinary POST request bodies like proxy3", async () => {
  const target = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end(Buffer.concat(chunks));
    });
  });
  const targetPort = await listen(target);
  const proxy = new HttpProxy({
    bindHost: "127.0.0.1",
    port: 0,
    rules: [{ id: "api", name: "api", match: "/api", target: `http://127.0.0.1:${targetPort}`, enabled: true }],
    localValues: { MOBILECODE: "17000000000" },
    timeoutMs: 500,
  });

  try {
    const address = await proxy.start();
    const response = await fetch(`http://127.0.0.1:${address.port}/api`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "mobileCode=($mobileCode)",
    });
    assert.equal(await response.text(), "mobileCode=17000000000");
  } finally {
    await proxy.stop();
    await close(target);
  }
});

test("uppercases top-level JSON response keys like the legacy proxy", async () => {
  const target = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ action: "100", token: "response-token", nested: { sessionNo: "4" } }));
  });
  const targetPort = await listen(target);
  const proxy = new HttpProxy({
    bindHost: "127.0.0.1",
    port: 0,
    rules: [{ id: "json", name: "json", match: "/json", target: `http://127.0.0.1:${targetPort}`, enabled: true }],
    timeoutMs: 500,
  });

  try {
    const address = await proxy.start();
    const response = await fetch(`http://127.0.0.1:${address.port}/json`);
    assert.deepEqual(await response.json(), {
      ACTION: "100",
      TOKEN: "response-token",
      NESTED: { sessionNo: "4" },
    });
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

test("emits captured HTTP login values separately from effective runtime values", async () => {
  const target = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ACTION: "100", TOKEN: "captured-token", SessionNo: 7 }));
  });
  const targetPort = await listen(target);
  const captured: Record<string, string>[] = [];
  const proxy = new HttpProxy({
    bindHost: "127.0.0.1",
    port: 0,
    rules: [{ id: "login", name: "login", match: "/login-cache", target: `http://127.0.0.1:${targetPort}`, enabled: true }],
    localValues: { ACCOUNT: "shared" },
    onLoginValuesChanged: (values) => captured.push(values),
    timeoutMs: 500,
  } as any);

  try {
    const address = await proxy.start();
    await fetch(`http://127.0.0.1:${address.port}/login-cache`);
    assert.deepEqual(captured, [{ ACTION: "100", TOKEN: "captured-token", SESSIONNO: "7" }]);
    assert.deepEqual(proxy.getValues().localValues, { ACCOUNT: "shared", ACTION: "100", TOKEN: "captured-token", SESSIONNO: "7" });
  } finally {
    await proxy.stop();
    await close(target);
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

test("substitutes local variables in login account fields like proxy3", async () => {
  const target = http.createServer((request, response) => {
    assert.match(request.url ?? "", /mobilecode=17000000000/i);
    assert.doesNotMatch(request.url ?? "", /\(\$mobileCode\)/i);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ACTION: "100", ERRORNO: "0" }));
  });
  const targetPort = await listen(target);
  const proxy = new HttpProxy({
    bindHost: "127.0.0.1",
    port: 0,
    rules: [],
    localValues: { MOBILECODE: "17000000000" },
    accounts: { ptjy: { mobilecode: "($mobileCode)" } },
    tcpTargets: [{ id: "jy", name: "jy", host: "127.0.0.1", port: targetPort, protocol: "http", transport: "http", enabled: true }],
    timeoutMs: 500,
  });

  try {
    const address = await proxy.start();
    const response = await fetch(`http://127.0.0.1:${address.port}/login?type=ptjy`);
    assert.equal(response.status, 200);
  } finally {
    await proxy.stop();
    await close(target);
  }
});

test("uses the jy reqxml target when ReqLinkType is omitted", async () => {
  const bridge = {
    request: async (target: { host: string }, _query: Record<string, string>) => ({ TARGET: target.host }),
  };
  const proxy = new HttpProxy({
    bindHost: "127.0.0.1",
    port: 0,
    rules: [],
    tcpTargets: [
      { id: "hq", name: "hq", host: "hq-target", port: 9000, enabled: true },
      { id: "jy", name: "jy", host: "jy-target", port: 9001, enabled: true },
      { id: "zx", name: "zx", host: "zx-target", port: 9002, enabled: true },
    ],
    tcpBridge: bridge,
    timeoutMs: 500,
  });

  try {
    const address = await proxy.start();
    const response = await fetch(`http://127.0.0.1:${address.port}/reqxml?Action=100`);
    assert.deepEqual(await response.json(), { TARGET: "jy-target" });
    for (const [linkType, target] of [["0", "hq-target"], ["1", "jy-target"], ["2", "zx-target"]] as const) {
      const typed = await fetch(`http://127.0.0.1:${address.port}/reqxml?ReqLinkType=${linkType}&Action=100`);
      assert.deepEqual(await typed.json(), { TARGET: target });
    }
  } finally {
    await proxy.stop();
  }
});

test("handles local values, maps, files, and TCP reqxml without leaving data in the renderer", async () => {
  const bridge = { request: async (_target: unknown, query: Record<string, string>) => ({ Action: query.Action ?? "", ERRORNO: "0" }) };
  const logs: LogEntry[] = [];
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
    onLog: (entry) => logs.push(entry),
  });

  try {
    const address = await proxy.start();
    const local = await fetch(`http://127.0.0.1:${address.port}/reqlocal?token=TOKEN&missing=MISSING`);
    assert.deepEqual(await local.json(), { TOKEN: "fixture-token", MISSING: "" });
    const saveMap = await fetch(`http://127.0.0.1:${address.port}/reqsavemap?key=value`);
    assert.deepEqual(await saveMap.json(), { ERRORNO: "0" });
    const readMap = await fetch(`http://127.0.0.1:${address.port}/reqreadmap?key=x`, { headers: { "sec-fetch-dest": "empty" } });
    assert.deepEqual(await readMap.json(), { KEY: "value" });
    assert.equal(logs.at(-1)?.requestPath, "/reqreadmap");
    const saveFile = await fetch(`http://127.0.0.1:${address.port}/reqsavefile?filename=fixture.txt`, { method: "POST", body: "file-data" });
    assert.deepEqual(await saveFile.json(), { ERRORNO: "0" });
    const readFile = await fetch(`http://127.0.0.1:${address.port}/reqreadfile?filename=fixture.txt`);
    assert.equal(await readFile.text(), "file-data");
    const xml = await fetch(`http://127.0.0.1:${address.port}/reqxml?Action=100`);
    assert.deepEqual(await xml.json(), { ACTION: "100", ERRORNO: "0" });
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
  const source = [
    "window.onJsOverrideUrlLoading = function(str, checkFlag){",
    "window.MyWebView.onJsOverrideUrlLoading(str)",
  ].join("\n");
  const compressed = gzipSync(Buffer.from(source));
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
    const firstText = await first.text();
    assert.match(firstText, /window\.location\.href = str;/);
    assert.doesNotMatch(firstText, /window\.MyWebView\.onJsOverrideUrlLoading/);
    assert.equal(downloadCount, 1);
    const alreadyEncoded = await fetch(`http://127.0.0.1:${address.port}/qdymanage?url=/TZT.js.d`);
    assert.equal(alreadyEncoded.status, 200);
    assert.match(await alreadyEncoded.text(), /window\.location\.href = str;/);
    assert.equal(downloadCount, 1);
    await close(target);
    const second = await fetch(`http://127.0.0.1:${address.port}/qdymanage?url=/TZT.js`);
    assert.equal(second.status, 200);
    assert.match(await second.text(), /window\.location\.href = str;/);
    assert.equal(downloadCount, 1);
  } finally {
    await proxy.stop();
    await cache.close();
    await rm(rootDir, { recursive: true, force: true });
    if (target.listening) await close(target);
  }
});
