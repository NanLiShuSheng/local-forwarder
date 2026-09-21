import { existsSync, readFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..");
const unpackedDir = path.resolve(
  projectRoot,
  process.env.WIN_UNPACKED_DIR ?? path.join("dist", "win-unpacked"),
);
const distDir = path.dirname(unpackedDir);
const packageJson = JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8"));

function requireFile(filePath, label = filePath) {
  if (!existsSync(filePath) || !statSync(filePath).isFile()) throw new Error(`missing ${label}: ${filePath}`);
  if (statSync(filePath).size === 0) throw new Error(`empty ${label}: ${filePath}`);
}

function verifyPe(filePath, machine, label) {
  requireFile(filePath, label);
  const data = readFileSync(filePath);
  if (data.length < 64 || data.readUInt16LE(0) !== 0x5a4d) throw new Error(`${label} does not have an MZ header`);
  const peOffset = data.readUInt32LE(0x3c);
  if (peOffset + 6 > data.length || data.subarray(peOffset, peOffset + 4).toString("ascii") !== "PE\u0000\u0000") {
    throw new Error(`${label} does not have a PE signature`);
  }
  const actualMachine = data.readUInt16LE(peOffset + 4);
  if (actualMachine !== machine) throw new Error(`${label} has machine 0x${actualMachine.toString(16)}, expected 0x${machine.toString(16)}`);
}

function verifyWindowsPackage() {
  verifyPe(path.join(unpackedDir, "Local Forwarder.exe"), 0x8664, "packaged application");
  requireFile(path.join(unpackedDir, "resources", "app.asar"), "app.asar");

  const protocolDir = path.join(unpackedDir, "resources", "protocol");
  requireFile(path.join(protocolDir, "tzt.bytecode-16.13.0"), "TZT bytecode");
  verifyPe(path.join(protocolDir, "encode", "h5encode-win-x86.exe"), 0x014c, "Windows H5 encoder");
  const nodePath = path.join(protocolDir, "node", "win-x64", "node.exe");
  verifyPe(nodePath, 0x8664, "Windows Node 16 runtime");
  requireFile(path.join(protocolDir, "node", "win-x64", "LICENSE.txt"), "Node runtime license");
  if (process.platform === "win32") {
    const nodeVersion = execFileSync(nodePath, ["--version"], { encoding: "utf8", windowsHide: true }).trim();
    if (nodeVersion !== "v16.13.0") throw new Error(`Windows Node runtime is ${nodeVersion}, expected v16.13.0`);
  }

  const installerPath = path.join(
    distDir,
    `Local Forwarder Setup ${packageJson.version}.exe`,
  );
  requireFile(installerPath, "NSIS installer");

  console.log(`Windows package verification passed: ${unpackedDir}`);
  console.log(`NSIS installer verified: ${installerPath}`);
}

try {
  verifyWindowsPackage();
} catch (error) {
  console.error(`Windows package verification failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
