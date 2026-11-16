import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("renderer defines one shared typography and control scale", async () => {
  const styles = await readFile("src/renderer/styles.css", "utf8");

  assert.match(styles, /--ui-font-2xs:\s*0\.6875rem/);
  assert.match(styles, /--ui-font-xs:\s*0\.75rem/);
  assert.match(styles, /--ui-font-sm:\s*0\.8125rem/);
  assert.match(styles, /--ui-font-md:\s*0\.875rem/);
  assert.match(styles, /--ui-font-2xl:\s*1\.375rem/);
  assert.match(styles, /--ui-control:\s*34px/);
  assert.match(styles, /--ui-control-lg:\s*38px/);
  assert.match(styles, /--ui-radius:\s*8px/);
});

test("buttons and form controls use the shared control scale", async () => {
  const styles = await readFile("src/renderer/styles.css", "utf8");

  assert.match(styles, /\.app-shell button,\s*\n\.app-shell input,\s*\n\.app-shell select,\s*\n\.app-shell textarea\s*\{\s*font-size:\s*var\(--ui-font-sm\)/);
  assert.match(styles, /app-shell input:not\(\[type="checkbox"\]\)[\s\S]*?height:\s*var\(--ui-control\)/);
  assert.match(styles, /\.app-shell :is\([\s\S]*?\.primary-button,[\s\S]*?\.local-cache-button,[\s\S]*?height:\s*var\(--ui-control\)/);
  assert.match(styles, /border-radius:\s*var\(--ui-radius\);\s*\n\s*padding:\s*0 12px;\s*\n\s*font-size:\s*var\(--ui-font-sm\)/);
  assert.match(styles, /\.encryption-actions > \.primary,[\s\S]*?height:\s*var\(--ui-control-lg\)/);
});

test("page headings, content spacing, and metadata follow the shared scale", async () => {
  const styles = await readFile("src/renderer/styles.css", "utf8");

  assert.match(styles, /\.app-shell \.content\s*\{[^}]*padding:\s*32px 40px 48px/);
  assert.match(styles, /\.app-shell \.panel-heading h2,[\s\S]*?font-size:\s*var\(--ui-font-2xl\)/);
  assert.match(styles, /\.app-shell \.panel\s*\{[^}]*border-radius:\s*var\(--ui-radius-panel\)/);
  assert.match(styles, /\.login-cache-field-key,[\s\S]*?font-size:\s*var\(--ui-font-2xs\)/);
  assert.match(styles, /\.local-variables-type,[\s\S]*?font-size:\s*var\(--ui-font-2xs\)/);
});
