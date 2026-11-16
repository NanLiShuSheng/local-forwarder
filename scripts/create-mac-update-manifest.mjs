import { createHash } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import packageJson from "../package.json" with { type: "json" };

const projectRoot = process.cwd();
const requestedArchitectures = process.argv.slice(2);
const architectures = [...new Set(requestedArchitectures.length > 0 ? requestedArchitectures : ["x64"])];

for (const architecture of architectures) {
  if (architecture !== "x64" && architecture !== "arm64") {
    throw new Error(`macOS update manifest architecture must be x64 or arm64: ${architecture}`);
  }
}

async function sha512File(filePath) {
  const hash = createHash("sha512");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("base64");
}

const files = [];
for (const architecture of architectures) {
  const suffix = architecture === "arm64" ? "-arm64" : "";
  const name = `Local-Forwarder-${packageJson.version}${suffix}-mac.dmg`;
  const filePath = path.join(projectRoot, "release", name);
  if (!existsSync(filePath) || !statSync(filePath).isFile() || statSync(filePath).size === 0) {
    throw new Error(`Cannot create macOS update manifest: missing DMG at ${filePath}`);
  }
  files.push({
    arch: architecture,
    name,
    sha512: await sha512File(filePath),
    size: statSync(filePath).size,
  });
}

const manifest = {
  version: packageJson.version,
  releaseDate: new Date().toISOString(),
  files,
};
const outputPath = path.join(projectRoot, "dist", "mac-update.json");
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Created macOS update manifest: ${outputPath}`);
