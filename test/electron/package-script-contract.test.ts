import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("test script delegates file discovery to the cross-platform Node runner", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8")) as { scripts: Record<string, string> };
  const testScript = packageJson.scripts.test ?? "";
  assert.match(testScript, /scripts\/run-tests\.mjs/);
  assert.doesNotMatch(testScript, /\$\(|rg --files|\|/);
});

test("Windows package verification and packaged smoke scripts use the unpacked app", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8")) as { scripts: Record<string, string> };
  const verifyScript = await readFile("scripts/verify-win.mjs", "utf8");
  const smokeScript = await readFile("scripts/smoke-packaged.mjs", "utf8");

  assert.match(packageJson.scripts["verify:win"] ?? "", /verify-win\.mjs/);
  assert.match(verifyScript, /win-unpacked/);
  assert.match(verifyScript, /app\.asar/);
  assert.match(verifyScript, /h5encode-win-x86\.exe/);
  assert.match(verifyScript, /node\.exe/);
  assert.match(verifyScript, /tzt\.bytecode-16\.13\.0/);
  assert.match(verifyScript, /0x014c/);
  assert.match(verifyScript, /0x8664/);
  assert.match(verifyScript, /verifyPe\(path\.join\(unpackedDir, "Local Forwarder\.exe"\), 0x8664/);
  assert.match(verifyScript, /--version/);
  assert.match(verifyScript, /v16\.13\.0/);
  assert.match(verifyScript, /process\.platform === "win32"/);
  assert.match(verifyScript, /Local-Forwarder-Setup-/);
  assert.match(smokeScript, /path\.join\(\"dist\", \"win-unpacked\"/);
  assert.match(smokeScript, /Local Forwarder\.exe/);
  assert.match(smokeScript, /--smoke/);
  assert.match(smokeScript, /forwarder-ready/);
  assert.match(smokeScript, /10000/);
});

test("GitHub update URLs match the uploaded Windows installer asset name", async () => {
  const builderConfig = await readFile("electron-builder.yml", "utf8");
  const releaseWorkflow = await readFile(".github/workflows/release.yml", "utf8");
  const releaseAssets = await readFile("scripts/verify-release-assets.mjs", "utf8");
  const verifyScript = await readFile("scripts/verify-win.mjs", "utf8");

  assert.match(builderConfig, /artifactName:\s*Local-Forwarder-Setup-\$\{version\}\.\$\{ext\}/);
  assert.match(releaseWorkflow, /dist\/Local-Forwarder-Setup-\*\.exe/);
  assert.match(releaseAssets, /Local-Forwarder-Setup-\$\{version\}\.exe/);
  assert.match(verifyScript, /Local-Forwarder-Setup-\$\{packageJson\.version\}\.exe/);
});

test("macOS package asset names match their builder configuration", async () => {
  const builderConfig = await readFile("electron-builder.yml", "utf8");
  const releaseAssets = await readFile("scripts/verify-release-assets.mjs", "utf8");
  const createDmg = await readFile("scripts/create-dmg.mjs", "utf8");
  const verifyDmg = await readFile("scripts/verify-dmg.mjs", "utf8");

  assert.match(builderConfig, /artifactName:\s*Local-Forwarder-\$\{version\}-\$\{arch\}-mac\.\$\{ext\}/);
  assert.match(releaseAssets, /"Local-Forwarder-" \+ version \+ dmgArchitectureSuffix \+ "-mac\.dmg"/);
  assert.match(releaseAssets, /"Local-Forwarder-" \+ version \+ zipArchitectureSuffix \+ "-mac\.zip"/);
  assert.match(createDmg, /"Local-Forwarder-" \+ packageJson\.version \+ architectureSuffix \+ "-mac\.dmg"/);
  assert.match(verifyDmg, /"Local-Forwarder-" \+ packageJson\.version \+ architectureSuffix \+ "-mac\.dmg"/);
});

test("release package scripts verify platform-specific release assets", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8")) as { scripts: Record<string, string> };

  assert.equal(packageJson.scripts["verify:release:tag"], "node scripts/verify-release-tag.mjs");
  assert.equal(packageJson.scripts["verify:release:win"], "node scripts/verify-release-assets.mjs win");
  assert.equal(packageJson.scripts["verify:release:mac"], "node scripts/verify-release-assets.mjs mac");
  assert.equal(
    packageJson.scripts["package:release:win:x64"],
    "npm run build && electron-builder --win nsis --x64 --publish never && npm run verify:win && npm run verify:release:win",
  );
  assert.equal(
    packageJson.scripts["package:release:mac:x64"],
    "npm run build && electron-builder --mac dir zip --x64 --publish never && node scripts/create-dmg.mjs && npm run verify:package && npm run verify:release:mac",
  );
  assert.equal(
    packageJson.scripts["package:x64"],
    "npm run build && electron-builder --mac dir --x64 --publish never && node scripts/create-dmg.mjs && npm run verify:package",
  );
  assert.equal(
    packageJson.scripts["package:win:x64"],
    "npm run build && electron-builder --win nsis --x64 --publish never && npm run verify:win",
  );
  assert.doesNotMatch(packageJson.scripts["package:x64"] ?? "", /--publish always/);
  assert.doesNotMatch(packageJson.scripts["package:win:x64"] ?? "", /--publish always/);
  assert.doesNotMatch(packageJson.scripts["package:release:win:x64"] ?? "", /--publish always/);
  assert.doesNotMatch(packageJson.scripts["package:release:mac:x64"] ?? "", /--publish always/);
});
