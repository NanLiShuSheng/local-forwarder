import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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
