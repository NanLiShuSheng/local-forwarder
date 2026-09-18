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

test("shared encryption contracts preserve history and restrict writable patches", async () => {
  const contracts = await readFile("src/shared/contracts.ts", "utf8");
  const preload = await readFile("electron/preload.ts", "utf8");
  assert.match(contracts, /export interface EncryptionPreferences\s*\{[\s\S]*inputDir: string;[\s\S]*outputDir: string;[\s\S]*inputHistory: string\[\];[\s\S]*outputHistory: string\[\];/);
  assert.match(contracts, /export type EncryptionPreferencesPatch\s*=\s*Partial<Pick<EncryptionPreferences,\s*"inputDir"\s*\|\s*"outputDir">>;/);
  assert.match(contracts, /selectEncryptionDirectory\(kind: EncryptionDirectoryKind\): Promise<OperationResult & \{[\s\S]*preferences\?: EncryptionPreferences\s*;?\s*\}>/);
  assert.match(contracts, /saveEncryptionPreferences\(patch: EncryptionPreferencesPatch\)/);
  assert.match(preload, /EncryptionPreferencesPatch/);
  assert.match(preload, /saveEncryptionPreferences: \(patch: EncryptionPreferencesPatch\)/);
  assert.doesNotMatch(preload, /Partial<EncryptionPreferences>/);
});

test("core encryption preferences reuses and re-exports the shared preference types", async () => {
  const core = await readFile("src/core/encryption/preferences.ts", "utf8");
  assert.match(core, /import type \{[^}]*EncryptionPreferences[^}]*EncryptionPreferencesPatch[^}]*\} from "\.\.\/\.\.\/shared\/contracts";/);
  assert.match(core, /export type \{[^}]*EncryptionPreferences[^}]*EncryptionPreferencesPatch[^}]*\} from "\.\.\/\.\.\/shared\/contracts";/);
  assert.doesNotMatch(core, /export interface EncryptionPreferences/);
  assert.doesNotMatch(core, /type EncryptionPreferencesPatch\s*=/);
});

test("main encryption preferences fallback includes both history arrays without widening the patch whitelist", async () => {
  const main = await readFile("electron/main.ts", "utf8");
  assert.match(main, /return \{\s*inputDir: "",\s*outputDir: "",\s*inputHistory: \[\],\s*outputHistory: \[\]\s*\};/);
  assert.match(main, /Object\.keys\(value\)\.some\(\(key\) => key !== "inputDir" && key !== "outputDir"\)/);
});

test("main awaits encryption preferences so malformed JSON reaches the fallback", async () => {
  const main = await readFile("electron/main.ts", "utf8");
  assert.match(main, /return await readEncryptionPreferences\(getEncryptionPreferencesPath\(app\.getPath\("userData"\)\)\);/);
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

test("encoder path resolves the Windows x86 encoder for Windows x64", () => {
  assert.equal(
    getEncryptionEncoderPath("/project/dist-electron/electron", false, "/ignored", "win32", "x64"),
    path.join("/project/resources", "protocol", "encode", "h5encode-win-x86.exe"),
  );
  assert.equal(
    getEncryptionEncoderPath("/project/dist-electron/electron", true, "/packed/resources", "win32", "x64"),
    path.join("/packed/resources", "protocol", "encode", "h5encode-win-x86.exe"),
  );
});

test("encoder path rejects unsupported Windows architectures", () => {
  assert.throws(
    () => getEncryptionEncoderPath("/project/dist-electron/electron", false, "/ignored", "win32", "arm64"),
    /unsupported.*win32.*arm64/i,
  );
});

test("the encoder binary is included as an executable application resource", async () => {
  const encoderPath = path.resolve("resources/protocol/encode/h5encode-mac-amd64");
  await access(encoderPath, constants.X_OK);
});

test("DMG verification checks for the packaged encoder", async () => {
  const verifier = await readFile("scripts/verify-dmg.mjs", "utf8");
  assert.match(verifier, /protocol.*encode.*h5encode-mac-amd64/);
});
