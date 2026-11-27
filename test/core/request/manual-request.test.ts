import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { createManualRequestLogEntry, extractManualLoginValues, formatTztResponse, ManualTcpRequestBridge, sendManualRequest } from "../../../src/core/request/manual-request";
import { parseManualRequestParams } from "../../../src/shared/manual-request";
import { createTztCodec } from "../../../src/core/tcp/tzt-codec";

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, () => {
      const address = server.address();
      if (address === null || typeof address === "string") return reject(new Error("server did not expose an address"));
      resolve(address.port);
    });
  });
}

test("parses pasted request parameters while preserving text after the first equals sign", () => {
  assert.deepEqual(Object.fromEntries(Object.entries(parseManualRequestParams("Action=100\naccount=600554432\nurl=a=b"))), {
    Action: "100",
    account: "600554432",
    url: "a=b",
  });
});

test("treats semicolon-prefixed lines as comments and keeps the last duplicate value like the native client", () => {
  assert.deepEqual(Object.fromEntries(Object.entries(parseManualRequestParams("Action=100\naccount=first\n;account=commented\naccount=last\n;password=old"))), {
    Action: "100",
    account: "last",
  });
});

test("formats TZT responses as readable key-value lines and expands Grid0", () => {
  assert.equal(formatTztResponse({
    Action: "100",
    Grid0: ["银行代码|银行名称|币种代码|币种类别|", " | | | |"],
    AccountList: "HKSZACCOUNT|0252592877|深HK|\u0003HKACCOUNT|A344661738|沪HK|",
    IntactToServer: "value",
  }), "Action = 100\nGrid = 银行代码|银行名称|币种代码|币种类别|\n | | | |\nAccountList = HKSZACCOUNT|0252592877|深HK|HKACCOUNT|A344661738|沪HK|\nIntacttoserver = value");
});

test("caches successful login actions 100, 104, and 105 when ErrorNo is greater than zero", () => {
  assert.deepEqual(extractManualLoginValues("action=100", "Action = 100\nErrorNo = 100015\nToken = token-100"), {
    ACTION: "100",
    ERRORNO: "100015",
    TOKEN: "token-100",
  });
  assert.deepEqual(extractManualLoginValues("Action = 104", JSON.stringify({ Action: "104", ErrorNo: 7, SessionNo: 7 })), {
    ACTION: "104",
    ERRORNO: "7",
    SESSIONNO: "7",
  });
  assert.deepEqual(extractManualLoginValues("ACTION=105", "Action = 105\nErrorNo = 2\nUserCode = user-105"), {
    ACTION: "105",
    ERRORNO: "2",
    USERCODE: "user-105",
  });
  assert.equal(extractManualLoginValues("Action=101", "Action = 101\nToken = not-login"), undefined);
});

test("ignores login responses when ErrorNo is zero, negative, or missing", () => {
  assert.equal(extractManualLoginValues("Action=100", "Action = 100\nErrorNo = 0\nToken = failed-token"), undefined);
  assert.equal(extractManualLoginValues("Action=104", JSON.stringify({ Action: "104", ErrorNo: -1, SessionNo: 9 })), undefined);
  assert.equal(extractManualLoginValues("Action=100", "Action = 100\nToken = missing-error-no"), undefined);
});

test("creates a request log entry for a manually sent HTTP reqxml request", () => {
  const entry = createManualRequestLogEntry(
    { host: "123.103.83.82", port: 6064, paramsText: "Action=49055\nserviceId=esb.wwygt.zhcx.cxzjzhxx", transport: "http" },
    { statusCode: 200, statusMessage: "OK", body: '{"ERRORNO":"0"}', durationMs: 38 },
  );

  assert.equal(entry.message, "POST /reqxml");
  assert.equal(entry.direction, "outbound");
  assert.equal(entry.protocol, "http");
  assert.equal(entry.requestType, "http");
  assert.equal(entry.requestPath, "/reqxml");
  assert.equal(entry.statusCode, 200);
  assert.equal(entry.durationMs, 38);
  assert.equal(entry.level, "info");
  assert.match(entry.requestParams ?? "", /^POST \/reqxml\n\nAction=49055&serviceId=esb\.wwygt\.zhcx\.cxzjzhxx$/);
  assert.equal(entry.responseData, '{"ERRORNO":"0"}');
});

