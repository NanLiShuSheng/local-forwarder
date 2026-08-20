import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import packageJson from "../package.json" with { type: "json" };

const projectRoot = process.cwd();
const defaultDmgPath = path.join(
  projectRoot,
  "release",
  `${packageJson.productName ?? "Local Forwarder"}-${packageJson.version}.dmg`,
);
const dmgPath = path.resolve(process.argv[2] ?? defaultDmgPath);
const mountPoint = mkdtempSync(path.join(os.tmpdir(), "local-forwarder-dmg-"));

function fail(message) {
  console.error(`DMG verification failed: ${message}`);
  process.exitCode = 1;
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: projectRoot, encoding: "utf8" });
  if (result.error) {
    throw new Error(`${command} could not start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`${command} exited with ${result.status}: ${(result.stderr || result.stdout || "").trim()}`);
  }
}

try {
  if (process.platform !== "darwin") {
    throw new Error(`requires macOS, detected ${process.platform}`);
  }
  if (!existsSync(dmgPath)) {
    throw new Error(`missing DMG at ${dmgPath}`);
  }
  if (statSync(dmgPath).size === 0) {
    throw new Error(`DMG is empty: ${dmgPath}`);
  }

  run("hdiutil", ["verify", dmgPath]);
  run("hdiutil", ["attach", "-nobrowse", "-readonly", "-mountpoint", mountPoint, dmgPath]);

  const appPath = path.join(mountPoint, `${packageJson.productName ?? "Local Forwarder"}.app`);
  const requiredPaths = [
    path.join(appPath, "Contents", "Info.plist"),
    path.join(appPath, "Contents", "MacOS", packageJson.productName ?? "Local Forwarder"),
    path.join(appPath, "Contents", "Resources", "app.asar"),
    path.join(appPath, "Contents", "Resources", "protocol"),
    path.join(appPath, "Contents", "Resources", "protocol", "tzt.bytecode-16.13.0"),
    path.join(appPath, "Contents", "Resources", "protocol", "encode", "h5encode-mac-amd64"),
  ];

  for (const requiredPath of requiredPaths) {
    if (!existsSync(requiredPath)) {
      throw new Error(`installed app is missing ${requiredPath}`);
    }
  }

  const infoPlist = readFileSync(path.join(appPath, "Contents", "Info.plist"), "utf8");
  if (!infoPlist.includes("com.localforwarder.mac")) {
    throw new Error("installed app has an unexpected bundle identifier");
  }

  console.log(`DMG verification passed: ${dmgPath}`);
  console.log(`Mounted app verified: ${appPath}`);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
} finally {
  const detach = spawnSync("hdiutil", ["detach", mountPoint], {
    cwd: projectRoot,
    encoding: "utf8",
  });
  if (detach.status !== 0 && existsSync(mountPoint)) {
    console.error(`DMG verification cleanup failed: ${(detach.stderr || detach.stdout || "").trim()}`);
    process.exitCode = 1;
  }
  rmSync(mountPoint, { recursive: true, force: true });
}
