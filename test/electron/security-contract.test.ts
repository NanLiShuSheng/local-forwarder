import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRendererSecurityPolicy } from "../../electron/security";
import { isValidAppConfig } from "../../src/shared/validation";

const projectRoot = path.resolve(import.meta.dirname, "../..");
const validConfig = {
  server: {
    bindHost: "127.0.0.1",
    port: 8080,
    timeoutMs: 30000,
    loggingEnabled: true,
  },
  httpRules: [],
  tcpTargets: [],
  localValues: {},
  mapValues: {},
  accounts: {},
  cache: {
    rootDir: "",
    downloadTarget: "",
    decryptEnabled: false,
    autoDownload: false,
  },
};

test("renderer policy allows only the configured dev origin and production file", () => {
  const devPolicy = createRendererSecurityPolicy({
    mode: "development",
    devServerUrl: "http://localhost:5173",
    rendererFilePath: path.join(projectRoot, "dist/index.html"),
  });

  assert.equal(devPolicy.isTrustedRendererUrl("http://localhost:5173/"), true);
  assert.equal(devPolicy.isTrustedRendererUrl("http://localhost:5173/assets/app.js"), true);
  assert.equal(devPolicy.isTrustedRendererUrl("https://example.com/"), false);
  assert.equal(devPolicy.isTrustedRendererUrl("file:///tmp/other.html"), false);
  assert.equal(devPolicy.isTrustedRendererUrl(`file://${projectRoot}/dist/index.html`), false);
  assert.equal(devPolicy.shouldAllowNavigation("https://example.com/"), false);
  assert.equal(devPolicy.shouldAllowNavigation("http://localhost:5173/"), true);

  const productionPolicy = createRendererSecurityPolicy({
    mode: "production",
    devServerUrl: "http://localhost:5173",
    rendererFilePath: path.join(projectRoot, "dist/index.html"),
  });

  assert.equal(productionPolicy.isTrustedRendererUrl("http://localhost:5173/"), false);
  assert.equal(
    productionPolicy.isTrustedRendererUrl(`file://${projectRoot}/dist/index.html`),
    true,
  );
  assert.equal(productionPolicy.isTrustedRendererUrl("file:///tmp/other.html"), false);
  assert.deepEqual(productionPolicy.windowOpenDecision("https://example.com/"), { action: "deny" });
});

test("main wires the renderer security policy into Electron", () => {
  const mainSource = fs.readFileSync(path.join(projectRoot, "electron/main.ts"), "utf8");
  assert.match(mainSource, /sandbox:\s*true/);
  assert.match(mainSource, /will-navigate/);
  assert.match(mainSource, /setWindowOpenHandler/);
  assert.match(mainSource, /senderFrame\?\.url/);
});

test("runtime config validation rejects unsafe or malformed payloads", () => {
  assert.equal(isValidAppConfig(validConfig), true);
  assert.equal(isValidAppConfig(null), false);
  assert.equal(isValidAppConfig([]), false);
  assert.equal(isValidAppConfig({ ...validConfig, unexpected: true }), false);
  assert.equal(
    isValidAppConfig({ ...validConfig, server: { ...validConfig.server, port: 0 } }),
    false,
  );
  assert.equal(
    isValidAppConfig({ ...validConfig, server: { ...validConfig.server, port: 65536 } }),
    false,
  );
});

test("gitignore retains repository and generated-directory safeguards", () => {
  const gitignore = fs.readFileSync(path.join(projectRoot, ".gitignore"), "utf8");
  for (const entry of ["release/", ".superpowers/", ".worktrees/", ".DS_Store", "dist-electron/"]) {
    assert.match(gitignore, new RegExp(`^${entry.replace(".", "\\.")}$`, "m"));
  }
});
