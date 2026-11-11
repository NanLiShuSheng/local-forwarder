import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { IPC_CHANNELS } from "../../src/shared/contracts";
import { getDecryptionPreferencesPath } from "../../electron/paths";

test("IPC contracts expose decryption directory selection and execution", async () => {
  assert.equal(IPC_CHANNELS.selectDecryptionDirectory, "decryption:select-directory");
  assert.equal(IPC_CHANNELS.getDecryptionPreferences, "decryption:get-preferences");
  assert.equal(IPC_CHANNELS.saveDecryptionPreferences, "decryption:save-preferences");
  assert.equal(IPC_CHANNELS.decryptDirectory, "decryption:run");
  assert.equal(IPC_CHANNELS.decryptionProgress, "decryption:progress");
  const preload = await readFile("electron/preload.ts", "utf8");
  const main = await readFile("electron/main.ts", "utf8");
  for (const name of ["selectDecryptionDirectory", "getDecryptionPreferences", "saveDecryptionPreferences", "decryptDirectory"]) {
    assert.match(preload, new RegExp(name));
    assert.match(main, new RegExp(name));
  }
  assert.match(preload, /onDecryptionProgress/);
  assert.match(main, /IPC_CHANNELS\.decryptionProgress/);
});

test("decryption preferences use a separate userData file", () => {
  assert.equal(
    getDecryptionPreferencesPath("/Users/test/Library/Application Support/Local Forwarder"),
    path.join("/Users/test/Library/Application Support/Local Forwarder", "decryption-preferences.json"),
  );
});

test("main uses decryption-specific dialog titles and input validation messages", async () => {
  const main = await readFile("electron/main.ts", "utf8");
  assert.match(main, /选择解密目录/);
  assert.match(main, /选择解密输出目录/);
  assert.match(main, /请选择解密目录和解密输出目录/);
  assert.match(main, /Object\.keys\(value\)\.some\(\(key\) => key !== "inputDir" && key !== "outputDir"\)/);
});
