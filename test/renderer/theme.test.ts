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
  "text-success",
  "text-description",
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

function extractCssToken(rule: string, token: string): string {
  const match = rule.match(new RegExp(`--${token}\\s*:\\s*([^;]+)`));
  assert.ok(match, `missing CSS token: ${token}`);
  return match[1].trim();
}

interface RgbColor {
  red: number;
  green: number;
  blue: number;
  alpha: number;
}

function parseCssColor(value: string): RgbColor {
  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const normalized = hex[1].length === 3
      ? hex[1].split("").map((part) => `${part}${part}`).join("")
      : hex[1];
    return {
      red: Number.parseInt(normalized.slice(0, 2), 16),
      green: Number.parseInt(normalized.slice(2, 4), 16),
      blue: Number.parseInt(normalized.slice(4, 6), 16),
      alpha: 1,
    };
  }

  const rgb = value.match(/^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)(?:\s*\/\s*([\d.]+)%?)?\s*\)$/i);
  assert.ok(rgb, `unsupported CSS color: ${value}`);
  return {
    red: Number(rgb[1]),
    green: Number(rgb[2]),
    blue: Number(rgb[3]),
    alpha: rgb[4] === undefined ? 1 : Number(rgb[4]) / 100,
  };
}

function compositeColor(foreground: RgbColor, background: RgbColor): RgbColor {
  return {
    red: (foreground.red * foreground.alpha) + (background.red * (1 - foreground.alpha)),
    green: (foreground.green * foreground.alpha) + (background.green * (1 - foreground.alpha)),
    blue: (foreground.blue * foreground.alpha) + (background.blue * (1 - foreground.alpha)),
    alpha: 1,
  };
}

function relativeLuminance(color: RgbColor): number {
  const channels = [color.red, color.green, color.blue].map((channel) => channel / 255);
  const linear = channels.map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return (0.2126 * linear[0]) + (0.7152 * linear[1]) + (0.0722 * linear[2]);
}

