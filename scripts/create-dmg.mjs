import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import packageJson from "../package.json" with { type: "json" };

const projectRoot = process.cwd();
const architecture = process.argv[2] ?? "x64";
if (architecture !== "x64" && architecture !== "arm64") {
  throw new Error("macOS package architecture must be x64 or arm64");
}
const macOutputDirectory = architecture === "arm64" ? "mac-arm64" : "mac";
const architectureSuffix = architecture === "arm64" ? "-arm64" : "";
const appPath = path.join(
  projectRoot,
  "dist",
  macOutputDirectory,
  (packageJson.productName ?? "Local Forwarder") + ".app",
);
const releaseDir = path.join(projectRoot, "release");
const outputPath = path.join(releaseDir, "Local-Forwarder-" + packageJson.version + architectureSuffix + "-mac.dmg");

if (!existsSync(appPath)) {
  console.error(`Cannot create DMG: missing packaged app at ${appPath}`);
  process.exit(1);
}

mkdirSync(releaseDir, { recursive: true });
const result = spawnSync(
  "hdiutil",
  ["create", "-volname", packageJson.productName ?? "Local Forwarder", "-srcfolder", appPath, "-ov", "-format", "UDZO", outputPath],
  { cwd: projectRoot, stdio: "inherit" },
);

if (result.error) {
  console.error(`Cannot create DMG: ${result.error.message}`);
  process.exit(1);
}
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(`Created DMG: ${outputPath}`);
