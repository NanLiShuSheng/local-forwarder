import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("GitHub updater configuration targets the public release repository", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    scripts: Record<string, string>;
  };
  const builder = await readFile("electron-builder.yml", "utf8");

  assert.equal(typeof packageJson.dependencies?.["electron-updater"], "string");
  assert.equal(typeof packageJson.devDependencies?.["@electron/notarize"], "string");
  assert.match(builder, /provider:\s*github/);
  assert.match(builder, /owner:\s*NanLiShuSheng/);
  assert.match(builder, /repo:\s*local-forwarder/);
  assert.match(builder, /-\s+zip/);
  assert.match(builder, /afterSign:\s*scripts\/notarize\.mjs/);
  assert.match(packageJson.scripts["package:release:win:x64"] ?? "", /--publish never/);
  assert.match(packageJson.scripts["package:release:mac:x64"] ?? "", /--publish never/);
});