function contrastRatio(foreground: RgbColor, background: RgbColor): number {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
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

test("AppearancePage exposes three accessible theme cards", async () => {
  const source = await readFile("src/renderer/components/AppearancePage.tsx", "utf8").catch(() => "");
  const modes = [...source.matchAll(/\{ mode: "(system|light|dark)"/g)].map((match) => match[1]);

  assert.deepEqual(modes, ["system", "light", "dark"]);
  assert.match(source, /themeOptions\.map\(\(option\) => <button/);
  assert.match(source, /type="button"/);
  assert.match(source, /className=\{`appearance-theme-card/);
  assert.match(source, /data-mode=\{option\.mode\}/);
  assert.match(source, /aria-pressed=\{mode === option\.mode\}/);
  assert.match(source, /onClick=\{\(\) => onModeChange\(option\.mode\)\}/);
  assert.match(source, /mode === option\.mode && <span className="appearance-theme-card-check"/);
  assert.match(source, /option\.mode === "system" && <em className="appearance-theme-default"/);
});

test("AppearancePage renders the theme choices inside the actual theme grid", async () => {
  const source = await readFile("src/renderer/components/AppearancePage.tsx", "utf8").catch(() => "");

  assert.match(source, /className="panel appearance-page appearance-theme-panel"/);
  assert.match(source, /className="appearance-theme-grid"[^>]*role="group"[^>]*aria-label="主题模式"/);
});

test("AppearancePage exposes selected and system-default markers", async () => {
  const source = await readFile("src/renderer/components/AppearancePage.tsx", "utf8").catch(() => "");

  assert.match(source, /appearance-theme-card-check/);
  assert.match(source, /✓/);
  assert.match(source, /appearance-theme-default/);
  assert.match(source, /option\.mode === "system"/);
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

test("styles define independent light and dark theme scopes and tokens", async () => {
  const source = await readFile("src/renderer/styles.css", "utf8");
  const darkThemeRule = extractCssRule(source, ".app-shell");
  const lightThemeRule = extractCssRule(source, ".app-shell[data-theme=\"light\"]");

  for (const token of themeTokens) {
    assert.match(darkThemeRule, new RegExp(`--${token}\\s*:`), `missing dark token: ${token}`);
    assert.match(lightThemeRule, new RegExp(`--${token}\\s*:`), `missing light token: ${token}`);
  }
  assert.match(darkThemeRule, /color-scheme:\s*dark/);
  assert.match(lightThemeRule, /color-scheme:\s*light/);
  assert.match(darkThemeRule, /--inverse\s*:/);
  assert.match(lightThemeRule, /--inverse\s*:/);
  assert.match(darkThemeRule, /--preview-shadow\s*:/);
  assert.match(lightThemeRule, /--preview-shadow\s*:/);
});

test("theme text tokens meet AA against actual dark and light backgrounds", async () => {
  const source = await readFile("src/renderer/styles.css", "utf8");
  const themes = [
    { name: "dark", rule: extractCssRule(source, ".app-shell") },
    { name: "light", rule: extractCssRule(source, ".app-shell[data-theme=\"light\"]") },
  ];
  const textTokens = ["text-subtle", "text-muted", "warning", "text-tertiary"] as const;
  const backgroundTokens = [
    "app-background",
    "sidebar-background",
    "panel-background",
    "surface-background",
    "surface-alt-background",
    "surface-elevated-background",
    "surface-code-background",
    "input-background",
    "code-background",
    "code-surface-background",
  ];

  for (const theme of themes) {
    const appBackground = parseCssColor(extractCssToken(theme.rule, "app-background"));
    for (const textToken of textTokens) {
      const foreground = parseCssColor(extractCssToken(theme.rule, textToken));
      for (const backgroundToken of backgroundTokens) {
        const background = compositeColor(parseCssColor(extractCssToken(theme.rule, backgroundToken)), appBackground);
        const ratio = contrastRatio(foreground, background);
        assert.ok(ratio >= 4.5, `${theme.name} ${textToken} on ${backgroundToken}: ${ratio.toFixed(2)}`);
      }
    }
  }
});

test("AppearancePage structure and theme CSS interactions stay accessible and responsive", async () => {
  const [componentSource, styleSource] = await Promise.all([
    readFile("src/renderer/components/AppearancePage.tsx", "utf8"),
    readFile("src/renderer/styles.css", "utf8"),
  ]);
  const modes = [...componentSource.matchAll(/\{ mode: "(system|light|dark)"/g)].map((match) => match[1]);
  const gridRule = extractCssRule(styleSource, ".appearance-theme-grid");

  assert.deepEqual(modes, ["system", "light", "dark"]);
  assert.match(componentSource, /themeOptions\.map\(\(option\) => <button/);
  assert.match(componentSource, /type="button"/);
  assert.match(componentSource, /className=\{`appearance-theme-card/);
  assert.match(componentSource, /data-mode=\{option\.mode\}/);
  assert.match(componentSource, /aria-pressed=\{mode === option\.mode\}/);
  assert.match(componentSource, /onClick=\{\(\) => onModeChange\(option\.mode\)\}/);
  assert.match(componentSource, /className="appearance-theme-grid"[^>]*role="group"[^>]*aria-label="主题模式"/);
  assert.match(componentSource, /mode === option\.mode && <span className="appearance-theme-card-check"/);
  assert.match(componentSource, /option\.mode === "system" && <em className="appearance-theme-default"/);

  assert.match(gridRule, /grid-template-columns:\s*repeat\(3,/);
  for (const mode of ["system", "light", "dark"]) {
    assert.match(styleSource, new RegExp(`\\.appearance-theme-card\\[data-mode="${mode}"\\] \\.appearance-theme-preview`));
  }
  assert.doesNotMatch(styleSource, /\.appearance-theme-card:nth-child\(/);
  assert.match(styleSource, /\.appearance-theme-panel/);
  assert.match(styleSource, /\.appearance-theme-card:hover\s*\{/);
  assert.match(styleSource, /\.appearance-theme-card:focus-visible\s*\{/);
  assert.match(styleSource, /\.appearance-theme-card\.selected\s*,/);
  assert.match(styleSource, /\.appearance-theme-preview::before\s*\{[^}]*background:\s*var\(--preview-sidebar\)/s);
  assert.match(styleSource, /\.appearance-theme-preview::after\s*\{[^}]*background:\s*var\(--preview-panel\)/s);
  assert.match(styleSource, /\.appearance-theme-preview\s*\{[^}]*box-shadow:[^}]*var\(--preview-shadow\)/s);
  assert.doesNotMatch(styleSource, /\.appearance-theme-preview\s*\{[^}]*!important/);
  assert.match(styleSource, /@media \(max-width: 900px\) \{[^}]*\.appearance-theme-grid \{[^}]*grid-template-columns:\s*1fr/s);
  assert.match(styleSource, /@media \(min-width: 901px\) and \(max-width: 1050px\) \{[^}]*\.appearance-theme-grid \{[^}]*grid-template-columns:\s*repeat\(2,/s);
  assert.doesNotMatch(styleSource, /@media \(min-width: 821px\) and \(max-width: 1050px\)/);
  assert.match(styleSource, /@media \(max-width: 900px\) \{[\s\S]*?\.appearance-theme-preview\s*\{[^}]*flex:\s*0 1 48px/s);
  assert.match(styleSource, /@media \(max-width: 900px\) \{[\s\S]*?\.appearance-theme-card-check\s*\{[^}]*width:\s*20px/s);
  assert.match(styleSource, /\.appearance-theme-default\s*\{[^}]*color:\s*var\(--text-success\)/s);
  assert.match(styleSource, /\.appearance-theme-card-copy > span:not\(\.appearance-theme-card-label\)\s*\{[^}]*color:\s*var\(--text-description\)/s);
  assert.match(styleSource, /\.status-pill\.running\s*\{[^}]*color:\s*var\(--text-success\)/s);
  assert.match(styleSource, /\.log-level\s*\{[^}]*color:\s*var\(--text-success\)/s);
  assert.match(styleSource, /\.sidebar\s*\{[^}]*background:\s*var\(--sidebar-background\)/s);
  assert.match(styleSource, /\.content\s*\{[^}]*background:\s*var\(--app-background\)/s);
  assert.doesNotMatch(styleSource, /\.request-transport-select\s*\{[^}]*color-scheme:\s*dark/s);
  for (const selector of ["address-input", "request-transport-select"]) {
    const rule = extractCssRule(styleSource, `.${selector}`);
    assert.match(rule, /color:\s*var\(--text-primary\)/);
    assert.match(rule, /background:\s*var\(--input-background\)/);
    assert.doesNotMatch(rule, /color:\s*#e8effa/);
    assert.doesNotMatch(rule, /background:\s*#111e32/);
  }
});
