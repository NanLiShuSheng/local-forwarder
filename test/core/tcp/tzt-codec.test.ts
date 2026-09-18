import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createTztCodec, getNode16BinaryCandidates } from "../../../src/core/tcp/tzt-codec";

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

test("codec preserves the legacy RC4 and encode regression vectors", () => {
  const codec = createTztCodec();

  assert.equal(codec.rc4(Buffer.from("Plaintext"), "x").toString("hex"), "c03aeaeaaaa119a7f4");
  assert.equal(codec.rc4(Buffer.from("Plaintext"), "file").toString("hex"), "7ad9f940a0c3d07a8f");
  assert.equal(
    codec.encode({ Action: "100", foo: "bar" }, 12).toString("hex"),
    "b707250000006400000000020000003132009617e8f7adba12dc8067265b85505ab73a8b8040e9ccde05f0",
  );
});

test("codec preserves long and GBK text through the legacy runtime", () => {
  const codec = createTztCodec();
  const frame = codec.encode({ Action: "100", message: `中文${"x".repeat(100)}` }, 12);

  assert.deepEqual(codec.decode(frame), {
    Action: "100",
    message: `中文${"x".repeat(100)}`,
    HandleSerialNo: "12",
  });
});

test("codec decodes a legacy frame and preserves its serial number", () => {
  const codec = createTztCodec();
  const frame = Buffer.from(
    "b707250000006400000000020000003132009617e8f7adba12dc8067265b85505ab73a8b8040e9ccde05f0",
    "hex",
  );

  assert.deepEqual(codec.decode(frame), { Action: "100", foo: "bar", HandleSerialNo: "12" });
});

test("codec rejects malformed and truncated frames instead of returning bad data", () => {
  const codec = createTztCodec();

  assert.throws(() => codec.decode(Buffer.from("b70706000000", "hex")), /truncated|length|invalid/i);
  assert.throws(() => codec.decode(Buffer.from("00000700000000", "hex")), /magic|invalid/i);
});
