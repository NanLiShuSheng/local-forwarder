import { rm } from "node:fs/promises";
import path from "node:path";
import { Arch } from "electron-builder";
import packageJson from "../package.json" with { type: "json" };

export default async function trimProtocolNodeRuntimes(context) {
  const resourcesDirectory = context.electronPlatformName === "darwin"
    ? path.join(context.appOutDir, `${packageJson.productName ?? "Local Forwarder"}.app`, "Contents", "Resources")
    : path.join(context.appOutDir, "resources");
  const runtimeRoot = path.join(resourcesDirectory, "protocol", "node");

  if (context.electronPlatformName !== "darwin") {
    await Promise.all([
      rm(path.join(runtimeRoot, "macos-x64"), { recursive: true, force: true }),
      rm(path.join(runtimeRoot, "macos-arm64"), { recursive: true, force: true }),
    ]);
    return;
  }

  await rm(path.join(runtimeRoot, "win-x64"), { recursive: true, force: true });
  if (context.arch === Arch.x64) {
    await rm(path.join(runtimeRoot, "macos-arm64"), { recursive: true, force: true });
  } else if (context.arch === Arch.arm64) {
    await rm(path.join(runtimeRoot, "macos-x64"), { recursive: true, force: true });
  }
}
