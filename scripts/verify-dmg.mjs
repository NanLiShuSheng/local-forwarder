import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import packageJson from "../package.json" with { type: "json" };

const projectRoot = process.cwd();
const requestedArgument = process.argv[2];
const architecture = requestedArgument === "arm64" ? "arm64" : "x64";
const explicitDmgPath = requestedArgument && requestedArgument !== "x64" && requestedArgument !== "arm64"
  ? requestedArgument
  : process.argv[3];
const architectureSuffix = architecture === "arm64" ? "-arm64" : "";
const defaultDmgPath = path.join(
  projectRoot,
  "release",
  "Local-Forwarder-" + packageJson.version + architectureSuffix + "-mac.dmg",
);
const dmgPath = path.resolve(explicitDmgPath ?? defaultDmgPath);
const mountPoint = mkdtempSync(path.join(os.tmpdir(), "local-forwarder-dmg-"));
let attachedDisk;

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
  return result.stdout ?? "";
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
  const attachOutput = run("hdiutil", ["attach", "-nobrowse", "-readonly", "-mountpoint", mountPoint, dmgPath]);
  const attachedDisks = [...attachOutput.matchAll(/\/dev\/(disk\d+)(?:s\d+)?\s/g)];
  attachedDisk = attachedDisks[attachedDisks.length - 1]?.[1];

  const appPath = path.join(mountPoint, `${packageJson.productName ?? "Local Forwarder"}.app`);
  const executablePath = path.join(appPath, "Contents", "MacOS", packageJson.productName ?? "Local Forwarder");
  const encoderPath = path.join(appPath, "Contents", "Resources", "protocol", "encode", "h5encode-mac-amd64");
  const nodeArchitecture = architecture === "arm64" ? "macos-arm64" : "macos-x64";
  const otherNodeArchitecture = architecture === "arm64" ? "macos-x64" : "macos-arm64";
  const nodePath = path.join(appPath, "Contents", "Resources", "protocol", "node", nodeArchitecture, "node");
  const otherNodePath = path.join(appPath, "Contents", "Resources", "protocol", "node", otherNodeArchitecture, "node");
  const windowsNodePath = path.join(appPath, "Contents", "Resources", "protocol", "node", "win-x64");
  const nodeLicensePath = path.join(appPath, "Contents", "Resources", "protocol", "node", nodeArchitecture, "LICENSE.txt");
  const requiredPaths = [
    path.join(appPath, "Contents", "Info.plist"),
    executablePath,
    path.join(appPath, "Contents", "Resources", "app.asar"),
    path.join(appPath, "Contents", "Resources", "protocol"),
    path.join(appPath, "Contents", "Resources", "protocol", "tzt.bytecode-16.13.0"),
    path.join(appPath, "Contents", "Resources", "protocol", "tzt-node16-helper.js"),
    encoderPath,
    nodePath,
    nodeLicensePath,
  ];

  for (const requiredPath of requiredPaths) {
    if (!existsSync(requiredPath)) {
      throw new Error(`installed app is missing ${requiredPath}`);
    }
  }
  if (existsSync(otherNodePath)) {
    throw new Error(`DMG contains an unnecessary ${otherNodeArchitecture} Node.js runtime`);
  }
  if (existsSync(windowsNodePath)) {
    throw new Error("DMG contains an unnecessary Windows Node.js runtime");
  }

  const architectures = run("lipo", ["-archs", executablePath]).trim().split(/\s+/);
  const expectedArchitecture = architecture === "arm64" ? "arm64" : "x86_64";
  if (architectures.length !== 1 || architectures[0] !== expectedArchitecture) {
    throw new Error("DMG app architecture mismatch: expected only " + expectedArchitecture + ", found " + architectures.join(", "));
  }
  const encoderArchitectures = run("lipo", ["-archs", encoderPath]).trim().split(/\s+/);
  if (!encoderArchitectures.includes("x86_64")) {
    throw new Error("DMG is missing the x86_64 encryption encoder required for Rosetta");
  }
  const nodeArchitectures = run("lipo", ["-archs", nodePath]).trim().split(/\s+/);
  if (nodeArchitectures.length !== 1 || nodeArchitectures[0] !== expectedArchitecture) {
    throw new Error("DMG Node.js 16 runtime architecture mismatch: expected only " + expectedArchitecture + ", found " + nodeArchitectures.join(", "));
  }
  if ((statSync(nodePath).mode & 0o111) === 0) {
    throw new Error("DMG Node.js 16 runtime is not executable");
  }
  const hostArchitecture = process.arch === "x64" ? "x86_64" : process.arch;
  if (hostArchitecture === expectedArchitecture) {
    const nodeVersion = run(nodePath, ["--version"]).trim();
    if (nodeVersion !== "v16.13.0") throw new Error("DMG contains an unexpected Node.js runtime version: " + nodeVersion);
  }

  const infoPlist = readFileSync(path.join(appPath, "Contents", "Info.plist"), "utf8");
  if (!infoPlist.includes("com.localforwarder.desktop")) {
    throw new Error("installed app has an unexpected bundle identifier");
  }

  console.log(architecture + " DMG verification passed: " + dmgPath);
  console.log(`Mounted app verified: ${appPath}`);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
} finally {
  const detach = spawnSync("hdiutil", ["detach", mountPoint], {
    cwd: projectRoot,
    encoding: "utf8",
  });
  let detachResult = detach;
  if (detachResult.status !== 0 && attachedDisk !== undefined) {
    for (let attempt = 0; attempt < 5 && detachResult.status !== 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      detachResult = spawnSync("hdiutil", ["detach", `/dev/${attachedDisk}`], {
        cwd: projectRoot,
        encoding: "utf8",
      });
    }
  }
  if (detachResult.status !== 0) {
    const forceTarget = attachedDisk === undefined ? mountPoint : `/dev/${attachedDisk}`;
    detachResult = spawnSync("hdiutil", ["detach", "-force", forceTarget], {
      cwd: projectRoot,
      encoding: "utf8",
    });
  }
  if (detachResult.status !== 0 && existsSync(mountPoint)) {
    console.error(`DMG verification cleanup failed: ${(detachResult.stderr || detachResult.stdout || "").trim()}`);
    process.exitCode = 1;
  }
  try {
    rmSync(mountPoint, { recursive: true, force: true });
  } catch (error) {
    console.error(`DMG verification temporary directory cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
