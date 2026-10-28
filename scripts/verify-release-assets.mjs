import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// Tauri 发布资产校验：DMG + updater 压缩包 + 签名
const projectRoot = path.resolve(import.meta.dirname, "..");
const tauriConfig = JSON.parse(readFileSync(path.join(projectRoot, "src-tauri", "tauri.conf.json"), "utf8"));
const version = tauriConfig.version;

function requireFile(filePath, label) {
  if (!existsSync(filePath) || !statSync(filePath).isFile()) throw new Error(`缺少${label}: ${filePath}`);
  if (statSync(filePath).size === 0) throw new Error(`${label}为空: ${filePath}`);
}

function verifyMacAssets() {
  const bundleRoot = path.join(projectRoot, "src-tauri", "target", "release", "bundle");
  const dmg = path.join(bundleRoot, "dmg", `Local Forwarder_${version}_aarch64.dmg`);
  const updater = path.join(bundleRoot, "macos", "Local Forwarder.app.tar.gz");
  const signature = `${updater}.sig`;
  requireFile(dmg, "macOS DMG");
  requireFile(updater, "updater 压缩包");
  requireFile(signature, "updater 签名");
  const latestJson = path.join(bundleRoot, "macos", "latest.json");
  if (existsSync(latestJson)) {
    const manifest = JSON.parse(readFileSync(latestJson, "utf8"));
    if (manifest.version !== `v${version}` && manifest.version !== version) throw new Error(`latest.json 版本不匹配: ${manifest.version} != v${version}`);
  }
  console.log(`macOS Release 资产校验通过: ${version}`);
}

const target = process.argv[2] ?? "mac";
if (target === "mac") verifyMacAssets();
else throw new Error(`未知的发布目标: ${target}`);
