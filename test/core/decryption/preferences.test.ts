import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readDecryptionPreferences, saveDecryptionPreferences } from "../../../src/core/decryption/preferences";

test("decryption preferences keep separate directory histories", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "local-forwarder-decryption-preferences-"));
  const preferencesPath = path.join(root, "preferences.json");
  const inputA = path.join(root, "input-a");
  const inputB = path.join(root, "input-b");
  const output = path.join(root, "output");
  await Promise.all([inputA, inputB, output].map((directory) => mkdir(directory)));
  try {
    await saveDecryptionPreferences(preferencesPath, { inputDir: inputA });
    await saveDecryptionPreferences(preferencesPath, { inputDir: inputB });
    await saveDecryptionPreferences(preferencesPath, { outputDir: output });
    assert.deepEqual(await readDecryptionPreferences(preferencesPath), {
      inputDir: inputB,
      outputDir: output,
      inputHistory: [inputB, inputA],
      outputHistory: [output],
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("decryption preferences migrate old current paths and ignore malformed history", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "local-forwarder-decryption-preferences-"));
  const preferencesPath = path.join(root, "preferences.json");
  const input = path.join(root, "input");
  const output = path.join(root, "output");
  await Promise.all([input, output].map((directory) => mkdir(directory)));
  try {
    await writeFile(preferencesPath, JSON.stringify({ inputDir: input, outputDir: output, inputHistory: { bad: true }, outputHistory: ["", 42, output] }), "utf8");
    assert.deepEqual(await readDecryptionPreferences(preferencesPath), {
      inputDir: input,
      outputDir: output,
      inputHistory: [input],
      outputHistory: [output],
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