test("marks a manually sent reqxml request as a TCP request and a server failure as an error", () => {
  const tcpEntry = createManualRequestLogEntry(
    { host: "127.0.0.1", port: 9101, paramsText: "Action=100", transport: "tzt" },
    { body: "Action = 100", durationMs: 12 },
  );
  assert.equal(tcpEntry.protocol, "tcp");
  assert.equal(tcpEntry.requestType, "http");
  assert.equal(tcpEntry.statusCode, undefined);
  assert.equal(tcpEntry.level, "info");

  const failedEntry = createManualRequestLogEntry(
    { host: "127.0.0.1", port: 8080, paramsText: "Action=100", transport: "http" },
    { statusCode: 503, body: "unavailable", durationMs: 5 },
  );
  assert.equal(failedEntry.level, "error");
});

test("sends pasted request parameters to the reqxml endpoint and returns the response", async () => {
  const target = http.createServer(async (request, response) => {
    assert.equal(request.method, "POST");
    assert.equal(request.url, "/reqxml");
    assert.equal(request.headers["content-type"], "application/x-www-form-urlencoded");
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    assert.equal(Buffer.concat(chunks).toString("utf8"), "Action=100&account=600554432");
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ACTION: "100", ACCOUNT: "600554432" }));
  });
  const port = await listen(target);

  try {
    const result = await sendManualRequest({ host: "127.0.0.1", port, paramsText: "Action=100\naccount=600554432", timeoutMs: 1000, transport: "http" });
    assert.equal(result.statusCode, 200);
    assert.equal(result.body, '{"ACTION":"100","ACCOUNT":"600554432"}');
    assert.equal(typeof result.durationMs, "number");
  } finally {
    await new Promise<void>((resolve) => target.close(() => resolve()));
  }
});

test("sends pasted request parameters as a TZT frame when the target is a native socket", async () => {
  const codec = createTztCodec();
  const target = net.createServer((socket) => {
    let buffer = Buffer.alloc(0);
    socket.on("data", async (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length < 6) return;
      const frameLength = buffer.readUInt32LE(2) + 6;
      if (buffer.length < frameLength) return;
      const request = await codec.decode(buffer.subarray(0, frameLength));
      const response = await codec.encode({ Action: request.Action ?? "", ERRORNO: "0", ACCOUNT: request.account ?? "" }, Number(request.HandleSerialNo));
      socket.write(response);
    });
  });
  const port = await new Promise<number>((resolve, reject) => {
    target.once("error", reject);
    target.listen({ host: "127.0.0.1", port: 0 }, () => {
      const address = target.address();
      if (address === null || typeof address === "string") return reject(new Error("server did not expose an address"));
      resolve(address.port);
    });
  });

  try {
    const result = await sendManualRequest({
      host: "127.0.0.1",
      port,
      paramsText: "Action=100\naccount=600554432",
      timeoutMs: 1000,
      transport: "tzt",
    } as Parameters<typeof sendManualRequest>[0] & { transport: "tzt" });
    assert.equal(result.statusCode, undefined);
    assert.equal(result.body, "Action = 100\nERRORNO = 0\nACCOUNT = 600554432");
  } finally {
    await new Promise<void>((resolve) => target.close(() => resolve()));
    await codec.close?.();
  }
});

test("reuses one helper and TCP connection for repeated manual TZT requests", async () => {
  const codec = createTztCodec();
  let connectionCount = 0;
  const target = net.createServer((socket) => {
    connectionCount += 1;
    let buffer = Buffer.alloc(0);
    socket.on("data", async (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 6) {
        const frameLength = buffer.readUInt32LE(2) + 6;
        if (buffer.length < frameLength) return;
        const frame = buffer.subarray(0, frameLength);
        buffer = buffer.subarray(frameLength);
        const request = await codec.decode(frame);
        const response = await codec.encode({ Action: request.Action ?? "", ERRORNO: "0" }, Number(request.HandleSerialNo));
        socket.write(response);
      }
    });
  });
  const port = await new Promise<number>((resolve, reject) => {
    target.once("error", reject);
    target.listen({ host: "127.0.0.1", port: 0 }, () => {
      const address = target.address();
      if (address === null || typeof address === "string") return reject(new Error("server did not expose an address"));
      resolve(address.port);
    });
  });
  const bridge = new ManualTcpRequestBridge(codec);

  try {
    const first = await sendManualRequest({ host: "127.0.0.1", port, paramsText: "Action=100", timeoutMs: 1000, transport: "tzt" }, { tcpBridge: bridge });
    const second = await sendManualRequest({ host: "127.0.0.1", port, paramsText: "Action=101", timeoutMs: 1000, transport: "tzt" }, { tcpBridge: bridge });
    assert.equal(first.body, "Action = 100\nERRORNO = 0");
    assert.equal(second.body, "Action = 101\nERRORNO = 0");
    assert.equal(connectionCount, 1);
  } finally {
    await bridge.close();
    await new Promise<void>((resolve) => target.close(() => resolve()));
    await codec.close?.();
  }
});
