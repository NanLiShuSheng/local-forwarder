import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import packageJson from "../../package.json";
import viteConfig from "../../vite.config";
import { getPreloadPath, getRendererIndexPath } from "../../electron/paths";

const projectRoot = path.resolve(import.meta.dirname, "../..");

test("compiled Electron main resolves the renderer outside dist-electron", () => {
  const compiledMainDir = path.join(projectRoot, "dist-electron", "electron");

  assert.equal(
    getRendererIndexPath(compiledMainDir),
    path.join(projectRoot, "dist", "index.html"),
  );
  assert.equal(
    getPreloadPath(compiledMainDir),
    path.join(projectRoot, "dist-electron", "electron", "preload.js"),
  );
});

test("Vite emits renderer assets with file-loadable relative URLs", () => {
  assert.equal(viteConfig.base, "./");
});

test("dev and smoke scripts are available for a clean checkout", () => {
  assert.match(packageJson.scripts.dev, /npm run build:electron/);
  assert.match(packageJson.scripts.dev, /wait-on http:\/\/localhost:5173/);
  assert.equal(fs.existsSync(path.join(projectRoot, "scripts/smoke-electron.mjs")), true);
});
