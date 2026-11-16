import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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

function withResourceVersion(contents: string, version: number): Buffer {
  const trailer = Buffer.alloc(4);
  trailer.writeUInt32LE(version);
  return Buffer.concat([Buffer.from(contents), trailer]);
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

test("routes HSComm LoadBalance.dll and root action requests through reqxml", async () => {
  const queries: Array<Record<string, string>> = [];
  const tcpBridge = {
    request: async (_target: { host: string; port: number }, query: Record<string, string>) => {
      queries.push(query);
      return { Action: query.Action, ErrorNo: "0" };
    },
  };
  const projectPath = await mkdtemp(path.join(os.tmpdir(), "local-forwarder-"));
  const proxy = new HttpProxy({
    bindHost: "127.0.0.1",
    port: 0,
    rules: [],
    timeoutMs: 500,
    projectPath,
    defaultDocument: "index.html",
    tcpTargets: [{ id: "zx", name: "zx", host: "127.0.0.1", port: 7777, enabled: true }],
    tcpBridge,
  });

  try {
    await writeFile(path.join(projectPath, "index.html"), "static index");
    const address = await proxy.start();
    const loadBalance = await fetch(`http://127.0.0.1:${address.port}/LoadBalance.dll`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "Action=41035&newindex=1",
    });
    const rootAction = await fetch(`http://127.0.0.1:${address.port}/`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "Action=49000",
    });
    const staticRoot = await fetch(`http://127.0.0.1:${address.port}/`);

    assert.equal(loadBalance.status, 200);
    assert.deepEqual(await loadBalance.json(), { ACTION: "41035", ERRORNO: "0" });
    assert.equal(rootAction.status, 200);
    assert.deepEqual(await rootAction.json(), { ACTION: "49000", ERRORNO: "0" });
    assert.equal(staticRoot.status, 200);
    assert.equal(await staticRoot.text(), "static index");
    assert.deepEqual(queries.map((query) => query.Action), ["41035", "49000"]);
  } finally {
    await proxy.stop();
    await rm(projectPath, { recursive: true, force: true });
  }
});

test("serves Action 3010 from local download files without calling the TCP bridge", async () => {
  let bridgeCalls = 0;
  const tcpBridge = {
    request: async () => {
      bridgeCalls += 1;
      throw new Error("Action 3010 must not reach the TCP bridge");
    },
  };
  const projectPath = await mkdtemp(path.join(os.tmpdir(), "local-forwarder-"));
  await mkdir(path.join(projectPath, "download", "nested"), { recursive: true });
  await writeFile(path.join(projectPath, "download", "nested", "app.js.d"), withResourceVersion("cached", 42));
  const proxy = new HttpProxy({
    bindHost: "127.0.0.1",
    port: 0,
    rules: [],
    timeoutMs: 500,
    projectPath,
    tcpTargets: [{ id: "zx", name: "zx", host: "127.0.0.1", port: 7777, enabled: true }],
    tcpBridge,
  });

  try {
    const address = await proxy.start();
    const matched = await fetch(`http://127.0.0.1:${address.port}/LoadBalance.dll`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ Action: "3010", GRID: "/NESTED/APP.JS.D=42" }).toString(),
    });
    assert.equal(matched.status, 200);
    assert.deepEqual(await matched.json(), { ERRORNO: "0", ACTION: "3010" });
    assert.equal(bridgeCalls, 0);

    const changed = await fetch(`http://127.0.0.1:${address.port}/LoadBalance.dll`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ Action: "3010", GRID: "/nested/app.js.d=41\r\n/missing.d=0\nnot-a-grid-line\n\n" }).toString(),
    });
    assert.equal(changed.status, 200);
    assert.deepEqual(await changed.json(), {
      GRID0: ["/nested/app.js.d|", "/missing.d|"],
      ERRORNO: "2",
      ACTION: "3010",
    });
    assert.equal(bridgeCalls, 0);
  } finally {
    await proxy.stop();
    await rm(projectPath, { recursive: true, force: true });
  }
});

