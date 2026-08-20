import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { collectFiles, encryptDirectory } from "../../../src/core/encryption/encryptor";

async function makeFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "local-forwarder-encryption-test-"));
  const inputDir = path.join(root, "input");
  const outputDir = path.join(root, "output");
  const tempRoot = path.join(root, "temp");
  const counterPath = path.join(root, "encoder-count");
  const encoderPath = path.join(root, "fake-encoder.sh");
  await mkdir(path.join(inputDir, "nested"), { recursive: true });
  await mkdir(path.join(inputDir, ".secret"), { recursive: true });
  await mkdir(path.join(inputDir, "node_modules"), { recursive: true });
  await mkdir(path.join(inputDir, "dist"), { recursive: true });
  await mkdir(tempRoot, { recursive: true });
  await writeFile(encoderPath, `#!/bin/sh\nprintf '%s\\n' called >> "${counterPath}"\ncp "$1" "$1.d"\n`);
  await chmod(encoderPath, 0o755);
  await writeFile(counterPath, "");
  await writeFile(path.join(inputDir, "app.js"), "console.log('app');");
  await writeFile(path.join(inputDir, "nested", "page.html"), "<main>page</main>");
  await writeFile(path.join(inputDir, "nested", "page.js.map"), "map");
  await writeFile(path.join(inputDir, ".hidden.js"), "hidden");
  await writeFile(path.join(inputDir, ".secret", "secret.js"), "secret");
  await writeFile(path.join(inputDir, "node_modules", "dep.js"), "dependency");
  await writeFile(path.join(inputDir, "dist", "bundle.js"), "bundle");
  return { root, inputDir, outputDir, tempRoot, counterPath, encoderPath };
}

test("collectFiles recursively applies the reference exclusion rules", async () => {
  const fixture = await makeFixture();
  try {
    assert.deepEqual(
      (await collectFiles(fixture.inputDir)).map((filePath) => path.relative(fixture.inputDir, filePath)).sort(),
      ["app.js", "nested/page.html"],
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("encryptDirectory preserves relative paths and appends .d after encoding", async () => {
  const fixture = await makeFixture();
  try {
    const result = await encryptDirectory({ ...fixture });
    assert.equal(result.totalFiles, 2);
    assert.deepEqual(result.files.map((file) => file.relativePath).sort(), ["app.js", "nested/page.html"]);
    assert.equal(await readFile(path.join(fixture.outputDir, "app.js.d"), "utf8"), "console.log('app');");
    assert.equal(await readFile(path.join(fixture.outputDir, "nested", "page.html.d"), "utf8"), "<main>page</main>");
    assert.equal(JSON.parse(await readFile(path.join(fixture.outputDir, ".encrypt-cache.json"), "utf8")).files["app.js"].length, 64);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("encryptDirectory always processes every eligible file and cleans temporary work directories", async () => {
  const fixture = await makeFixture();
  try {
    await encryptDirectory({ ...fixture });
    await encryptDirectory({ ...fixture });
    assert.equal((await readFile(fixture.counterPath, "utf8")).trim().split("\n").length, 4);
    assert.deepEqual(await readdir(fixture.tempRoot), []);
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
    const brokenEncoder = path.join(fixture.root, "broken-encoder.sh");
    await writeFile(brokenEncoder, "#!/bin/sh\nexit 0\n");
    await chmod(brokenEncoder, 0o755);
    await assert.rejects(
      encryptDirectory({ ...fixture, encoderPath: brokenEncoder }),
      /Failed to encrypt.*encoded output/,
    );
    assert.deepEqual(await readdir(fixture.tempRoot), []);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});
