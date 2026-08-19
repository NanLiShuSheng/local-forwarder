import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import packageJson from "../package.json" with { type: "json" };

const projectRoot = process.cwd();
const appPath = path.join(projectRoot, "dist", "mac", `${packageJson.productName ?? "Local Forwarder"}.app`);
const releaseDir = path.join(projectRoot, "release");
const outputPath = path.join(releaseDir, `${packageJson.productName ?? "Local Forwarder"}-${packageJson.version}.dmg`);

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
