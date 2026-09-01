import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  THEME_STORAGE_KEY,
  isThemeMode,
  readThemeMode,
  resolveTheme,
  writeThemeMode,
  type ThemeStorage,
} from "../../src/renderer/theme";

const themeTokens = [
  "app-background",
  "sidebar-background",
  "sidebar-border",
  "panel-background",
  "surface-background",
  "input-background",
  "code-background",
  "text-primary",
  "text-secondary",
  "text-muted",
  "border-default",
  "border-strong",
  "border-selected",
  "selection-background",
  "success",
  "warning",
  "danger",
] as const;

function extractCssRule(source: string, selector: string): string {
  const start = source.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `missing CSS rule: ${selector}`);
  const end = source.indexOf("}", start);
  assert.notEqual(end, -1, `unterminated CSS rule: ${selector}`);
  return source.slice(start, end + 1);
}

function statefulStorage(initialValue: string | null): ThemeStorage {
  let value = initialValue;

  return {
    getItem: (key) => {
      assert.equal(key, THEME_STORAGE_KEY);
      return value;
    },
    setItem: (key, nextValue) => {
      assert.equal(key, THEME_STORAGE_KEY);
      value = nextValue;
    },
  };
}

test("readThemeMode returns system when the stored value is missing", () => {
  assert.equal(readThemeMode(statefulStorage(null)), "system");
});

test("readThemeMode returns system when the stored value is invalid", () => {
  assert.equal(readThemeMode(statefulStorage("sepia")), "system");
});

test("readThemeMode returns each legal stored theme mode", () => {
  for (const mode of ["system", "light", "dark"] as const) {
    assert.equal(readThemeMode(statefulStorage(mode)), mode);
  }
});

test("isThemeMode recognizes system, light, and dark", () => {
  assert.equal(isThemeMode("system"), true);
  assert.equal(isThemeMode("light"), true);
  assert.equal(isThemeMode("dark"), true);
  assert.equal(isThemeMode("sepia"), false);
  assert.equal(isThemeMode(null), false);
});

test("resolveTheme keeps explicit light and dark modes independent of system state", () => {
  assert.equal(resolveTheme("light", true), "light");
  assert.equal(resolveTheme("light", false), "light");
  assert.equal(resolveTheme("dark", true), "dark");
  assert.equal(resolveTheme("dark", false), "dark");
});

test("resolveTheme follows the system dark-mode state for system mode", () => {
  assert.equal(resolveTheme("system", true), "dark");
  assert.equal(resolveTheme("system", false), "light");
});

test("uses the expected theme storage key", () => {
  assert.equal(THEME_STORAGE_KEY, "local-forwarder.theme-mode");
});

test("writeThemeMode and readThemeMode round-trip through stateful storage", () => {
  const storage = statefulStorage(null);

  writeThemeMode(storage, "dark");

  assert.equal(readThemeMode(storage), "dark");
});

test("theme storage helpers tolerate an absent storage adapter", () => {
  const storage: ThemeStorage | undefined = undefined;

  assert.equal(readThemeMode(storage), "system");
  assert.doesNotThrow(() => writeThemeMode(storage, "light"));
});

test("readThemeMode returns system when storage getItem throws", () => {
  const storage: ThemeStorage = {
    getItem: () => {
      throw new Error("storage unavailable");
    },
    setItem: () => undefined,
  };

  assert.equal(readThemeMode(storage), "system");
});

test("writeThemeMode does not throw when storage setItem throws", () => {
  const storage: ThemeStorage = {
    getItem: () => null,
    setItem: () => {
      throw new Error("storage unavailable");
    },
  };

  assert.doesNotThrow(() => writeThemeMode(storage, "light"));
});

test("App wires the appearance page and resolved theme to the app shell", async () => {
  const source = await readFile("src/renderer/App.tsx", "utf8");

  assert.match(source, /id: "appearance", label: "外观"/);
  assert.match(source, /data-theme=\{theme\}/);
  assert.match(source, /<AppearancePage/);
});

test("AppearancePage offers system, light, and dark theme choices", async () => {
  const source = await readFile("src/renderer/components/AppearancePage.tsx", "utf8").catch(() => "");

  for (const label of ["跟随系统", "浅色", "深色"]) assert.match(source, new RegExp(label));
});

test("AppearancePage renders the theme choices inside the actual theme grid", async () => {
  const source = await readFile("src/renderer/components/AppearancePage.tsx", "utf8").catch(() => "");

  assert.match(source, /className="panel appearance-page appearance-theme-panel"/);
  assert.match(source, /className="appearance-theme-grid"/);
});

test("AppearancePage delegates theme preview colors to CSS", async () => {
  const source = await readFile("src/renderer/components/AppearancePage.tsx", "utf8").catch(() => "");

  assert.doesNotMatch(source, /\bpreview\s*:/);
  assert.doesNotMatch(source, /style=\{\{\s*background:\s*option\.preview\s*\}\}/);
});

test("useTheme listens for system theme changes and persists the selected mode", async () => {
  const source = await readFile("src/renderer/useTheme.ts", "utf8").catch(() => "");

  assert.match(source, /prefers-color-scheme: dark/);
  assert.match(source, /addEventListener\("change"/);
  assert.match(source, /writeThemeMode/);
});

test("styles define semantic light and dark theme contracts", async () => {
  const source = await readFile("src/renderer/styles.css", "utf8");
  const defaultThemeRule = extractCssRule(source, ".app-shell");
  const lightThemeRule = extractCssRule(source, ".app-shell[data-theme=\"light\"]");

  for (const token of themeTokens) {
    assert.match(defaultThemeRule, new RegExp(`--${token}\\s*:`), `missing dark token: ${token}`);
    assert.match(lightThemeRule, new RegExp(`--${token}\\s*:`), `missing light token: ${token}`);
  }
  assert.match(defaultThemeRule, /color-scheme:\s*dark/);
  assert.match(lightThemeRule, /color-scheme:\s*light/);
  assert.match(defaultThemeRule, /--inverse\s*:/);
  assert.match(lightThemeRule, /--inverse\s*:/);
  assert.match(source, /\.sidebar\s*\{[^}]*background:\s*var\(--sidebar-background\)/s);
  assert.match(source, /\.content\s*\{[^}]*background:\s*var\(--app-background\)/s);
  assert.match(source, /\.appearance-theme-panel/);
  assert.match(source, /\.appearance-theme-grid/);
  assert.match(source, /\.appearance-theme-card:hover\s*\{/);
  assert.match(source, /\.appearance-theme-card:focus-visible\s*\{/);
  assert.match(source, /\.appearance-theme-card\.selected\s*,/);
  assert.match(source, /\.appearance-theme-preview::before\s*\{[^}]*background:\s*var\(--preview-sidebar\)/s);
  assert.match(source, /\.appearance-theme-preview::after\s*\{[^}]*background:\s*var\(--preview-panel\)/s);
  assert.match(source, /\.appearance-page\s*>\s*\.muted:first-of-type/);
  assert.doesNotMatch(source, /\.request-transport-select\s*\{[^}]*color-scheme:\s*dark/s);
  for (const selector of ["address-input", "request-transport-select"]) {
    const rule = extractCssRule(source, `.${selector}`);
    assert.match(rule, /color:\s*var\(--text-primary\)/);
    assert.match(rule, /background:\s*var\(--input-background\)/);
    assert.doesNotMatch(rule, /color:\s*#e8effa/);
    assert.doesNotMatch(rule, /background:\s*#111e32/);
  }
});
