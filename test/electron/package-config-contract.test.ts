import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Electron Builder exposes a cross-platform Windows NSIS target", async () => {
  const builderConfig = await readFile("electron-builder.yml", "utf8");
  const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
    name: string;
    description: string;
    scripts: Record<string, string>;
  };
  const lockJson = JSON.parse(await readFile("package-lock.json", "utf8")) as {
    packages: { "": { name: string } };
  };
  const icon = await readFile("resources/icon.ico");

  assert.match(builderConfig, /^appId:\s*com\.localforwarder\.desktop\s*$/m);
  assert.match(builderConfig, /win:\s*\n(?:\s+.*\n)*?\s+target:\s*\n\s+-\s+nsis/m);
  assert.match(builderConfig, /icon:\s*resources\/icon\.ico/);
  assert.equal(packageJson.name, "local-forwarder");
  assert.equal(lockJson.packages[""].name, packageJson.name);
  assert.doesNotMatch(packageJson.description, /Mac/i);
  assert.match(packageJson.scripts["package:win:x64"] ?? "", /electron-builder --win nsis --x64/);
  assert.equal(icon.readUInt16LE(0), 0);
  assert.equal(icon.readUInt16LE(2), 1);
  assert.deepEqual(
    Array.from({ length: icon.readUInt16LE(4) }, (_, index) => icon[index * 16 + 6] || 256),
    [256, 128, 64, 48, 32, 16],
  );
});
