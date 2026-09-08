import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("navigation exposes the encryption page", async () => {
  const source = await readFile("src/renderer/App.tsx", "utf8");
  assert.match(source, /id: "encryption", label: "加密"/);
});

test("App keeps encryption history when selecting or saving a directory", async () => {
  const source = await readFile("src/renderer/App.tsx", "utf8");
  assert.match(source, /const initialEncryptionPreferences: EncryptionPreferences = \{ inputDir: "", outputDir: "", inputHistory: \[\], outputHistory: \[\] \};/);
  assert.match(source, /setEncryptionPreferences\(\(current\) => result\.preferences \?\? \{ \.\.\.current, \.\.\.patch \}\);/);
  assert.doesNotMatch(source, /setEncryptionPreferences\(result\.preferences \?\? \{ \.\.\.encryptionPreferences, \.\.\.patch \}\)/);
  assert.match(source, /setEncryptionPreferences\(\(current\) => result\.preferences \?\? \(kind === "input" \? \{ \.\.\.current, inputDir: selectedPath \} : \{ \.\.\.current, outputDir: selectedPath \}\)\);/);
});

test("ConfigPages saves encryption directories through the dedicated patch type", async () => {
  const source = await readFile("src/renderer/components/ConfigPages.tsx", "utf8");
  assert.match(source, /EncryptionPreferencesPatch/);
  assert.match(source, /onSaveEncryptionPreferences: \(patch: EncryptionPreferencesPatch\)/);
  assert.doesNotMatch(source, /onSaveEncryptionPreferences: \(patch: Partial<EncryptionPreferences>\)/);
});

test("encryption page exposes two directory selectors and an execution action", async () => {
  const source = await readFile("src/renderer/components/ConfigPages.tsx", "utf8");
  for (const label of ["加密前文件夹目录", "加密后文件夹目录", "选择加密前目录", "选择加密后目录", "开始加密", "增量加密"]) {
    assert.match(source, new RegExp(label));
  }
  assert.match(source, /onSelectEncryptionDirectory/);
  assert.match(source, /onEncryptDirectory/);
  assert.match(source, /onSaveEncryptionPreferences/);
  assert.match(source, /onKeyDown/);
  assert.doesNotMatch(source, /<input readOnly value=\{encryptionInputDir\}/);
  assert.doesNotMatch(source, /<input readOnly value=\{encryptionOutputDir\}/);
  assert.match(source, /encryptionRunning/);
  assert.match(source, /disabled=\{encryptionRunning/);
});

test("full encryption is primary and incremental encryption is outlined", async () => {
  const component = await readFile("src/renderer/components/ConfigPages.tsx", "utf8");
  const styles = await readFile("src/renderer/styles.css", "utf8");
  assert.match(component, /className="primary"[\s\S]{0,300}>开始加密/);
  assert.match(component, /className="encryption-incremental-button"[\s\S]{0,300}增量加密/);
  assert.match(styles, /\.encryption-incremental-button\s*\{/);
});

test("encryption page does not show the recursive processing description", async () => {
  const component = await readFile("src/renderer/components/ConfigPages.tsx", "utf8");
  assert.doesNotMatch(component, /递归处理目录中的普通文件/);
});

test("encryption page exposes separate full and incremental actions", async () => {
  const source = await readFile("src/renderer/components/ConfigPages.tsx", "utf8");
  assert.match(source, /开始加密/);
  assert.match(source, /增量加密/);
  assert.match(source, /startEncryption\("full"\)/);
  assert.match(source, /startEncryption\("incremental"\)/);
  assert.match(source, /onEncryptDirectory\(encryptionInputDir, encryptionOutputDir, mode\)/);
  assert.match(source, /onEncryptionProgress/);
  assert.match(source, /正在扫描文件/);
  assert.match(source, /progress\.relativePath/);
});

test("encryption page only appends logs for encrypted files", async () => {
  const source = await readFile("src/renderer/components/ConfigPages.tsx", "utf8");
  assert.doesNotMatch(source, /progress\.status === "skipping" \? "跳过"/);
  assert.match(source, /progress\.status === "encrypting"/);
});

test("encryption page has dedicated directory layout and live log styling", async () => {
  const source = await readFile("src/renderer/styles.css", "utf8");
  assert.match(source, /\.encryption-directory-field/);
  assert.match(source, /\.encryption-log/);
});

test("encryption page uses only the live log box for progress", async () => {
  const source = await readFile("src/renderer/components/ConfigPages.tsx", "utf8");
  assert.doesNotMatch(source, /className=\{`encryption-status/);
  assert.doesNotMatch(source, /encryption-status-grid/);
  assert.match(source, /encryptionLogs/);
});

test("encryption page shows live progress and file counts above the output directory", async () => {
  const component = await readFile("src/renderer/components/ConfigPages.tsx", "utf8");
  const styles = await readFile("src/renderer/styles.css", "utf8");
  assert.match(component, /className="encryption-progress"/);
  assert.match(component, /role="progressbar"/);
  assert.match(component, /总文件数/);
  assert.match(component, /已加密文件/);
  assert.match(component, /setEncryptionProgress/);
  assert.match(component, /progress\.processedFiles/);
  assert.ok(component.indexOf('className="encryption-progress"') > component.lastIndexOf("加密后文件夹目录"));
  assert.match(styles, /\.encryption-progress/);
  assert.match(styles, /\.encryption-progress-bar/);
});
