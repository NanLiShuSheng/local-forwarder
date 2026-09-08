import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readEncryptionPreferences, saveEncryptionPreferences } from "../../../src/core/encryption/preferences";

test("missing encryption preferences start empty", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "local-forwarder-encryption-preferences-"));
  try {
    assert.deepEqual(await readEncryptionPreferences(path.join(root, "preferences.json")), {
      inputDir: "",
      outputDir: "",
      inputHistory: [],
      outputHistory: [],
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("encryption preferences merge input and output directory selections", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "local-forwarder-encryption-preferences-"));
  const preferencesPath = path.join(root, "nested", "preferences.json");
  const inputDir = path.join(root, "input");
  const outputDir = path.join(root, "output");
  await mkdir(inputDir);
  await mkdir(outputDir);
  try {
    assert.deepEqual(await saveEncryptionPreferences(preferencesPath, { inputDir }), {
      inputDir,
      outputDir: "",
      inputHistory: [inputDir],
      outputHistory: [],
    });
    assert.deepEqual(await saveEncryptionPreferences(preferencesPath, { outputDir }), {
      inputDir,
      outputDir,
      inputHistory: [inputDir],
      outputHistory: [outputDir],
    });
    assert.deepEqual(await readEncryptionPreferences(preferencesPath), {
      inputDir,
      outputDir,
      inputHistory: [inputDir],
      outputHistory: [outputDir],
    });
    assert.deepEqual(JSON.parse(await readFile(preferencesPath, "utf8")), {
      inputDir,
      outputDir,
      inputHistory: [inputDir],
      outputHistory: [outputDir],
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("input and output directory histories are isolated, capped, and re-promoted", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "local-forwarder-encryption-preferences-"));
  const preferencesPath = path.join(root, "preferences.json");
  const inputDirs = Array.from({ length: 11 }, (_, index) => path.join(root, `input-${index}`));
  const outputDirs = [path.join(root, "output-0"), path.join(root, "output-1")];
  await Promise.all([...inputDirs, ...outputDirs].map((directory) => mkdir(directory)));
  try {
    for (const inputDir of inputDirs) await saveEncryptionPreferences(preferencesPath, { inputDir });
    await saveEncryptionPreferences(preferencesPath, { outputDir: outputDirs[0] });
    await saveEncryptionPreferences(preferencesPath, { outputDir: outputDirs[1] });
    await saveEncryptionPreferences(preferencesPath, { inputDir: inputDirs[0] });

    assert.deepEqual(await readEncryptionPreferences(preferencesPath), {
      inputDir: inputDirs[0],
      outputDir: outputDirs[1],
      inputHistory: [inputDirs[0], ...inputDirs.slice(2).reverse()],
      outputHistory: [outputDirs[1], outputDirs[0]],
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("old preferences migrate existing current directories into their histories", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "local-forwarder-encryption-preferences-"));
  const preferencesPath = path.join(root, "preferences.json");
  const inputDir = path.join(root, "input");
  const outputDir = path.join(root, "output");
  await mkdir(inputDir);
  await mkdir(outputDir);
  try {
    await writeFile(preferencesPath, JSON.stringify({ inputDir, outputDir }), "utf8");

    assert.deepEqual(await readEncryptionPreferences(preferencesPath), {
      inputDir,
      outputDir,
      inputHistory: [inputDir],
      outputHistory: [outputDir],
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("invalid history fields are safely ignored", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "local-forwarder-encryption-preferences-"));
  const preferencesPath = path.join(root, "preferences.json");
  const outputDir = path.join(root, "output");
  await mkdir(outputDir);
  try {
    await writeFile(preferencesPath, JSON.stringify({
      inputDir: "",
      outputDir,
      inputHistory: { invalid: true },
      outputHistory: ["", 42, outputDir, outputDir],
    }), "utf8");

    assert.deepEqual(await readEncryptionPreferences(preferencesPath), {
      inputDir: "",
      outputDir,
      inputHistory: [],
      outputHistory: [outputDir],
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("preferences keep deleted directories in history without restoring them", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "local-forwarder-encryption-preferences-"));
  const preferencesPath = path.join(root, "preferences.json");
  const inputDir = path.join(root, "deleted");
  await mkdir(inputDir);
  try {
    await saveEncryptionPreferences(preferencesPath, { inputDir });
    await rm(inputDir, { recursive: true });
    assert.deepEqual(await readEncryptionPreferences(preferencesPath), {
      inputDir: "",
      outputDir: "",
      inputHistory: [inputDir],
      outputHistory: [],
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
