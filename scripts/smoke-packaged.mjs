import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..");
const executablePath = path.resolve(
  projectRoot,
  process.argv[2] ?? path.join("dist", "win-unpacked", "Local Forwarder.exe"),
);
const smokeTimeoutMs = 10000;

function fail(message) {
  console.error(`Packaged Windows smoke check failed: ${message}`);
  process.exitCode = 1;
}

async function runSmoke() {
  if (!existsSync(executablePath)) {
    throw new Error(`missing packaged executable: ${executablePath}`);
  }

  const result = await new Promise((resolve) => {
    const child = spawn(executablePath, ["--smoke"], {
      cwd: projectRoot,
      env: { ...process.env, ELECTRON_ENABLE_LOGGING: "1" },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(value);
    };

    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", (error) => finish({ error, stdout, stderr }));
    child.once("close", (code, signal) => finish({ code, signal, stdout, stderr }));
    const timeout = setTimeout(() => {
      child.kill();
      finish({ timedOut: true, stdout, stderr });
    }, smokeTimeoutMs);
  });

  if (result.error !== undefined) throw new Error(`cannot start packaged executable: ${result.error.message}`);
  if (result.timedOut) throw new Error(`timed out after ${smokeTimeoutMs}ms; stderr: ${result.stderr.trim()}`);
  if (result.code !== 0) {
    throw new Error(`exited with code ${result.code ?? "null"} and signal ${result.signal ?? "none"}; stderr: ${result.stderr.trim()}`);
  }
  if (!result.stdout.includes("forwarder-ready")) throw new Error(`missing forwarder-ready; stdout: ${result.stdout.trim()}`);
  console.log(`Packaged Windows smoke check passed: ${result.stdout.trim()}`);
}

runSmoke().catch((error) => fail(error instanceof Error ? error.message : String(error)));
