import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

test("release scripts validate versions, update metadata, signing and notarization", async () => {
  const tag = await readFile("scripts/verify-release-tag.mjs", "utf8");
  const assets = await readFile("scripts/verify-release-assets.mjs", "utf8");
  const macManifest = await readFile("scripts/create-mac-update-manifest.mjs", "utf8");
  const signing = await readFile("scripts/verify-macos-signing-env.mjs", "utf8");
  const notarize = await readFile("scripts/notarize.mjs", "utf8");
  const tencentPublisher = await readFile("scripts/publish-tencent.sh", "utf8");
  const serverPublisher = await readFile("scripts/server/publish-updates.sh", "utf8");

  assert.match(tag, /GITHUB_REF_NAME/);
  assert.match(tag, /package\.json/);
  assert.match(assets, /latest\.yml/);
  assert.match(assets, /latest-mac\.yml/);
  assert.match(macManifest, /mac-update\.json/);
  assert.match(macManifest, /sha512/);
  assert.match(assets, /sha512/);
  assert.match(
    assets,
    /manifest\.includes\(artifactName\)\s*\|\|\s*manifest\.includes\(encodeURI\(artifactName\)\)\s*\|\|\s*manifest\.includes\(normalizedArtifactName\)/,
  );
  assert.match(assets, /artifactName\.replace\(\/ \/g, "-"\)/);
  assert.match(signing, /MACOS_CERTIFICATE_BASE64/);
  assert.match(signing, /APPLE_APP_SPECIFIC_PASSWORD/);
  assert.match(notarize, /notarize/);
  assert.match(tencentPublisher, /TENCENT_SSH_KEY/);
  assert.match(tencentPublisher, /rsync/);
  assert.match(tencentPublisher, /publish-updates\.sh/);
  assert.match(tencentPublisher, /latest-mac\.yml/);
  assert.match(serverPublisher, /mac-update\.json/);
  assert.match(serverPublisher, /manifests\+=/);
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

test("notarization hook skips unsigned macOS builds in GitHub Actions", () => {
  const hookUrl = pathToFileURL(path.resolve("scripts/notarize.mjs")).href;
  const script = `import notarizeApp from ${JSON.stringify(hookUrl)};
await notarizeApp({ electronPlatformName: "darwin" });`;
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
  assert.match(result.stdout, /跳过签名与公证/);
});

test("server publisher removes intermediate release assets and keeps active manifests", { skip: process.platform === "win32" }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "local-forwarder-publish-"));
  const source = path.join(root, "source");
  const publicDir = path.join(root, "public");
  const version = "0.3.8";
  const windowsInstaller = `Local-Forwarder-Setup-${version}.exe`;
  const macZip = `Local-Forwarder-${version}-x64-mac.zip`;
  const macDmg = `Local-Forwarder-${version}-mac.dmg`;
  const sourceFiles = [
    windowsInstaller,
    `${windowsInstaller}.blockmap`,
    macZip,
    `${macZip}.blockmap`,
    macDmg,
  ];

  try {
    await mkdir(source);
    await mkdir(publicDir);
    for (const file of sourceFiles) await writeFile(path.join(source, file), `new ${file}`);
    await writeFile(path.join(source, "latest.yml"), [
      `version: ${version}`,
      "files:",
      `  - url: ${windowsInstaller}`,
      "    sha512: new",
      "    size: 3",
      `path: ${windowsInstaller}`,
      "sha512: new",
      "",
    ].join("\n"));
    await writeFile(path.join(source, "latest-mac.yml"), [
      `version: ${version}`,
      "files:",
      `  - url: ${macZip}`,
      "    sha512: new",
      "    size: 3",
      `path: ${macZip}`,
      "sha512: new",
      "",
    ].join("\n"));
    await writeFile(path.join(source, "mac-update.json"), JSON.stringify({
      version,
      files: [{ arch: "x64", name: macDmg, sha512: "new", size: 3 }],
    }));

    const staleFiles = [
      "Local-Forwarder-Setup-0.3.5.exe",
      "Local-Forwarder-Setup-0.3.5.exe.blockmap",
      "Local-Forwarder-Setup-0.3.6.exe",
      "Local-Forwarder-Setup-0.3.6.exe.blockmap",
      "Local-Forwarder-0.3.6-mac.dmg",
      "Local-Forwarder-0.3.6-x64-mac.zip",
      "Local-Forwarder-0.3.6-x64-mac.zip.blockmap",
    ];
    for (const file of staleFiles) await writeFile(path.join(publicDir, file), `old ${file}`);
    await writeFile(path.join(publicDir, "index.html"), "<html></html>");

    const result = spawnSync("bash", ["scripts/server/publish-updates.sh", source, publicDir], {
      cwd: path.resolve("."),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);

    const published = new Set(await readdir(publicDir));
    for (const file of staleFiles) assert.equal(published.has(file), false, `${file} should be pruned`);
    for (const file of [...sourceFiles, "latest.yml", "latest-mac.yml", "mac-update.json", "index.html"]) {
      assert.equal(published.has(file), true, `${file} should remain`);
    }
    assert.match(result.stdout, /Pruned 7 stale release assets/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("server publisher keeps the other platform's active release during a partial publish", { skip: process.platform === "win32" }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "local-forwarder-publish-partial-"));
  const source = path.join(root, "source");
  const publicDir = path.join(root, "public");
  const windowsInstaller = "Local-Forwarder-Setup-0.3.9.exe";
  const macZip = "Local-Forwarder-0.3.8-x64-mac.zip";
  const macDmg = "Local-Forwarder-0.3.8-mac.dmg";

  try {
    await mkdir(source);
    await mkdir(publicDir);
    await writeFile(path.join(source, windowsInstaller), "new windows");
    await writeFile(path.join(source, `${windowsInstaller}.blockmap`), "new windows blockmap");
    await writeFile(path.join(source, "latest.yml"), [
      "version: 0.3.9",
      "files:",
      `  - url: ${windowsInstaller}`,
      "    sha512: new",
      "    size: 3",
      `path: ${windowsInstaller}`,
      "sha512: new",
      "",
    ].join("\n"));

    await writeFile(path.join(publicDir, "latest-mac.yml"), [
      "version: 0.3.8",
      "files:",
      `  - url: ${macZip}`,
      "    sha512: old",
      "    size: 3",
      `path: ${macZip}`,
      "sha512: old",
      "",
    ].join("\n"));
    await writeFile(path.join(publicDir, "mac-update.json"), JSON.stringify({
      version: "0.3.8",
      files: [{ arch: "x64", name: macDmg, sha512: "old", size: 3 }],
    }));
    for (const file of [macZip, `${macZip}.blockmap`, macDmg, "Local-Forwarder-Setup-0.3.7.exe", "Local-Forwarder-Setup-0.3.7.exe.blockmap"]) {
      await writeFile(path.join(publicDir, file), `old ${file}`);
    }
    await writeFile(path.join(publicDir, "index.html"), "<html></html>");

    const result = spawnSync("bash", ["scripts/server/publish-updates.sh", source, publicDir], {
      cwd: path.resolve("."),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);

    const published = new Set(await readdir(publicDir));
    for (const file of [windowsInstaller, `${windowsInstaller}.blockmap`, macZip, `${macZip}.blockmap`, macDmg, "latest.yml", "latest-mac.yml", "mac-update.json", "index.html"]) {
      assert.equal(published.has(file), true, `${file} should remain`);
    }
    assert.equal(published.has("Local-Forwarder-Setup-0.3.7.exe"), false);
    assert.equal(published.has("Local-Forwarder-Setup-0.3.7.exe.blockmap"), false);
    assert.match(result.stdout, /Pruned 2 stale release assets/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
