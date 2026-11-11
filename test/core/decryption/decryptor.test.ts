import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { crc32, gzipSync } from "node:zlib";
import { collectEncryptedFiles, decryptDirectory } from "../../../src/core/decryption/decryptor";
import { createTztCodec } from "../../../src/core/tcp/tzt-codec";

const codec = createTztCodec();
const scriptExtensions = new Set([".js", ".html", ".htm", ".css"]);

interface FixtureEntry {
  relativePath: string;
  content: Buffer;
}

function withCrc(body: Buffer): Buffer {
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32LE(crc32(body) >>> 0);
  return Buffer.concat([body, checksum]);
}

async function makeEncryptedFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "local-forwarder-decryption-test-"));
  const inputDir = path.join(root, "download.d");
  const outputDir = path.join(root, "restored");
  const entries: FixtureEntry[] = [
    { relativePath: "app.js", content: Buffer.from("console.log('中文');") },
    { relativePath: path.join("nested", "page.html"), content: Buffer.from("<!doctype html><main>页面</main>") },
    { relativePath: path.join("nested", "style.css"), content: Buffer.from("body { color: #123; }") },
    { relativePath: path.join("assets", "logo.png"), content: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x01]) },
    { relativePath: path.join("assets", "empty.bin"), content: Buffer.alloc(0) },
    { relativePath: path.join("docs", "page.HTML"), content: Buffer.from("<p>uppercase extension</p>") },
  ];
  const scriptBodies = entries.map((entry) => scriptExtensions.has(path.extname(entry.relativePath).toLowerCase()) ? gzipSync(entry.content) : undefined);
  const encryptedScripts = codec.rc4Batch(
    scriptBodies.filter((entry): entry is Buffer => entry !== undefined),
    "file",
  );
  let scriptIndex = 0;
  const hashes: Record<string, string> = {};

  for (const [index, entry] of entries.entries()) {
    const body = scriptBodies[index];
    const encrypted = body === undefined ? entry.content : encryptedScripts[scriptIndex++];
    const target = path.join(inputDir, `${entry.relativePath}.d`);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, withCrc(encrypted));
    hashes[entry.relativePath] = createHash("sha256").update(entry.content).digest("hex");
  }
  await writeFile(path.join(inputDir, ".encrypt-cache.json"), JSON.stringify({ version: 1, files: hashes }));
  await writeFile(path.join(inputDir, "notes.txt"), "not encrypted");
  return { root, inputDir, outputDir, entries, hashes };
}

test("collectEncryptedFiles finds nested .d files and counts unrelated files", async () => {
  const fixture = await makeEncryptedFixture();
  try {
    const collected = await collectEncryptedFiles(fixture.inputDir);
    assert.equal(collected.files.length, fixture.entries.length);
    assert.equal(collected.skippedFiles, 1);
    assert.ok(collected.files.every((filePath) => filePath.endsWith(".d")));
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("decryptDirectory restores scripts, binaries, empty files, Chinese text, and nested paths", async () => {
  const fixture = await makeEncryptedFixture();
  try {
    const result = await decryptDirectory({ ...fixture, codec });
    assert.equal(result.totalFiles, fixture.entries.length);
    assert.equal(result.processedFiles, fixture.entries.length);
    assert.equal(result.failedFiles, 0);
    assert.equal(result.skippedFiles, 1);
    assert.equal(result.hashVerifiedFiles, fixture.entries.length);
    assert.deepEqual(result.failures, []);
    for (const entry of fixture.entries) {
      assert.deepEqual(await readFile(path.join(fixture.outputDir, entry.relativePath)), entry.content);
    }
    assert.equal(result.files?.every((file) => file.hashVerified), true);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("decryptDirectory reports scan, per-file, and completion progress", async () => {
  const fixture = await makeEncryptedFixture();
  try {
    const events: Array<{ phase: string; status?: string; current: number; total: number; relativePath?: string }> = [];
    await decryptDirectory({ ...fixture, codec, onProgress: (event) => events.push(event) });
    assert.equal(events[0]?.phase, "scanning");
    assert.equal(events[1]?.phase, "processing");
    assert.deepEqual(events.filter((event) => event.status === "decrypting").map((event) => event.relativePath).sort(), fixture.entries.map((entry) => entry.relativePath).sort());
    assert.equal(events.at(-1)?.phase, "completed");
    assert.equal(events.at(-1)?.current, fixture.entries.length);
    assert.equal(events.at(-1)?.total, fixture.entries.length);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("decryptDirectory atomically replaces existing output files", async () => {
  const fixture = await makeEncryptedFixture();
  try {
    await mkdir(fixture.outputDir, { recursive: true });
    await writeFile(path.join(fixture.outputDir, "app.js"), "keep me");
    await writeFile(path.join(fixture.outputDir, "unrelated.txt"), "preserve me");
    const result = await decryptDirectory({ ...fixture, codec });
    assert.equal(result.processedFiles, fixture.entries.length);
    assert.equal(result.failedFiles, 0);
    assert.deepEqual(await readFile(path.join(fixture.outputDir, "app.js")), fixture.entries[0]!.content);
    assert.deepEqual(await readFile(path.join(fixture.outputDir, "nested", "page.html")), fixture.entries[1]!.content);
    assert.equal(await readFile(path.join(fixture.outputDir, "unrelated.txt"), "utf8"), "preserve me");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("decryptDirectory isolates CRC failures and keeps processing valid files", async () => {
  const fixture = await makeEncryptedFixture();
  try {
    const brokenPath = path.join(fixture.inputDir, "app.js.d");
    const broken = await readFile(brokenPath);
    broken[0] = broken[0]! ^ 0xff;
    await writeFile(brokenPath, broken);
    const result = await decryptDirectory({ ...fixture, codec });
    assert.equal(result.processedFiles, fixture.entries.length - 1);
    assert.equal(result.failedFiles, 1);
    assert.match(result.failures?.[0]?.error ?? "", /CRC32/);
    await assert.rejects(() => readFile(path.join(fixture.outputDir, "app.js")));
    assert.deepEqual(await readFile(path.join(fixture.outputDir, "assets", "logo.png")), fixture.entries[3]!.content);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("decryptDirectory rejects a SHA-256 mismatch from the encryption manifest", async () => {
  const fixture = await makeEncryptedFixture();
  try {
    const hashes = { ...fixture.hashes, [path.join("assets", "logo.png")]: "0".repeat(64) };
    await writeFile(path.join(fixture.inputDir, ".encrypt-cache.json"), JSON.stringify({ version: 1, files: hashes }));
    const result = await decryptDirectory({ ...fixture, codec });
    assert.equal(result.failedFiles, 1);
    assert.match(result.failures?.[0]?.error ?? "", /SHA-256/);
    await assert.rejects(() => readFile(path.join(fixture.outputDir, "assets", "logo.png")));
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("decryptDirectory refuses output inside the encrypted input directory", async () => {
  const fixture = await makeEncryptedFixture();
  try {
    await assert.rejects(
      () => decryptDirectory({ ...fixture, outputDir: path.join(fixture.inputDir, "restored"), codec }),
      /不能位于待解密目录内部/,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("decryptDirectory requires at least one .d file", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "local-forwarder-decryption-empty-"));
  try {
    const inputDir = path.join(root, "input");
    await mkdir(inputDir);
    await writeFile(path.join(inputDir, "plain.txt"), "plain");
    await assert.rejects(() => decryptDirectory({ inputDir, outputDir: path.join(root, "output") }), /未找到可解密的 \.d 文件/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
