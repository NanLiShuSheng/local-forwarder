import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { createTztCodec } from "../../../src/core/tcp/tzt-codec";
import { TcpBridgePool } from "../../../src/core/tcp/tcp-bridge";

type FakeMode = "normal" | "silent" | "disconnect";

async function createFakeTztServer(mode: FakeMode = "normal") {
  const codec = createTztCodec();
  const server = net.createServer();
  let connectionCount = 0;
  const sockets = new Set<net.Socket>();

  server.on("connection", (socket) => {
    connectionCount += 1;
    sockets.add(socket);
    let input = Buffer.alloc(0);
    let responseCount = 0;

    socket.on("close", () => sockets.delete(socket));
    socket.on("data", (chunk: Buffer) => {
      input = Buffer.concat([input, chunk]);
      while (input.length >= 6) {
        const frameLength = input.readUInt32LE(2) + 6;
        if (input.length < frameLength) return;
        const frame = input.subarray(0, frameLength);
        input = input.subarray(frameLength);
        const request = codec.decode(frame);

        if (mode === "silent") continue;
        if (mode === "disconnect") {
          socket.destroy();
          return;
        }

        const response = codec.encode(
          { Action: request.Action ?? "", ERRORNO: "0" },
          Number(request.HandleSerialNo),
        );
        if (responseCount === 0) {
          responseCount += 1;
          socket.write(response.subarray(0, 7));
          setImmediate(() => socket.write(response.subarray(7)));
        } else {
          responseCount += 1;
          setImmediate(() => socket.write(response));
        }
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, () => resolve());
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  return {
    port: address.port,
    get connectionCount() {
      return connectionCount;
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

test("bridge correlates split responses and reuses one target connection", async () => {
  const fake = await createFakeTztServer();
  const bridge = new TcpBridgePool({ connectTimeoutMs: 200, requestTimeoutMs: 500 });

  try {
    const first = bridge.request({ host: "127.0.0.1", port: fake.port }, { Action: "100" });
    const second = bridge.request({ host: "127.0.0.1", port: fake.port }, { Action: "101" });

    assert.deepEqual(await first, { Action: "100", ERRORNO: "0" });
    assert.deepEqual(await second, { Action: "101", ERRORNO: "0" });
    assert.equal(fake.connectionCount, 1);
  } finally {
    await bridge.close();
    await fake.close();
  }
});

test("bridge rejects all pending requests when the target disconnects", async () => {
  const fake = await createFakeTztServer("disconnect");
  const bridge = new TcpBridgePool({ connectTimeoutMs: 200, requestTimeoutMs: 500 });

  try {
    const first = bridge.request({ host: "127.0.0.1", port: fake.port }, { Action: "100" });
    const second = bridge.request({ host: "127.0.0.1", port: fake.port }, { Action: "101" });
    await assert.rejects(first, /closed|disconnect|socket|connection|reset/i);
    await assert.rejects(second, /closed|disconnect|socket|connection|reset/i);
  } finally {
    await bridge.close();
    await bridge.close();
    await fake.close();
  }
});

test("bridge reports connection failure and request timeout", async () => {
  const failedBridge = new TcpBridgePool({ connectTimeoutMs: 50, requestTimeoutMs: 500 });
  const unused = await new Promise<number>((resolve) => {
    const server = net.createServer();
    server.listen({ host: "127.0.0.1", port: 0 }, () => {
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      void server.close(() => resolve(address.port));
    });
  });

  await assert.rejects(
    failedBridge.request({ host: "127.0.0.1", port: unused }, { Action: "100" }),
    /connection|connect|refused|closed/i,
  );
  await failedBridge.close();

  const fake = await createFakeTztServer("silent");
  const timeoutBridge = new TcpBridgePool({ connectTimeoutMs: 200, requestTimeoutMs: 30 });
  try {
    await assert.rejects(
      timeoutBridge.request({ host: "127.0.0.1", port: fake.port }, { Action: "100" }),
      /timeout/i,
    );
  } finally {
    await timeoutBridge.close();
    await fake.close();
  }
});
