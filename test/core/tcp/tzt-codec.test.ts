import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { createTztCodec, createTztCodecPool, getNode16BinaryCandidates, type TztCodec } from "../../../src/core/tcp/tzt-codec";

const codec = createTztCodec();

after(async () => {
  await codec.close?.();
});

test("Node 16 candidates prefer the bundled Windows x64 runtime", () => {
  const candidates = getNode16BinaryCandidates("/packed/protocol", "win32", "x64", {});
  assert.equal(candidates[0], path.join("/packed/protocol", "node", "win-x64", "node.exe"));
  assert.equal(candidates.some((candidate) => candidate.includes("node-v16.13.0-win-x64")), false);
});

test("Node 16 environment override is preferred and unsupported Windows arch has no x64 bundle", () => {
  const override = "C:\\tools\\node-v16.13.0\\node.exe";
  assert.equal(getNode16BinaryCandidates("/packed/protocol", "win32", "x64", { TZT_NODE16_BIN: override })[0], override);
  assert.equal(getNode16BinaryCandidates("/packed/protocol", "win32", "arm64", {}).some((candidate) => candidate.includes("win-x64")), false);
});

test("codec pool lazily reuses workers, caps worker count, and closes each worker once", async () => {
  let created = 0;
  let closed = 0;
  const createWorker = (): TztCodec => {
    created += 1;
    const run = async <T>(value: T): Promise<T> => {
      await new Promise((resolve) => setTimeout(resolve, 15));
      return value;
    };
    return {
      rc4: (data) => run(Buffer.from(data)),
      rc4Batch: (data) => run(data.map((entry) => Buffer.from(entry))),
      encode: () => run(Buffer.alloc(0)),
      decode: () => run({}),
      close: async () => { closed += 1; },
    };
  };
  const pool = createTztCodecPool({ maxWorkers: 2, createCodec: createWorker });

  await pool.rc4(Buffer.from("first"), "file");
  await pool.rc4(Buffer.from("second"), "file");
  assert.equal(created, 1);

  await Promise.all([
    pool.rc4(Buffer.from("one"), "file"),
    pool.rc4(Buffer.from("two"), "file"),
    pool.rc4(Buffer.from("three"), "file"),
  ]);
  assert.equal(created, 2);

  await pool.close?.();
  await pool.close?.();
  assert.equal(closed, 2);
  await assert.rejects(() => pool.rc4(Buffer.from("after-close"), "file"), /closed/i);
});

test("codec preserves the legacy RC4 and encode regression vectors", async () => {
  assert.equal((await codec.rc4(Buffer.from("Plaintext"), "x")).toString("hex"), "32da9e2ceaea1a6e75");
  assert.equal((await codec.rc4(Buffer.from("Plaintext"), "file")).toString("hex"), "7ad9f940a0c3d07a8f");
  assert.deepEqual(
    (await codec.rc4Batch([Buffer.from("Plaintext"), Buffer.from("Plaintext")], "file")).map((entry) => entry.toString("hex")),
    ["7ad9f940a0c3d07a8f", "7ad9f940a0c3d07a8f"],
  );
  assert.equal(
    (await codec.encode({ Action: "100", foo: "bar" }, 12)).toString("hex"),
    "b7072500000064000300000200000031320006416374696f6e0300000031303003666f6f03000000626172",
  );
});

test("codec preserves long and GBK text through the legacy runtime", async () => {
  const frame = await codec.encode({ Action: "100", message: `中文${"x".repeat(100)}` }, 12);

  assert.deepEqual(await codec.decode(frame), {
    Action: "100",
    message: `中文${"x".repeat(100)}`,
    HandleSerialNo: "12",
  });
});

test("codec accepts frames larger than 1 MiB", async () => {
  const frame = await codec.encode({ Action: "100", message: "x".repeat(1_500_000) }, 12);

  assert.equal(String((await codec.decode(frame)).message).length, 1_500_000);
});

test("helper omits decoder-only fields before sending large frames back to Node", async () => {
  const frame = await codec.encode({ Action: "100", message: "x".repeat(64 * 1024) }, 12);
  const protocolDir = path.resolve("resources/protocol");
  const node16Binary = getNode16BinaryCandidates(protocolDir, process.platform, process.arch, process.env)[0];
  if (node16Binary === undefined) throw new Error("bundled Node 16 runtime not found");
  const output = execFileSync(node16Binary, [path.join(protocolDir, "tzt-node16-helper.js")], {
    input: JSON.stringify({ method: "tztljson", data: frame.toString("base64"), host: "test" }),
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  const response = JSON.parse(output) as { data: Record<string, unknown>[] };

  assert.equal(response.data.length, 1);
  assert.equal("zzkeyByte" in response.data[0], false);
  assert.equal("zzbytes" in response.data[0], false);
  assert.ok(output.length < frame.length * 2, `helper response was ${output.length} bytes for a ${frame.length}-byte frame`);
});

test("codec decodes a legacy frame and preserves its serial number", async () => {
  const frame = Buffer.from(
    "b707250000006400000000020000003132009617e8f7adba12dc8067265b85505ab73a8b8040e9ccde05f0",
    "hex",
  );

  assert.deepEqual(await codec.decode(frame), { Action: "100", foo: "bar", HandleSerialNo: "12" });
});

test("codec rejects malformed and truncated frames instead of returning bad data", async () => {
  await assert.rejects(codec.decode(Buffer.from("b70706000000", "hex")), /truncated|length|invalid/i);
  await assert.rejects(codec.decode(Buffer.from("00000700000000", "hex")), /magic|invalid/i);
});

test("codec correlates concurrent requests through one persistent helper", async () => {
  const frames = await Promise.all(Array.from({ length: 40 }, (_, index) => codec.encode({ Action: "100", index }, index + 1)));
  const decoded = await Promise.all(frames.map((frame) => codec.decode(frame)));
  assert.deepEqual(decoded.map((response) => response.index), Array.from({ length: 40 }, (_, index) => String(index)));
  assert.deepEqual(decoded.map((response) => response.HandleSerialNo), Array.from({ length: 40 }, (_, index) => String(index + 1)));
});
