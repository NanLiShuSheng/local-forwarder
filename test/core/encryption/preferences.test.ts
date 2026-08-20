import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readEncryptionPreferences, saveEncryptionPreferences } from "../../../src/core/encryption/preferences";

test("missing encryption preferences start empty", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "local-forwarder-encryption-preferences-"));
  try {
    assert.deepEqual(await readEncryptionPreferences(path.join(root, "preferences.json")), { inputDir: "", outputDir: "" });
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
    assert.deepEqual(await saveEncryptionPreferences(preferencesPath, { inputDir }), { inputDir, outputDir: "" });
    assert.deepEqual(await saveEncryptionPreferences(preferencesPath, { outputDir }), { inputDir, outputDir });
    assert.deepEqual(await readEncryptionPreferences(preferencesPath), { inputDir, outputDir });
    assert.deepEqual(JSON.parse(await readFile(preferencesPath, "utf8")), { inputDir, outputDir });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("preferences do not restore directories that no longer exist", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "local-forwarder-encryption-preferences-"));
  const preferencesPath = path.join(root, "preferences.json");
  try {
    await saveEncryptionPreferences(preferencesPath, { inputDir: path.join(root, "deleted") });
    assert.deepEqual(await readEncryptionPreferences(preferencesPath), { inputDir: "", outputDir: "" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
