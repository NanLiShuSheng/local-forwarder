import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

// 生成 Tauri updater 的 latest.json（发布时上传到 GitHub Release）
const projectRoot = path.resolve(import.meta.dirname, "..");
const tauriConfig = JSON.parse(readFileSync(path.join(projectRoot, "src-tauri", "tauri.conf.json"), "utf8"));
const version = tauriConfig.version;
const tag = `v${version}`;
const bundleRoot = path.join(projectRoot, "src-tauri", "target", "release", "bundle");
const updaterPath = path.join(bundleRoot, "macos", "Local Forwarder.app.tar.gz");
const signature = readFileSync(`${updaterPath}.sig`, "utf8").trim();

const manifest = {
  version: tag,
  pub_date: new Date().toISOString(),
  platforms: {
    "darwin-aarch64": {
      signature,
      url: `https://github.com/NanLiShuSheng/local-forwarder/releases/download/${tag}/Local%20Forwarder.app.tar.gz`,
    },
  },
};

const outputPath = path.join(bundleRoot, "macos", "latest.json");
writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`update manifest written: ${outputPath}`);
