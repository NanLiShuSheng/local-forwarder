import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  BUILD_ENCRYPTION_MODE_STORAGE_KEY,
  DEFAULT_BUILD_ENCRYPTION_MODE,
  readBuildEncryptionMode,
  writeBuildEncryptionMode,
  type BuildModeStorage,
} from "../../src/renderer/build-mode-preference";

function memoryStorage(initial: Record<string, string> = {}): BuildModeStorage & { values: Map<string, string> } {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
  };
}

test("build encryption defaults to full mode", () => {
  assert.equal(DEFAULT_BUILD_ENCRYPTION_MODE, "full");
  assert.equal(readBuildEncryptionMode(memoryStorage()), "full");
});

test("build encryption remembers a manually selected mode", () => {
  const storage = memoryStorage();

  writeBuildEncryptionMode(storage, "incremental");
  assert.equal(storage.values.get(BUILD_ENCRYPTION_MODE_STORAGE_KEY), "incremental");
  assert.equal(readBuildEncryptionMode(storage), "incremental");

  writeBuildEncryptionMode(storage, "full");
  assert.equal(readBuildEncryptionMode(storage), "full");
});

test("build encryption ignores invalid or unavailable storage", () => {
  assert.equal(readBuildEncryptionMode(memoryStorage({ [BUILD_ENCRYPTION_MODE_STORAGE_KEY]: "invalid" })), "full");
  assert.equal(readBuildEncryptionMode(undefined), "full");

  const broken: BuildModeStorage = {
    getItem: () => { throw new Error("unavailable"); },
    setItem: () => { throw new Error("unavailable"); },
  };
  assert.equal(readBuildEncryptionMode(broken), "full");
  assert.doesNotThrow(() => writeBuildEncryptionMode(broken, "incremental"));
});

test("build page hydrates and persists the selected encryption mode", async () => {
  const source = await readFile("src/renderer/components/BuildPage.tsx", "utf8");

  assert.match(source, /useState<EncryptionMode>\(\(\) => readBuildEncryptionMode\(getBuildModeStorage\(\)\)\)/);
  assert.match(source, /const selectEncryptionMode = \(mode: EncryptionMode\) => \{[\s\S]*?setEncryptionMode\(mode\);[\s\S]*?writeBuildEncryptionMode\(getBuildModeStorage\(\), mode\);/);
  assert.match(source, /onClick=\{\(\) => selectEncryptionMode\("full"\)\}/);
  assert.match(source, /onClick=\{\(\) => selectEncryptionMode\("incremental"\)\}/);
});
