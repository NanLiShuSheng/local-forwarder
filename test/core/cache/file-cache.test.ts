import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { FileCache, decodeCachedResource } from "../../../src/core/cache/file-cache";

test("rejects traversal and serves a cached file without downloading", async () => {
  const cache = new FileCache({ rootDir: await mkdtemp(path.join(os.tmpdir(), "forwarder-cache-")) });
  assert.throws(() => cache.resolve("../secret.js"), /outside cache root/);
  await cache.write("app.js", Buffer.from("cached"));
  const result = await cache.getOrDownload("app.js", async () => { throw new Error("download must not run"); });
  assert.equal(result.source, "cache");
  assert.equal(result.data.toString(), "cached");
});

test("deduplicates concurrent downloads and cleans failed temporary files", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forwarder-cache-"));
  const cache = new FileCache({ rootDir });
  let calls = 0;
  const results = await Promise.all(Array.from({ length: 4 }, () => cache.getOrDownload("nested/app.js", async () => {
    calls += 1;
    return Buffer.from("downloaded");
  })));
  assert.equal(calls, 1);
  assert.equal(results[0].source, "download");
  assert.equal((await readFile(path.join(rootDir, "nested/app.js"))).toString(), "downloaded");
  await assert.rejects(() => cache.getOrDownload("broken.js", async () => { throw new Error("network failed"); }), /network failed/);
  assert.deepEqual((await readdir(rootDir, { recursive: true })).filter((item) => String(item).includes(".tmp")), []);
});

test("decodes encrypted and gzipped .d scripts while keeping binary assets unchanged", async () => {
  const codec = { rc4: (data: Uint8Array) => Buffer.from(data).map((value) => value ^ 0xff) };
  const encryptedScript = Buffer.concat([codec.rc4(gzipSync(Buffer.from("console.log('ok')"))), Buffer.from([1, 2, 3, 4])]);
  assert.equal(decodeCachedResource("TZT.js.d", encryptedScript, codec, true).toString(), "console.log('ok')");
  const image = Buffer.from([0, 255, 1]);
  assert.deepEqual(decodeCachedResource("image.png.d", image, codec, true), image);
});