test("counts Action 3010 changes for missing, short, duplicate, and invalid entries", async () => {
  const projectPath = await mkdtemp(path.join(os.tmpdir(), "local-forwarder-"));
  await mkdir(path.join(projectPath, "download"), { recursive: true });
  await writeFile(path.join(projectPath, "root-only.d"), withResourceVersion("root", 9));
  await writeFile(path.join(projectPath, "download", "match.d"), withResourceVersion("ok", 7));
  await writeFile(path.join(projectPath, "download", "changed.d"), withResourceVersion("new", 8));
  await writeFile(path.join(projectPath, "download", "short.d"), Buffer.from("abc"));
  const tcpBridge = { request: async () => { throw new Error("Action 3010 must not reach the TCP bridge"); } };
  const proxy = new HttpProxy({
    bindHost: "127.0.0.1",
    port: 0,
    rules: [],
    timeoutMs: 500,
    projectPath,
    tcpTargets: [{ id: "zx", name: "zx", host: "127.0.0.1", port: 7777, enabled: true }],
    tcpBridge,
  });
  const grid = [
    "",
    "not-a-grid-line",
    "=0",
    "match.d=0007",
    "/changed.d=7",
    "/short.d=0",
    "/missing.d=0",
    "/changed.d=7",
    "/invalid.d=abc",
    "/negative.d=-0",
    "/too-large.d=4294967296",
    "/empty-version.d=",
    "/=0",
    "/root-only.d=9",
  ].join("\r\n");

  try {
    const address = await proxy.start();
    const response = await fetch(`http://127.0.0.1:${address.port}/LoadBalance.dll`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ Action: "3010", GRID: grid }).toString(),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      GRID0: [
        "/changed.d|",
        "/short.d|",
        "/missing.d|",
        "/changed.d|",
        "/invalid.d|",
        "/negative.d|",
        "/too-large.d|",
        "/empty-version.d|",
        "/|",
        "/root-only.d|",
      ],
      ERRORNO: "10",
      ACTION: "3010",
    });
  } finally {
    await proxy.stop();
    await rm(projectPath, { recursive: true, force: true });
  }
});

test("reads Action 3010 from GRID case-insensitively and ignores GRID0 through GRID5", async () => {
  const projectPath = await mkdtemp(path.join(os.tmpdir(), "local-forwarder-"));
  await mkdir(path.join(projectPath, "download"), { recursive: true });
  await writeFile(path.join(projectPath, "download", "match.d"), withResourceVersion("ok", 7));
  const tcpBridge = { request: async () => { throw new Error("Action 3010 must not reach the TCP bridge"); } };
  const proxy = new HttpProxy({
    bindHost: "127.0.0.1",
    port: 0,
    rules: [],
    timeoutMs: 500,
    projectPath,
    tcpTargets: [{ id: "zx", name: "zx", host: "127.0.0.1", port: 7777, enabled: true }],
    tcpBridge,
  });

  try {
    const address = await proxy.start();
    const response = await fetch(`http://127.0.0.1:${address.port}/LoadBalance.dll`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        Action: "3010",
        grid: "/match.d=7\n/missing.d=0",
        GRID0: "/ignored-0.d=0",
        GRID1: "/ignored-1.d=0",
        GRID2: "/ignored-2.d=0",
        GRID3: "/ignored-3.d=0",
        GRID4: "/ignored-4.d=0",
        GRID5: "/ignored-5.d=0",
      }).toString(),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      GRID0: ["/missing.d|"],
      ERRORNO: "1",
      ACTION: "3010",
    });
  } finally {
    await proxy.stop();
    await rm(projectPath, { recursive: true, force: true });
  }
});

