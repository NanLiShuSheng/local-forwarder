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
  const workflow = await readFile(".github/workflows/release.yml", "utf8");
  const electronMain = await readFile("electron/main.ts", "utf8");

  assert.equal(typeof packageJson.dependencies?.["electron-updater"], "string");
  assert.equal(typeof packageJson.devDependencies?.["@electron/notarize"], "string");
  assert.match(builder, /provider:\s*github/);
  assert.match(builder, /owner:\s*NanLiShuSheng/);
  assert.match(builder, /repo:\s*local-forwarder/);
  assert.match(builder, /releaseType:\s*release/);
  assert.match(builder, /oneClick:\s*true/);
  assert.match(builder, /perMachine:\s*false/);
  assert.match(builder, /-\s+zip/);
  assert.match(builder, /afterSign:\s*scripts\/notarize\.mjs/);
  assert.match(builder, /hardenedRuntime:\s*true/);
  assert.match(builder, /gatekeeperAssess:\s*false/);
  assert.match(packageJson.scripts["package:release:win:x64"] ?? "", /--publish never/);
  assert.match(packageJson.scripts["package:release:mac:x64"] ?? "", /--publish never/);
  assert.match(workflow, /WIN_CSC_LINK:\s*\$\{\{\s*secrets\.WIN_CSC_LINK\s*\}\}/);
  assert.match(workflow, /WIN_CSC_KEY_PASSWORD:\s*\$\{\{\s*secrets\.WIN_CSC_KEY_PASSWORD\s*\}\}/);
  assert.match(workflow, /build-macos:/);
  assert.match(workflow, /package:release:mac:x64-arm64/);
  assert.match(workflow, /dist\/mac-update\.json/);
  assert.match(workflow, /MACOS_CERTIFICATE_BASE64/);
  assert.match(workflow, /APPLE_APP_SPECIFIC_PASSWORD/);
  assert.match(electronMain, /createMacUpdateUrls\("NanLiShuSheng", "local-forwarder"\)/);
});
