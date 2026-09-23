import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

test("release scripts validate versions, update metadata, signing and notarization", async () => {
  const tag = await readFile("scripts/verify-release-tag.mjs", "utf8");
  const assets = await readFile("scripts/verify-release-assets.mjs", "utf8");
  const signing = await readFile("scripts/verify-macos-signing-env.mjs", "utf8");
  const notarize = await readFile("scripts/notarize.mjs", "utf8");

  assert.match(tag, /GITHUB_REF_NAME/);
  assert.match(tag, /package\.json/);
  assert.match(assets, /latest\.yml/);
  assert.match(assets, /latest-mac\.yml/);
  assert.match(assets, /sha512/);
  assert.match(signing, /MACOS_CERTIFICATE_BASE64/);
  assert.match(signing, /APPLE_APP_SPECIFIC_PASSWORD/);
  assert.match(notarize, /notarize/);
});

test("notarization hook skips Windows builds in GitHub Actions", () => {
  const hookUrl = pathToFileURL(path.resolve("scripts/notarize.mjs")).href;
  const script = `import notarizeApp from ${JSON.stringify(hookUrl)};
await notarizeApp({ electronPlatformName: "win32" });`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: path.resolve("."),
    encoding: "utf8",
    env: {
      ...process.env,
      GITHUB_ACTIONS: "true",
      CSC_LINK: "",
      CSC_KEY_PASSWORD: "",
      APPLE_ID: "",
      APPLE_APP_SPECIFIC_PASSWORD: "",
      APPLE_TEAM_ID: "",
    },
    timeout: 4000,
  });

  assert.equal(result.status, 0, result.error?.message ?? result.stderr);
});
