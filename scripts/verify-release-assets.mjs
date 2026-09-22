import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8"));
const version = packageJson.version;

function requireFile(filePath, label) {
  if (!existsSync(filePath) || !statSync(filePath).isFile()) throw new Error(`缺少${label}: ${filePath}`);
  if (statSync(filePath).size === 0) throw new Error(`${label}为空: ${filePath}`);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function verifyManifest(filePath, artifactName) {
  requireFile(filePath, "更新元数据");
  const manifest = readFileSync(filePath, "utf8");
  const versionPattern = new RegExp(`^version:\\s*${escapeRegExp(version)}\\s*$`, "m");
  if (!versionPattern.test(manifest)) throw new Error(`更新元数据版本不匹配: ${filePath}`);
  if (!manifest.includes(artifactName)) throw new Error(`更新元数据缺少资产 ${artifactName}: ${filePath}`);
  if (!/^\s*sha512:\s*\S+/m.test(manifest)) throw new Error(`更新元数据缺少 sha512: ${filePath}`);
}

function verifyWindowsAssets() {
  const installerName = `Local Forwarder Setup ${version}.exe`;
  requireFile(path.join(projectRoot, "dist", installerName), "Windows 安装器");
  verifyManifest(path.join(projectRoot, "dist", "latest.yml"), installerName);
  console.log(`Windows Release 资产校验通过: ${version}`);
}

function verifyMacAssets() {
  const dmgName = `Local Forwarder-${version}.dmg`;
  requireFile(path.join(projectRoot, "release", dmgName), "macOS DMG");
  const distDir = path.join(projectRoot, "dist");
  const zipName = readdirSync(distDir).find((name) => name.endsWith("-mac.zip") && name.includes(`-${version}-`));
  if (!zipName) throw new Error(`缺少 macOS ZIP: dist/*-${version}-mac.zip`);
  requireFile(path.join(distDir, zipName), "macOS ZIP");
  verifyManifest(path.join(distDir, "latest-mac.yml"), zipName);
  console.log(`macOS Release 资产校验通过: ${version}`);
}

try {
  const platform = process.argv[2];
  if (platform === "win") verifyWindowsAssets();
  else if (platform === "mac") verifyMacAssets();
  else throw new Error(`未知 Release 平台 ${platform ?? ""}，只能是 win 或 mac`);
} catch (error) {
  console.error(`Release 资产校验失败: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