test("logs every HTTP request when all-request diagnostics are enabled", async () => {
  const logs: LogEntry[] = [];
  const proxy = new HttpProxy({
    bindHost: "127.0.0.1",
    port: 0,
    rules: [],
    timeoutMs: 500,
    logAllRequests: true,
    onLog: (entry) => logs.push(entry),
  });

  try {
    const address = await proxy.start();
    await new Promise<void>((resolve, reject) => {
      const request = http.request({
        host: "127.0.0.1",
        port: address.port,
        method: "POST",
        path: "/phone-probe?Action=41035",
        headers: { "content-type": "application/x-www-form-urlencoded" },
      }, (response) => {
        response.resume();
        response.once("end", () => resolve());
      });
      request.once("error", reject);
      request.end("Action=41035");
    });

    assert.equal(logs.length, 1);
    assert.equal(logs[0]?.requestType, "http");
    assert.equal(logs[0]?.requestPath, "/phone-probe");
    assert.equal(logs[0]?.statusCode, 404);
  } finally {
    await proxy.stop();
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
    response.end(JSON.stringify({ ACTION: "100", ERRORNO: "1", TOKEN: "updated-token", SessionNo: "9" }));
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

test("serves gzip-encoded default .d HTML with a gzip response header", async () => {
  const codec = createTztCodec();
  const projectPath = await mkdtemp(path.join(os.tmpdir(), "forwarder-gzip-project-"));
  const html = "<!doctype html><html><body>local-info</body></html>";
  const encoded = Buffer.concat([codec.rc4(gzipSync(Buffer.from(html)), "file"), Buffer.from([0, 0, 0, 0])]);
  await writeFile(path.join(projectPath, "index.html.d"), encoded);
  const proxy = new HttpProxy({
    bindHost: "127.0.0.1",
    port: 0,
    projectPath,
    defaultDocument: "index.html",
    decodeStaticDResources: true,
    cacheCodec: codec,
    rules: [],
    timeoutMs: 500,
  });

  try {
    const address = await proxy.start();
    const response = await fetch(`http://127.0.0.1:${address.port}/`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-encoding"), "gzip");
    assert.equal(await response.text(), html);
  } finally {
    await proxy.stop();
    await rm(projectPath, { recursive: true, force: true });
  }
});

test("serves HSComm HTTP.DirList files as raw Windows static responses", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hscomm-static-"));
  await mkdir(path.join(root, "download"), { recursive: true });
  await mkdir(path.join(root, "Doc"), { recursive: true });
  const raw = Buffer.from([0x35, 0x3e, 0x90, 0x29, 0x00, 0xff, 0x7f]);
  await writeFile(path.join(root, "download", "index.html.d"), raw);
  await writeFile(path.join(root, "Doc", "foo.txt.d"), "doc-bytes");
  await writeFile(path.join(root, "index.html.d"), raw);
  const proxy = new HttpProxy({
    bindHost: "127.0.0.1",
    port: 0,
    projectPath: root,
    defaultDocument: "LoadBalance.dll",
    httpDirectories: ["/DownLoad/", "/Doc/"],
    decodeStaticDResources: true,
    cacheCodec: createTztCodec(),
    rules: [],
    timeoutMs: 500,
  });

  try {
    const address = await proxy.start();
    const file = await fetch(`http://127.0.0.1:${address.port}/DownLoad/index.html.d`);
    assert.equal(file.status, 200);
    assert.equal(file.headers.get("content-type"), "application/binary");
    assert.equal(file.headers.get("accept-ranges"), "bytes");
    assert.ok(file.headers.get("last-modified"));
    assert.equal(file.headers.get("date"), null);
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), raw);

    const secondDirectory = await fetch(`http://127.0.0.1:${address.port}/Doc/foo.txt.d`);
    assert.equal(secondDirectory.status, 200);
    assert.equal(secondDirectory.headers.get("content-type"), "application/binary");
    assert.equal(await secondDirectory.text(), "doc-bytes");

    const withoutEncodingSuffix = await fetch(`http://127.0.0.1:${address.port}/DownLoad/index.html`);
    assert.equal(withoutEncodingSuffix.status, 404);

    const outsideDirList = await fetch(`http://127.0.0.1:${address.port}/index.html.d`);
    assert.equal(outsideDirList.status, 404);
    assert.equal(outsideDirList.headers.get("content-type"), "text/html");
    assert.equal(outsideDirList.headers.get("date"), null);
    assert.equal(await outsideDirList.text(), "<HTML><HEAD><TITLE>404 Not Found</TITLE></HEAD><BODY><H1>404 Not Found</H1>The requested URL /index.html.d was not found on this server.<P></BODY></HTML>\r\n");

    const directory = await fetch(`http://127.0.0.1:${address.port}/DownLoad/`);
    assert.equal(directory.status, 404);
    assert.equal(await directory.text(), "<HTML><HEAD><TITLE>404 Not Found</TITLE></HEAD><BODY><H1>404 Not Found</H1>The requested URL /DownLoad/ was not found on this server.<P></BODY></HTML>\r\n");

    const withoutTrailingSlash = await fetch(`http://127.0.0.1:${address.port}/DownLoad`);
    assert.equal(withoutTrailingSlash.status, 404);
    assert.equal(await withoutTrailingSlash.text(), "<HTML><HEAD><TITLE>404 Not Found</TITLE></HEAD><BODY><H1>404 Not Found</H1>The requested URL /DownLoad was not found on this server.<P></BODY></HTML>\r\n");

    const missing = await fetch(`http://127.0.0.1:${address.port}/DownLoad/missing.html.d`);
    assert.equal(missing.status, 404);
    assert.equal(await missing.text(), "<HTML><HEAD><TITLE>404 Not Found</TITLE></HEAD><BODY><H1>404 Not Found</H1>The requested URL /DownLoad/missing.html.d was not found on this server.<P></BODY></HTML>\r\n");
  } finally {
    await proxy.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test("uses the root default document only when DirList allows that path", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hscomm-static-root-"));
  const raw = Buffer.from("default document");
  await writeFile(path.join(root, "index.html.d"), raw);
  const proxy = new HttpProxy({
    bindHost: "127.0.0.1",
    port: 0,
    projectPath: root,
    defaultDocument: "index.html.d",
    httpDirectories: ["/"],
    rules: [],
    timeoutMs: 500,
  });

  try {
    const address = await proxy.start();
    const response = await fetch(`http://127.0.0.1:${address.port}/`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/binary");
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), raw);
  } finally {
    await proxy.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test("returns the Windows HTML 404 for the root when DefaultDoc is outside DirList", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hscomm-static-root-"));
  const proxy = new HttpProxy({
    bindHost: "127.0.0.1",
    port: 0,
    projectPath: root,
    defaultDocument: "LoadBalance.dll",
    httpDirectories: ["/DownLoad/"],
    rules: [],
    timeoutMs: 500,
  });

  try {
    const address = await proxy.start();
    const response = await fetch(`http://127.0.0.1:${address.port}/`);
    assert.equal(response.status, 404);
    assert.equal(response.headers.get("content-type"), "text/html");
    assert.equal(response.headers.get("date"), null);
    assert.equal(await response.text(), "<HTML><HEAD><TITLE>404 Not Found</TITLE></HEAD><BODY><H1>404 Not Found</H1>The requested URL / was not found on this server.<P></BODY></HTML>\r\n");
  } finally {
    await proxy.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test("emits captured HTTP login values separately from effective runtime values", async () => {
  const target = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ACTION: "100", ERRORNO: "1", TOKEN: "captured-token", SessionNo: 7 }));
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
    assert.deepEqual(captured, [{ ACTION: "100", ERRORNO: "1", TOKEN: "captured-token", SESSIONNO: "7" }]);
    assert.deepEqual(proxy.getValues().localValues, { ACCOUNT: "shared", ACTION: "100", ERRORNO: "1", TOKEN: "captured-token", SESSIONNO: "7" });
  } finally {
    await proxy.stop();
    await close(target);
  }
});

test("does not capture HTTP login values when ErrorNo is zero, negative, or missing", async () => {
  const target = http.createServer((request, response) => {
    const pathname = new URL(request.url ?? "/", "http://local-forwarder.invalid").pathname;
    response.writeHead(200, { "content-type": "application/json" });
    if (pathname === "/action-zero") response.end(JSON.stringify({ ACTION: "100", ERRORNO: "0", TOKEN: "failed-token", SessionNo: 9 }));
    else if (pathname === "/token-negative") response.end(JSON.stringify({ ERRORNO: "-1", TOKEN: "failed-token" }));
    else response.end(JSON.stringify({ ACTION: "100", TOKEN: "missing-error-no" }));
  });
  const targetPort = await listen(target);
  const captured: Record<string, string>[] = [];
  const proxy = new HttpProxy({
    bindHost: "127.0.0.1",
    port: 0,
    rules: [
      { id: "action-zero", name: "action-zero", match: "/action-zero", target: `http://127.0.0.1:${targetPort}`, enabled: true },
      { id: "token-negative", name: "token-negative", match: "/token-negative", target: `http://127.0.0.1:${targetPort}`, enabled: true },
      { id: "action-missing", name: "action-missing", match: "/action-missing", target: `http://127.0.0.1:${targetPort}`, enabled: true },
    ],
    localValues: { TOKEN: "old-token" },
    onLoginValuesChanged: (values) => captured.push(values),
    timeoutMs: 500,
  });

  try {
    const address = await proxy.start();
    await fetch(`http://127.0.0.1:${address.port}/action-zero`);
    await fetch(`http://127.0.0.1:${address.port}/token-negative`);
    await fetch(`http://127.0.0.1:${address.port}/action-missing`);
    assert.deepEqual(captured, []);
    assert.deepEqual(proxy.getValues().localValues, { TOKEN: "old-token" });
  } finally {
    await proxy.stop();
    await close(target);
  }
});

test("forwards reqxml through an HTTP target base path", async () => {
  const target = http.createServer((request, response) => {
    assert.equal(request.url, "/ant/reqxml?REQLINKTYPE=0&Action=100");
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ACTION: "100", ERRORNO: "1", TOKEN: "http-token" }));
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
    assert.deepEqual(await result.json(), { ACTION: "100", ERRORNO: "1", TOKEN: "http-token" });
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
    proxy.setMapValues({ SEEDED: "initial" });
    const seededMap = await fetch(`http://127.0.0.1:${address.port}/reqreadmap?seeded=x`);
    assert.deepEqual(await seededMap.json(), { SEEDED: "initial" });
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
