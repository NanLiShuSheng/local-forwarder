import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import test from "node:test";
import { IPC_CHANNELS } from "../../src/shared/contracts";
import { getEncryptionEncoderPath, getEncryptionPreferencesPath } from "../../electron/paths";

test("IPC contracts expose directory selection and encryption execution", async () => {
  assert.equal(IPC_CHANNELS.selectEncryptionDirectory, "encryption:select-directory");
  assert.equal(IPC_CHANNELS.getEncryptionPreferences, "encryption:get-preferences");
  assert.equal(IPC_CHANNELS.encryptDirectory, "encryption:run");
  const preload = await readFile("electron/preload.ts", "utf8");
  const main = await readFile("electron/main.ts", "utf8");
  assert.match(preload, /selectEncryptionDirectory/);
  assert.match(preload, /getEncryptionPreferences/);
  assert.match(preload, /encryptDirectory/);
  assert.match(main, /selectEncryptionDirectory/);
  assert.match(main, /encryptDirectory/);
});

test("encoder path resolves to project resources in development and app resources when packaged", () => {
  assert.equal(
    getEncryptionEncoderPath("/project/dist-electron/electron", false, "/ignored/resources"),
    path.join("/project/resources", "protocol", "encode", "h5encode-mac-amd64"),
  );
  assert.equal(
    getEncryptionEncoderPath("/project/dist-electron/electron", true, "/packed/Contents/Resources"),
    path.join("/packed/Contents/Resources", "protocol", "encode", "h5encode-mac-amd64"),
  );
  assert.equal(getEncryptionPreferencesPath("/Users/test/Library/Application Support/Local Forwarder"), path.join("/Users/test/Library/Application Support/Local Forwarder", "encryption-preferences.json"));
});

test("the encoder binary is included as an executable application resource", async () => {
  const encoderPath = path.resolve("resources/protocol/encode/h5encode-mac-amd64");
  await access(encoderPath, constants.X_OK);
});

test("DMG verification checks for the packaged encoder", async () => {
  const verifier = await readFile("scripts/verify-dmg.mjs", "utf8");
  assert.match(verifier, /protocol.*encode.*h5encode-mac-amd64/);
});
