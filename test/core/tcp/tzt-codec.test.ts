import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createTztCodec, getNode16BinaryCandidates } from "../../../src/core/tcp/tzt-codec";

test("Node 16 candidates prefer the bundled Windows x64 runtime", () => {
  const candidates = getNode16BinaryCandidates("/packed/protocol", "win32", "x64", {});
  assert.equal(candidates[0], path.join("/packed/protocol", "node", "win-x64", "node.exe"));
  assert.equal(candidates.some((candidate) => candidate.includes("node-v16.13.0-win-x64")), false);
});

test("Node 16 candidates include the bundled Darwin arm64 runtime", () => {
  const candidates = getNode16BinaryCandidates("/packed/protocol", "darwin", "arm64", {});
  assert.equal(candidates[0], path.join("/packed/protocol", "node", "darwin-arm64", "node"));
});

test("Node 16 environment override is preferred and unsupported Windows arch has no x64 bundle", () => {
  const override = "C:\\tools\\node-v16.13.0\\node.exe";
  assert.equal(getNode16BinaryCandidates("/packed/protocol", "win32", "x64", { TZT_NODE16_BIN: override })[0], override);
  assert.equal(getNode16BinaryCandidates("/packed/protocol", "win32", "arm64", {}).some((candidate) => candidate.includes("win-x64")), false);
});

test("codec preserves the legacy RC4 and encode regression vectors", () => {
  const codec = createTztCodec();

  assert.equal(codec.rc4(Buffer.from("Plaintext"), "x").toString("hex"), "32da9e2ceaea1a6e75");
  assert.equal(codec.rc4(Buffer.from("Plaintext"), "file").toString("hex"), "7ad9f940a0c3d07a8f");
  assert.equal(
    codec.encode({ Action: "100", foo: "bar" }, 12).toString("hex"),
    "b7072500000064000300000200000031320006416374696f6e0300000031303003666f6f03000000626172",
  );
});

test("codec preserves long and UTF-8 text through the legacy runtime", () => {
  const codec = createTztCodec();
  const frame = codec.encode({ Action: "100", message: `中文${"x".repeat(100)}` }, 12);

  const { zzkeyByte, zzbytes, ...fields } = codec.decode(frame);
  assert.ok(zzkeyByte !== undefined && zzbytes !== undefined);
  assert.deepEqual(fields, {
    Action: "100",
    message: `中文${"x".repeat(100)}`,
    HandleSerialNo: "12",
  });
});

test("codec decodes a fixed frame and preserves its serial number", () => {
  const codec = createTztCodec();
  const frame = Buffer.from(
    "b7072500000064000300000200000031320006416374696f6e0300000031303003666f6f03000000626172",
    "hex",
  );

  assert.deepEqual(codec.decode(frame), {
    Action: "100",
    foo: "bar",
    zzkeyByte: { Action: { 0: 49, 1: 48, 2: 48 }, foo: { 0: 98, 1: 97, 2: 114 } },
    HandleSerialNo: "12",
    zzbytes: { keylen: 2 },
  });
});

test("codec reuses one legacy runtime across sequential invokes", () => {
  const codec = createTztCodec();
  for (let index = 0; index < 20; index += 1) {
    assert.equal(codec.encode({ Action: "100" }, 12 + index).readUInt16LE(0), 0x07b7);
  }
  assert.equal(codec.rc4(Buffer.from("Plaintext"), "file").toString("hex"), "7ad9f940a0c3d07a8f");
});

test("codec survives a helper-reported request error", () => {
  const codec = createTztCodec();
  assert.throws(() => codec.decode(Buffer.from("b7070b0000000000000000000000000000", "hex")), /helper/i);
  assert.equal(codec.rc4(Buffer.from("Plaintext"), "file").toString("hex"), "7ad9f940a0c3d07a8f");
});

test("codec decodes frames whose helper JSON exceeds the old 10 MiB buffer", () => {
  const codec = createTztCodec();
  const frame = codec.encode({ Action: "100", BIG: "x".repeat(1_500_000) }, 12);

  const { zzkeyByte, zzbytes, ...fields } = codec.decode(frame);
  assert.ok(zzkeyByte !== undefined && zzbytes !== undefined);
  assert.equal(fields.BIG, "x".repeat(1_500_000));
});

test("codec rejects malformed and truncated frames instead of returning bad data", () => {
  const codec = createTztCodec();

  assert.throws(() => codec.decode(Buffer.from("b70706000000", "hex")), /truncated|length|invalid/i);
  assert.throws(() => codec.decode(Buffer.from("00000700000000", "hex")), /magic|invalid/i);
});
