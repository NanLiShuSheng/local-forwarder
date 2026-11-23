import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { workspaceGroups } from "../../src/renderer/workspace-navigation";
import { formatBuildRemainingTime } from "../../src/renderer/components/BuildPage";

test("formats build remaining time from the active progress rate", () => {
  assert.equal(formatBuildRemainingTime(0), "0 秒");
  assert.equal(formatBuildRemainingTime(59), "59 秒");
  assert.equal(formatBuildRemainingTime(60), "1 分钟");
  assert.equal(formatBuildRemainingTime(90), "1 分 30 秒");
  assert.equal(formatBuildRemainingTime(3600), "1 小时");
  assert.equal(formatBuildRemainingTime(3660), "1 小时 1 分钟");
});

test("build workspace exposes encryption and decryption without separate navigation routes", async () => {
  const [appSource, buildSource] = await Promise.all([
    readFile("src/renderer/App.tsx", "utf8"),
    readFile("src/renderer/components/BuildPage.tsx", "utf8"),
  ]);

  assert.deepEqual(workspaceGroups.build.items.map((item) => item.route), ["build", "jobs"]);
  assert.deepEqual(workspaceGroups.build.items.map((item) => item.label), ["资源构建", "任务记录"]);
  assert.match(appSource, /<PagePane active=\{route === "build"\}>[\s\S]*?<BuildPage/);
  assert.doesNotMatch(appSource, /<DecryptionPage/);
  assert.match(buildSource, /type BuildTab = "encrypt" \| "decrypt"/);
  assert.match(buildSource, /加密输出/);
  assert.match(buildSource, /解密还原/);
});

test("unified build page wires decryption directories, history, progress, logs and failures", async () => {
  const source = await readFile("src/renderer/components/BuildPage.tsx", "utf8");

  for (const token of [
    "getDecryptionPreferences",
    "saveDecryptionPreferences",
    "selectDecryptionDirectory",
    "onDecryptionProgress",
    "window.forwarder.decryptDirectory(decryptionInput, decryptionOutput)",
    "待解密目录",
    "还原目录",
    "role=\"progressbar\"",
    "SHA-256",
    "decryptionFailures",
    "取消任务",
    "构建日志",
  ]) assert.match(source, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  assert.match(source, /const \[decryptionFailures, setDecryptionFailures\] = useState<DecryptionFailure\[\]>\(\[\]\)/);
  assert.match(source, /setDecryptionFailures\(result\.failures \?\? \[\]\)/);
  assert.match(source, /className="lf-build-failures"/);
  assert.match(source, /onUpdateTask\(taskId, \{ status: "success"/);
  assert.match(source, /<span>剩余时间<\/span><strong>\{remainingTime\}<\/strong>/);
  assert.match(source, /setInterval\(\(\) => setProgressNow\(Date\.now\(\)\), 1000\)/);
});

test("build workspace is styled as one responsive encryption and decryption surface", async () => {
  const styles = await readFile("src/renderer/styles.css", "utf8");

  assert.match(styles, /\.lf-build-grid\s*\{[^}]*grid-template-columns:/);
  assert.match(styles, /\.lf-build-card\s*\{/);
  assert.match(styles, /\.lf-build-progress-track\s*\{/);
  assert.match(styles, /\.lf-build-failures\s*\{/);
  assert.match(styles, /@media \(max-width: 1180px\)[\s\S]*?\.lf-build-grid\s*\{\s*grid-template-columns:\s*1fr;/);
});
