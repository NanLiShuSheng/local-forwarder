import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { extractManualLoginValues, formatTztResponse, sendManualRequest } from "../../../src/core/request/manual-request";
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

test("caches responses for login actions 100, 104, and 105", () => {
  assert.deepEqual(extractManualLoginValues("action=100", "Action = 100\nToken = token-100"), {
    ACTION: "100",
    TOKEN: "token-100",
  });
  assert.deepEqual(extractManualLoginValues("Action = 104", JSON.stringify({ Action: "104", SessionNo: 7 })), {
    ACTION: "104",
    SESSIONNO: "7",
  });
  assert.deepEqual(extractManualLoginValues("ACTION=105", "Action = 105\nUserCode = user-105"), {
    ACTION: "105",
    USERCODE: "user-105",
  });
  assert.equal(extractManualLoginValues("Action=101", "Action = 101\nToken = not-login"), undefined);
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
    socket.on("data", (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length < 6) return;
      const frameLength = buffer.readUInt32LE(2) + 6;
      if (buffer.length < frameLength) return;
      const request = codec.decode(buffer.subarray(0, frameLength));
      const response = codec.encode({ Action: request.Action ?? "", ERRORNO: "0", ACCOUNT: request.account ?? "" }, Number(request.HandleSerialNo));
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
  }
});
