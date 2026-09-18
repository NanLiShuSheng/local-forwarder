import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..");
const unpackedDir = path.resolve(
  projectRoot,
  process.env.WIN_UNPACKED_DIR ?? path.join("dist", "win-unpacked"),
);
const distDir = path.dirname(unpackedDir);

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
  requireFile(path.join(unpackedDir, "Local Forwarder.exe"), "packaged application");
  requireFile(path.join(unpackedDir, "resources", "app.asar"), "app.asar");

  const protocolDir = path.join(unpackedDir, "resources", "protocol");
  requireFile(path.join(protocolDir, "tzt.bytecode-16.13.0"), "TZT bytecode");
  verifyPe(path.join(protocolDir, "encode", "h5encode-win-x86.exe"), 0x014c, "Windows H5 encoder");
  verifyPe(path.join(protocolDir, "node", "win-x64", "node.exe"), 0x8664, "Windows Node 16 runtime");
  requireFile(path.join(protocolDir, "node", "win-x64", "LICENSE.txt"), "Node runtime license");

  const installer = readdirSync(distDir, { withFileTypes: true }).find(
    (entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".exe"),
  );
  if (installer === undefined) throw new Error(`missing NSIS installer in ${distDir}`);
  requireFile(path.join(distDir, installer.name), "NSIS installer");

  console.log(`Windows package verification passed: ${unpackedDir}`);
  console.log(`NSIS installer verified: ${path.join(distDir, installer.name)}`);
}

try {
  verifyWindowsPackage();
} catch (error) {
  console.error(`Windows package verification failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
