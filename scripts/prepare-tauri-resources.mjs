import { cp, rm } from "node:fs/promises";
import path from "node:path";

// Tauri bundle.resources 不支持平台过滤：按宿主平台把 protocol 资源裁剪后暂存
const projectRoot = path.resolve(import.meta.dirname, "..");
const keepNode = { darwin: /^darwin-/, win32: /^win-/ }[process.platform] ?? /^linux-/;
const keepEncoder = { darwin: "h5encode-mac-amd64", win32: "h5encode-win-x86.exe" }[process.platform];

const staged = path.join(projectRoot, "src-tauri", "staged-protocol");
const source = path.join(projectRoot, "resources", "protocol");
await rm(staged, { recursive: true, force: true });
await cp(source, staged, {
  recursive: true,
  filter: (from) => {
    const relative = path.relative(source, from).replaceAll(path.sep, "/");
    if (relative.startsWith("node/")) {
      const platformDir = relative.slice(5).split("/")[0];
      return keepNode.test(platformDir);
    }
    if (relative.startsWith("encode/")) {
      return relative === "encode" || relative === `encode/${keepEncoder}`;
    }
    return true;
  },
});
console.log(`staged protocol resources for ${process.platform} into ${path.relative(projectRoot, staged)}`);
