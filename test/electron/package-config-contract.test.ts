import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Electron Builder exposes a cross-platform Windows NSIS target", async () => {
  const builderConfig = (await readFile("electron-builder.yml", "utf8")).replace(/\r\n/g, "\n");
  const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
    name: string;
    description: string;
    scripts: Record<string, string>;
  };
  const lockJson = JSON.parse(await readFile("package-lock.json", "utf8")) as {
    packages: { "": { name: string } };
  };
  const windowsIcon = await readFile("resources/icon.ico");
  const macIcon = await readFile("resources/icon.icns");

  assert.match(builderConfig, /^appId:\s*com\.localforwarder\.desktop\s*$/m);
  assert.doesNotMatch(builderConfig, /^electronDist:\s*node_modules\/electron\/dist\s*$/m);
  assert.match(builderConfig, /^asar:\s*true\s*$/m);
  assert.match(builderConfig, /^files:\s*$/m);
  assert.match(builderConfig, /^\s+-\s+dist\/\*\*\s*$/m);
  assert.match(builderConfig, /^\s+-\s+dist-electron\/\*\*\s*$/m);
  assert.match(builderConfig, /^\s+-\s+package\.json\s*$/m);
  assert.match(builderConfig, /^extraResources:\s*$/m);
  assert.match(builderConfig, /^\s+-\s+from:\s+resources\/protocol\s*$/m);
  assert.match(builderConfig, /^\s+to:\s+protocol\s*$/m);
  assert.match(builderConfig, /^\s+filter:\s*$/m);
  assert.match(builderConfig, /^\s+-\s+"\*\*\/\*"\s*$/m);
  assert.match(builderConfig, /win:\s*\n(?:\s+.*\n)*?\s+target:\s*\n\s+-\s+nsis/m);
  assert.match(builderConfig, /mac:\s*\n(?:\s+.*\n)*?\s+target:\s*\n(?:\s+-\s+(?:dmg|zip)\s*\n){2}/m);
  assert.match(builderConfig, /mac:\s*\n(?:\s+.*\n)*?\s+-\s+dmg/m);
  assert.match(builderConfig, /mac:\s*\n(?:\s+.*\n)*?\s+-\s+zip/m);
  assert.match(builderConfig, /mac:\s*\n(?:\s+.*\n)*?\s+icon:\s*resources\/icon\.icns/m);
  assert.match(builderConfig, /win:\s*\n(?:\s+.*\n)*?\s+icon:\s*resources\/icon\.ico/m);
  assert.match(builderConfig, /artifactName:\s*Local-Forwarder-Setup-\$\{version\}\.\$\{ext\}/);
  assert.match(builderConfig, /artifactName:\s*Local-Forwarder-\$\{version\}-\$\{arch\}-mac\.\$\{ext\}/);
  assert.equal(packageJson.name, "local-forwarder");
  assert.equal(lockJson.packages[""].name, packageJson.name);
  assert.doesNotMatch(packageJson.description, /Mac/i);
  assert.match(packageJson.scripts["package:win:x64"] ?? "", /electron-builder --win nsis --x64/);
  assert.equal(windowsIcon.readUInt16LE(0), 0);
  assert.equal(windowsIcon.readUInt16LE(2), 1);
  assert.deepEqual(
    Array.from({ length: windowsIcon.readUInt16LE(4) }, (_, index) => windowsIcon[index * 16 + 6] || 256),
    [256, 128, 64, 48, 32, 16],
  );
  for (let index = 0; index < windowsIcon.readUInt16LE(4); index++) {
    const size = windowsIcon[index * 16 + 6] || 256;
    const imageOffset = windowsIcon.readUInt32LE(index * 16 + 18);
    assert.equal(windowsIcon.readUInt32LE(imageOffset), 40);
    assert.equal(windowsIcon.readInt32LE(imageOffset + 4), size);
    assert.equal(windowsIcon.readInt32LE(imageOffset + 8), size * 2);
  }
  assert.equal(macIcon.subarray(0, 4).toString("ascii"), "icns");
  assert.equal(macIcon.readUInt32BE(4), macIcon.length);
  const icnsTypes: string[] = [];
  for (let offset = 8; offset < macIcon.length; ) {
    assert.ok(offset + 8 <= macIcon.length);
    const type = macIcon.toString("ascii", offset, offset + 4);
    const chunkLength = macIcon.readUInt32BE(offset + 4);
    assert.ok(chunkLength >= 8);
    assert.ok(offset + chunkLength <= macIcon.length);
    assert.equal(macIcon.subarray(offset + 8, offset + 16).toString("hex"), "89504e470d0a1a0a");
    icnsTypes.push(type);
    offset += chunkLength;
  }
  assert.deepEqual(icnsTypes, ["icp4", "icp5", "icp6", "ic07", "ic08", "ic09", "ic10", "ic11", "ic12", "ic13", "ic14"]);
});
