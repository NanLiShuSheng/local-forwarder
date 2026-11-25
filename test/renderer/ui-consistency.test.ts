import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("renderer defines one shared typography and control scale", async () => {
  const styles = await readFile("src/renderer/styles.css", "utf8");

  assert.match(styles, /--ui-font-2xs:\s*0\.6875rem/);
  assert.match(styles, /--ui-font-xs:\s*0\.71875rem/);
  assert.match(styles, /--ui-font-sm:\s*0\.78125rem/);
  assert.match(styles, /--ui-font-md:\s*0\.84375rem/);
  assert.match(styles, /--ui-font-lg:\s*0\.90625rem/);
  assert.match(styles, /--ui-font-2xl:\s*1\.125rem/);
  assert.match(styles, /--ui-control-sm:\s*26px/);
  assert.match(styles, /--ui-control:\s*30px/);
  assert.match(styles, /--ui-control-lg:\s*34px/);
  assert.match(styles, /--ui-radius:\s*8px/);
  assert.match(styles, /--ui-radius-panel:\s*14px/);
});

test("interface text keeps a readable minimum size", async () => {
  const styles = await readFile("src/renderer/styles.css", "utf8");
  const pixelSizes = [...styles.matchAll(/(?:font-size:\s*|font:\s*(?:[1-9]00\s+)?)([0-9.]+)px/g)].map((match) => Number(match[1]));

  assert.match(styles, /^:root\s*\{[^}]*font-size:\s*16px/);
  assert.ok(pixelSizes.length > 100);
  assert.ok(Math.min(...pixelSizes) >= 11);
});

test("buttons and form controls use the shared control scale", async () => {
  const styles = await readFile("src/renderer/styles.css", "utf8");

  assert.match(styles, /\.app-shell button,\s*\n\.app-shell input,\s*\n\.app-shell select,\s*\n\.app-shell textarea\s*\{\s*font-size:\s*var\(--ui-font-sm\)/);
  assert.match(styles, /app-shell input:not\(\[type="checkbox"\]\)[\s\S]*?height:\s*var\(--ui-control\)/);
  assert.match(styles, /\.app-shell :is\([\s\S]*?\.primary-button,[\s\S]*?\.local-cache-button,[\s\S]*?height:\s*var\(--ui-control\)/);
  assert.match(styles, /border-radius:\s*var\(--ui-radius\);\s*\n\s*padding:\s*0 12px;\s*\n\s*font-size:\s*var\(--ui-font-sm\)/);
  assert.match(styles, /\.encryption-actions > \.primary,[\s\S]*?height:\s*var\(--ui-control-lg\)/);
});

test("button hover states keep semantic label colors and transition smoothly", async () => {
  const styles = await readFile("src/renderer/styles.css", "utf8");
  const neutralHover = styles.match(/\.lf-btn:hover:not\(:disabled\)\s*\{([^}]*)\}/)?.[1] ?? "";
  const primaryHover = styles.match(/\.lf-btn\.primary:hover:not\(:disabled\)\s*\{([^}]*)\}/)?.[1] ?? "";
  const dangerHover = styles.match(/\.lf-btn\.danger:hover:not\(:disabled\)\s*\{([^}]*)\}/)?.[1] ?? "";

  assert.match(styles, /\.lf-app button\s*\{[^}]*transition:[^}]*color 140ms ease[^}]*\}/s);
  assert.doesNotMatch(neutralHover, /(?:^|;)\s*color:/);
  assert.match(primaryHover, /color:\s*var\(--button-primary-text\)/);
  assert.match(dangerHover, /color:\s*var\(--danger\)/);
});

test("page headings, content spacing, and metadata follow the shared scale", async () => {
  const styles = await readFile("src/renderer/styles.css", "utf8");

  assert.match(styles, /\.app-shell \.content\s*\{[^}]*padding:\s*32px 40px 48px/);
  assert.match(styles, /\.app-shell \.panel-heading h2,[\s\S]*?font-size:\s*var\(--ui-font-2xl\)/);
  assert.match(styles, /\.app-shell \.panel\s*\{[^}]*border-radius:\s*var\(--ui-radius-panel\)/);
  assert.match(styles, /\.login-cache-field-key,[\s\S]*?font-size:\s*var\(--ui-font-xs\)/);
  assert.match(styles, /\.local-variables-type,[\s\S]*?font-size:\s*var\(--ui-font-xs\)/);
});

test("workspace typography keeps a restrained heading hierarchy", async () => {
  const styles = await readFile("src/renderer/styles.css", "utf8");

  assert.match(styles, /\.lf-app\s*\{[\s\S]*?font:\s*13\.5px\/1\.5 var\(--lf-sans\)/);
  assert.match(styles, /\.lf-page-head h1\s*\{[^}]*font-size:\s*21px[^}]*font-weight:\s*660/);
  assert.match(styles, /\.lf-context-head h1\s*\{[^}]*font-size:\s*17px[^}]*font-weight:\s*650/);
  assert.match(styles, /\.lf-build-progress-head b\s*\{[^}]*font:\s*22px\/1/);
  assert.match(styles, /\.lf-metric-value\s*\{[^}]*font-size:\s*18px/);
});

test("metadata badges stay visually subordinate to primary text", async () => {
  const styles = await readFile("src/renderer/styles.css", "utf8");

  assert.match(styles, /\.lf-type-badge\s*\{[^}]*height:\s*17px[^}]*font-size:\s*11px[^}]*font-weight:\s*600[^}]*line-height:\s*1/);
  assert.match(styles, /\.lf-status-badge\s*\{[^}]*height:\s*18px[^}]*font-size:\s*11px[^}]*font-weight:\s*600[^}]*line-height:\s*1/);
  assert.match(styles, /\.lf-live-pill\s*\{[^}]*height:\s*18px[^}]*font-size:\s*11px[^}]*font-weight:\s*600[^}]*line-height:\s*1/);
  assert.match(styles, /\.lf-app \.lf-data-tab\s*\{[^}]*font-size:\s*12px[^}]*font-weight:\s*600/);
  assert.match(styles, /\.lf-app \.lf-text-button\s*\{[^}]*font-size:\s*11\.5px[^}]*font-weight:\s*600/);
});

test("the 11px type size is reserved for eyebrow labels", async () => {
  const styles = await readFile("src/renderer/styles.css", "utf8");

  assert.equal(styles.match(/font-size:\s*var\(--ui-font-2xs\)/g)?.length, 1);
  assert.match(styles, /\.app-shell \.eyebrow\s*\{[^}]*font-size:\s*var\(--ui-font-2xs\)/);
  assert.match(styles, /\.app-shell small\s*\{[^}]*font-size:\s*var\(--ui-font-xs\)/);
  assert.match(styles, /\.app-shell \.proxy-instance-sidebar-status\s*\{[^}]*font-size:\s*var\(--ui-font-xs\)/);
  assert.match(styles, /\.app-shell :is\(\.proxy-instance-sidebar-status,[\s\S]*?font-size:\s*var\(--ui-font-xs\)/);
  assert.match(styles, /\.appearance-theme-card-copy > span:not\(\.appearance-theme-card-label\)\s*\{[^}]*font-size:\s*var\(--ui-font-xs\)/);
});

test("titlebar does not show configuration save status", async () => {
  const [titlebar, styles] = await Promise.all([
    readFile("src/renderer/components/WorkspaceChrome.tsx", "utf8"),
    readFile("src/renderer/styles.css", "utf8"),
  ]);

  assert.doesNotMatch(titlebar, /配置已保存|lf-save-state|saveState/);
  assert.doesNotMatch(styles, /\.lf-save-state/);
});
