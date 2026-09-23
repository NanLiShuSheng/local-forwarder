import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { collectFiles, encryptDirectory } from "../../../src/core/encryption/encryptor";

const expectedRelativePaths = ["app.js", path.join("dist", "bundle.js"), path.join("nested", "page.html")].sort();

async function makeFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "local-forwarder-encryption-test-"));
  const inputDir = path.join(root, "input");
  const outputDir = path.join(root, "output");
  const tempRoot = path.join(root, "temp");
  const counterPath = path.join(root, "encoder-count");
  const encoderScriptPath = path.join(root, "fake-encoder.mjs");
  await mkdir(path.join(inputDir, "nested"), { recursive: true });
  await mkdir(path.join(inputDir, ".secret"), { recursive: true });
  await mkdir(path.join(inputDir, "node_modules"), { recursive: true });
  await mkdir(path.join(inputDir, "dist"), { recursive: true });
  await mkdir(tempRoot, { recursive: true });
  await writeFile(encoderScriptPath, [
    'import { appendFile, copyFile } from "node:fs/promises";',
    "const counterPath = process.argv[2];",
    "const sourcePath = process.argv[3];",
    'await appendFile(counterPath, "called\\n");',
    'await copyFile(sourcePath, sourcePath + ".d");',
  ].join("\n"));
  await writeFile(counterPath, "");
  await writeFile(path.join(inputDir, "app.js"), "console.log('app');");
  await writeFile(path.join(inputDir, "nested", "page.html"), "<main>page</main>");
  await writeFile(path.join(inputDir, "nested", "page.js.map"), "map");
  await writeFile(path.join(inputDir, ".hidden.js"), "hidden");
  await writeFile(path.join(inputDir, ".secret", "secret.js"), "secret");
  await writeFile(path.join(inputDir, "node_modules", "dep.js"), "dependency");
  await writeFile(path.join(inputDir, "dist", "bundle.js"), "bundle");
  return { root, inputDir, outputDir, tempRoot, counterPath, encoderPath: process.execPath, encoderArgs: [encoderScriptPath, counterPath] };
}

test("collectFiles recursively applies the reference exclusion rules", async () => {
  const fixture = await makeFixture();
  try {
    assert.deepEqual(
      (await collectFiles(fixture.inputDir)).map((filePath) => path.relative(fixture.inputDir, filePath)).sort(),
      expectedRelativePaths,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("encryptDirectory preserves relative paths and appends .d after encoding", async () => {
  const fixture = await makeFixture();
  try {
    const result = await encryptDirectory({ ...fixture });
    assert.equal(result.totalFiles, 3);
    assert.deepEqual(result.files.map((file) => file.relativePath).sort(), expectedRelativePaths);
    assert.equal(await readFile(path.join(fixture.outputDir, "app.js.d"), "utf8"), "console.log('app');");
    assert.equal(await readFile(path.join(fixture.outputDir, "dist", "bundle.js.d"), "utf8"), "bundle");
    assert.equal(await readFile(path.join(fixture.outputDir, "nested", "page.html.d"), "utf8"), "<main>page</main>");
    assert.equal(JSON.parse(await readFile(path.join(fixture.outputDir, ".encrypt-cache.json"), "utf8")).files["app.js"].length, 64);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("encryptDirectory reports scan and per-file progress while it runs", async () => {
  const fixture = await makeFixture();
  try {
    const progress: Array<{ phase: string; status?: string; relativePath?: string; current: number; total: number }> = [];
    await encryptDirectory({ ...fixture, onProgress: (event: typeof progress[number]) => progress.push(event) } as any);
    assert.equal(progress[0]?.phase, "scanning");
    assert.equal(progress[1]?.phase, "processing");
    assert.deepEqual(progress.filter((event) => event.status === "encrypting").map((event) => event.relativePath).sort(), expectedRelativePaths);
    assert.equal(progress.at(-1)?.phase, "completed");
    assert.equal(progress.at(-1)?.current, 3);
    assert.equal(progress.at(-1)?.total, 3);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("encryptDirectory always processes every eligible file and cleans temporary work directories", async () => {
  const fixture = await makeFixture();
  try {
    await encryptDirectory({ ...fixture });
    await encryptDirectory({ ...fixture });
    assert.equal((await readFile(fixture.counterPath, "utf8")).trim().split("\n").length, 6);
    assert.deepEqual(await readdir(fixture.tempRoot), []);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("incremental encryption skips unchanged files and removes deleted outputs", async () => {
  const fixture = await makeFixture();
  try {
    const first = await encryptDirectory({ ...fixture, mode: "full" });
    assert.equal(first.processedFiles, 3);

    await writeFile(path.join(fixture.inputDir, "app.js"), "console.log('changed');");
    await rm(path.join(fixture.inputDir, "nested", "page.html"));
    await writeFile(path.join(fixture.inputDir, "new.js"), "console.log('new');");

    const second = await encryptDirectory({ ...fixture, mode: "incremental" });
    assert.equal(second.processedFiles, 2);
    assert.equal(second.skippedFiles, 1);
    assert.equal(second.removedFiles, 1);
    assert.deepEqual(second.logs, ["Encrypting app.js", "Encrypting new.js"]);
    assert.equal((await readFile(fixture.counterPath, "utf8")).trim().split("\n").length, 5);
    assert.equal(await readFile(path.join(fixture.outputDir, "app.js.d"), "utf8"), "console.log('changed');");
    assert.equal(await readFile(path.join(fixture.outputDir, "new.js.d"), "utf8"), "console.log('new');");
    await assert.rejects(() => readFile(path.join(fixture.outputDir, "nested", "page.html.d")));
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("encryptDirectory rejects invalid source, encoder, and unsafe output directories", async () => {
  const fixture = await makeFixture();
  try {
    await assert.rejects(
      encryptDirectory({ ...fixture, inputDir: path.join(fixture.root, "missing") }),
      /Input directory does not exist/,
    );
    await assert.rejects(
      encryptDirectory({ ...fixture, encoderPath: path.join(fixture.root, "missing-encoder") }),
      /Encoder does not exist or is not executable/,
    );
    await assert.rejects(
      encryptDirectory({ ...fixture, outputDir: fixture.inputDir }),
      /Output directory must be outside the input directory/,
    );
    await assert.rejects(
      encryptDirectory({ ...fixture, outputDir: path.join(fixture.inputDir, "encrypted") }),
      /Output directory must be outside the input directory/,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("encryptDirectory rejects an encoder that does not produce the .d file", async () => {
  const fixture = await makeFixture();
  try {
    const brokenEncoder = path.join(fixture.root, "broken-encoder.mjs");
    await writeFile(brokenEncoder, "process.exitCode = 0;\n");
    await assert.rejects(
      encryptDirectory({ ...fixture, encoderPath: process.execPath, encoderArgs: [brokenEncoder] }),
      /Failed to encrypt.*encoded output/,
    );
    assert.deepEqual(await readdir(fixture.tempRoot), []);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});
