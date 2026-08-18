import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { spawnSync } from "node:child_process";

const require = createRequire(import.meta.url);
const projectRoot = process.cwd();
const rendererDir = path.join(projectRoot, "dist");
const rendererEntry = path.join(rendererDir, "index.html");
const electronEntry = path.join(projectRoot, "dist-electron", "main.js");

function fail(message) {
  console.error(`Electron smoke check failed: ${message}`);
  process.exit(1);
}

if (!existsSync(rendererEntry)) {
  fail("missing dist/index.html; run npm run build first");
}
if (!existsSync(electronEntry)) {
  fail("missing dist-electron/main.js; run npm run build first");
}

const html = readFileSync(rendererEntry, "utf8");
const assetReferences = [...html.matchAll(/(?:src|href)="([^\"]+)"/g)]
  .map((match) => match[1])
  .filter((reference) => reference.includes("assets/"));

if (assetReferences.length === 0) {
  fail("dist/index.html does not reference built assets");
}

for (const reference of assetReferences) {
  if (reference.startsWith("/")) {
    fail(`renderer asset is not relative: ${reference}`);
  }
  const assetPath = path.resolve(rendererDir, reference);
  if (!assetPath.startsWith(`${rendererDir}${path.sep}`) || !existsSync(assetPath)) {
    fail(`renderer asset cannot be loaded from dist: ${reference}`);
  }
}

let electronBinary;
try {
  electronBinary = process.env.ELECTRON_BINARY ?? require("electron");
} catch (error) {
  fail(`cannot resolve Electron executable: ${error.message}`);
}

const result = spawnSync(electronBinary, ["--version"], {
  cwd: projectRoot,
  encoding: "utf8",
});

if (result.error) {
  fail(`cannot execute Electron: ${result.error.message}`);
}
if (result.status !== 0) {
  fail(`Electron exited with status ${result.status}: ${(result.stderr ?? "").trim()}`);
}

console.log(`Electron smoke check passed: ${result.stdout.trim()}`);
