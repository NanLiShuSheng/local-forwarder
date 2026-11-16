import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("navigation exposes decryption directly above appearance", async () => {
  const source = await readFile("src/renderer/App.tsx", "utf8");
  assert.match(source, /\{ id: "decryption", label: "解密", icon: "decryption" \}, \{ id: "appearance", label: "外观", icon: "appearance" \}/);
  assert.match(source, /<PagePane active=\{page === "decryption"\}><DecryptionPage \/><\/PagePane>/);
});

test("decryption page wires directory history, progress, logs, and execution", async () => {
  const source = await readFile("src/renderer/components/DecryptionPage.tsx", "utf8");
  assert.match(source, /getDecryptionPreferences/);
  assert.match(source, /saveDecryptionPreferences/);
  assert.match(source, /selectDecryptionDirectory/);
  assert.match(source, /onDecryptionProgress/);
  assert.match(source, /window\.forwarder\.decryptDirectory\(inputDir, outputDir\)/);
  assert.match(source, /待解密文件夹目录/);
  assert.match(source, /解密后文件夹目录/);
  assert.match(source, /action: "选择解密目录"/);
  assert.match(source, /已存在的同名文件会被直接替换/);
  assert.match(source, /role="progressbar"/);
  assert.match(source, /decryption-failures/);
  assert.match(source, /SHA-256/);
});

test("decryption page is styled as a dedicated responsive workspace", async () => {
  const styles = await readFile("src/renderer/styles.css", "utf8");
  assert.match(styles, /\.decryption-page\s*\{/);
  assert.match(styles, /\.decryption-format-grid\s*\{/);
  assert.match(styles, /\.decryption-progress-card\s*\{/);
  assert.match(styles, /\.decryption-failure-row\s*\{/);
  assert.match(styles, /\.decryption-format-grid \{ grid-template-columns: 1fr; \}/);
});
