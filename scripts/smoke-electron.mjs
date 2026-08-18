import { existsSync, readFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";

const projectRoot = process.cwd();
const rendererDir = path.join(projectRoot, "dist");
const rendererEntry = path.join(rendererDir, "index.html");
const electronEntry = path.join(projectRoot, "dist-electron", "main.js");
const smokeTimeoutMs = 10000;

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

function resolveElectronBinary() {
  if (process.env.ELECTRON_BINARY) {
    return process.env.ELECTRON_BINARY;
  }

  const result = spawnSync(
    process.execPath,
    ["-e", "process.stdout.write(require('electron'))"],
    { cwd: projectRoot, encoding: "utf8", timeout: 5000 },
  );
  if (result.error) {
    fail(`cannot resolve Electron executable within 5000ms: ${result.error.message}`);
  }
  if (result.status !== 0) {
    fail(
      `cannot resolve Electron executable: ${(result.stderr || result.stdout || "").trim()}`,
    );
  }
  const binary = result.stdout.trim();
  if (!binary) {
    fail("cannot resolve Electron executable: resolver returned an empty path");
  }
  return binary;
}

const electronBinary = resolveElectronBinary();
const useNoSandbox = process.env.FORWARDER_SMOKE_NO_SANDBOX === "1";
const electronArgs = [electronEntry, "--smoke"];
if (useNoSandbox) {
  electronArgs.unshift("--no-sandbox");
  console.warn("Electron smoke check: non-sandbox validation enabled by FORWARDER_SMOKE_NO_SANDBOX=1");
}

const child = spawn(electronBinary, electronArgs, {
  cwd: projectRoot,
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});

let stdout = "";
let stderr = "";
child.stdout.on("data", (chunk) => {
  stdout += chunk;
});
child.stderr.on("data", (chunk) => {
  stderr += chunk;
});

const timeout = setTimeout(() => {
  child.kill("SIGTERM");
  fail(`timed out after ${smokeTimeoutMs}ms; stderr: ${stderr.trim()}`);
}, smokeTimeoutMs);

child.on("error", (error) => {
  clearTimeout(timeout);
  fail(`cannot start Electron: ${error.message}`);
});

child.on("close", (code, signal) => {
  clearTimeout(timeout);
  if (code !== 0) {
    fail(
      `Electron smoke process exited with code ${code ?? "null"} and signal ${signal ?? "none"}; ` +
        `stderr: ${stderr.trim()}`,
    );
  }
  console.log(`Electron smoke check passed: renderer loaded and status IPC completed. ${stdout.trim()}`);
});
