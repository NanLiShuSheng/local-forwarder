import { readFileSync } from "node:fs";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8"));

function verifyReleaseTag(tag) {
  if (!tag) throw new Error("未提供 GitHub Release Tag，请设置 GITHUB_REF_NAME 或传入 Tag 参数");
  const expectedTag = `v${packageJson.version}`;
  if (tag !== expectedTag) {
    throw new Error(`Release Tag ${tag} 与 package.json 版本 ${packageJson.version} 不匹配，期望 ${expectedTag}`);
  }
}

try {
  verifyReleaseTag(process.env.GITHUB_REF_NAME || process.argv[2]);
  console.log(`Release Tag 校验通过: v${packageJson.version}`);
} catch (error) {
  console.error(`Release Tag 校验失败: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
