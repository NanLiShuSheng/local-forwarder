import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import test, { mock } from "node:test";
import type * as React from "react";
import {
  THEME_STORAGE_KEY,
  isThemeMode,
  readThemeMode,
  resolveTheme,
  writeThemeMode,
  type ThemeStorage,
} from "../../src/renderer/theme";
import { workspaceGroups } from "../../src/renderer/workspace-navigation";

const require = createRequire(import.meta.url);
const reactModule = require("react") as typeof React;

const themeTokens = [
  "app-background",
  "sidebar-background",
  "sidebar-border",
  "panel-background",
  "surface-background",
  "surface-alt-background",
  "surface-elevated-background",
  "surface-hover-background",
  "input-background",
  "code-background",
  "overview-field-background",
  "overview-field-border",
  "overview-field-input-background",
  "overview-field-input-border",
  "overview-field-shadow",
  "text-primary",
  "text-bright",
  "text-secondary",
  "text-muted",
  "text-success",
  "text-accent",
  "text-action",
  "text-selected",
  "text-description",
  "border-default",
  "border-strong",
  "border-selected",
  "selection-background",
  "selection-border",
  "selection-card-text",
  "selection-muted-text",
  "selection-tab-text",
  "selection-tab-underline",
  "selection-row-background",
  "selection-row-text",
  "selection-row-accent",
  "selection-row-hover-background",
  "progress-card-background",
  "progress-card-border",
  "progress-card-orb",
  "progress-card-shadow",
  "progress-stat-background",
  "progress-stat-border",
  "progress-track-background",
  "progress-track-shadow",
  "progress-fill-background",
  "progress-fill-shadow",
  "progress-percent-text",
  "accent",
  "accent-hover",
  "accent-soft",
  "accent-faint",
  "button-primary-background",
  "button-primary-hover",
  "button-primary-text",
  "button-primary-shadow",
  "success",
  "warning",
  "danger",
  "focus-background",
  "focus-ring",
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

async function rendererSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return rendererSourceFiles(path);
    return /\.(?:css|html|ts|tsx)$/.test(entry.name) ? [path] : [];
  }));
  return files.flat();
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

function withWindow<T>(windowValue: unknown, callback: () => T): T {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: windowValue });
  try {
    return callback();
  } finally {
    if (descriptor) {
      Object.defineProperty(globalThis, "window", descriptor);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  }
}

async function withWindowAsync<T>(windowValue: unknown, callback: () => Promise<T>): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: windowValue });
  try {
    return await callback();
  } finally {
    if (descriptor) {
      Object.defineProperty(globalThis, "window", descriptor);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  }
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

test("useTheme registers system listeners, rerenders on changes, and cleans up on unmount", async () => {
  let matches = true;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const mediaQuery = {
    get matches() {
      return matches;
    },
    addEventListener: (_type: "change", listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
    removeEventListener: (_type: "change", listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener),
  } as unknown as MediaQueryList;
  const fakeWindow = { matchMedia: () => mediaQuery };
  const hookStates: Array<{ value: unknown }> = [];
  let hookCursor = 0;
  let effectRegistrations = 0;
  let mounted = false;
  let cleanup: (() => void) | undefined;

  try {
    mock.method(reactModule, "useState", ((initialValue: unknown) => {
      const stateIndex = hookCursor++;
      const state = hookStates[stateIndex] ?? {
        value: typeof initialValue === "function" ? (initialValue as () => unknown)() : initialValue,
      };
      hookStates[stateIndex] = state;
      return [state.value, (nextValue: unknown) => {
        state.value = typeof nextValue === "function"
          ? (nextValue as (currentValue: unknown) => unknown)(state.value)
          : nextValue;
      }];
    }) as typeof reactModule.useState);
    mock.method(reactModule, "useEffect", ((effect: () => void | (() => void)) => {
      effectRegistrations += 1;
      if (!mounted) {
        cleanup = effect() ?? undefined;
        mounted = true;
      }
    }) as typeof reactModule.useEffect);

    await withWindowAsync(fakeWindow, async () => {
      const { useTheme } = await import("../../src/renderer/useTheme");
      const render = () => {
        hookCursor = 0;
        return useTheme();
      };
      const emit = (nextMatches: boolean) => {
        matches = nextMatches;
        for (const listener of [...listeners]) listener({ matches: nextMatches } as MediaQueryListEvent);
      };

      assert.equal(render().theme, "dark");
      assert.equal(hookStates[1]?.value, true);
      assert.equal(listeners.size, 1);
      assert.equal(effectRegistrations, 1);

      emit(false);
      assert.equal(render().theme, "light");
      assert.equal(hookStates[1]?.value, false);
      assert.equal(effectRegistrations, 2);

      cleanup?.();
      cleanup = undefined;
      assert.equal(listeners.size, 0);

      emit(true);
      assert.equal(hookStates[1]?.value, false);
    });
  } finally {
    mock.restoreAll();
  }
});

test("readSystemIsDark reads the initial matchMedia matches value", async () => {
  const { readSystemIsDark } = await import("../../src/renderer/useTheme");
  const mediaQuery = { matches: false } as MediaQueryList;
  const fakeWindow = {
    matchMedia: (query: string) => {
      assert.equal(query, "(prefers-color-scheme: dark)");
      return mediaQuery;
    },
  };

  assert.equal(withWindow(fakeWindow, () => readSystemIsDark()), false);
});

test("subscribeToSystemTheme forwards change event matches to its callback", async () => {
  const { subscribeToSystemTheme } = await import("../../src/renderer/useTheme");
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const mediaQuery = {
    matches: false,
    addEventListener: (_type: "change", listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
    removeEventListener: (_type: "change", listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener),
  } as unknown as MediaQueryList;
  const fakeWindow = { matchMedia: () => mediaQuery };
  const received: boolean[] = [];

  withWindow(fakeWindow, () => subscribeToSystemTheme((matches) => received.push(matches)));
  for (const matches of [true, false]) {
    for (const listener of listeners) listener({ matches } as MediaQueryListEvent);
  }

  assert.deepEqual(received, [true, false]);
});

test("subscribeToSystemTheme cleanup stops future change notifications", async () => {
  const { subscribeToSystemTheme } = await import("../../src/renderer/useTheme");
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const mediaQuery = {
    matches: false,
    addEventListener: (_type: "change", listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
    removeEventListener: (_type: "change", listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener),
  } as unknown as MediaQueryList;
  const fakeWindow = { matchMedia: () => mediaQuery };
  const received: boolean[] = [];
  const cleanup = withWindow(fakeWindow, () => subscribeToSystemTheme((matches) => received.push(matches)));

  assert.ok(cleanup);
  cleanup?.();
  for (const listener of listeners) listener({ matches: true } as MediaQueryListEvent);

  assert.deepEqual(received, []);
});

test("subscribeToSystemTheme supports the legacy addListener API and cleanup", async () => {
  const { subscribeToSystemTheme } = await import("../../src/renderer/useTheme");
  let listener: ((event: MediaQueryListEvent) => void) | undefined;
  const mediaQuery = {
    matches: false,
    addListener: (nextListener: (event: MediaQueryListEvent) => void) => {
      listener = nextListener;
    },
    removeListener: (nextListener: (event: MediaQueryListEvent) => void) => {
      if (listener === nextListener) listener = undefined;
    },
  } as unknown as MediaQueryList;
  const fakeWindow = { matchMedia: () => mediaQuery };
  const received: boolean[] = [];
  const cleanup = withWindow(fakeWindow, () => subscribeToSystemTheme((matches) => received.push(matches)));

  assert.ok(cleanup);
  listener?.({ matches: true } as MediaQueryListEvent);
  cleanup?.();
  listener?.({ matches: false } as MediaQueryListEvent);

  assert.deepEqual(received, [true]);
});

test("system theme adapter falls back to dark when matchMedia is unavailable or throws", async () => {
  const { readSystemIsDark, subscribeToSystemTheme } = await import("../../src/renderer/useTheme");
  assert.equal(withWindow({}, () => readSystemIsDark()), true);
  assert.equal(withWindow({ matchMedia: () => { throw new Error("matchMedia unavailable"); } }, () => readSystemIsDark()), true);
  assert.doesNotThrow(() => withWindow({}, () => subscribeToSystemTheme(() => undefined)));
  assert.doesNotThrow(() => withWindow({ matchMedia: () => { throw new Error("matchMedia unavailable"); } }, () => subscribeToSystemTheme(() => undefined)));
});

test("App wires the appearance page and resolved theme to the app shell", async () => {
  const source = await readFile("src/renderer/App.tsx", "utf8");

  assert.deepEqual(workspaceGroups.settings.items.map((item) => item.route), ["appearance", "update", "advanced"]);
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

  assert.deepEqual(modes, ["light", "dark", "system"]);
  assert.match(source, /themeOptions\.map\(\(option\) => <button/);
  assert.match(source, /type="button"/);
  assert.match(source, /className=\{`lf-theme-card/);
  assert.match(source, /data-theme-option=\{option\.mode\}/);
  assert.match(source, /aria-pressed=\{mode === option\.mode\}/);
  assert.match(source, /onClick=\{\(\) => onModeChange\(option\.mode\)\}/);
  assert.match(source, /mode === option\.mode && <span className="lf-theme-check"/);
});

test("AppearancePage renders the theme choices inside the actual theme grid", async () => {
  const source = await readFile("src/renderer/components/AppearancePage.tsx", "utf8").catch(() => "");

  assert.match(source, /className="lf-theme-grid" role="group" aria-label="主题"/);
  assert.match(source, /<span className="lf-theme-preview"/);
});

test("AppearancePage exposes selected and system-default markers", async () => {
  const source = await readFile("src/renderer/components/AppearancePage.tsx", "utf8").catch(() => "");

  assert.match(source, /lf-theme-check/);
  assert.match(source, /✓/);
  assert.match(source, /mode === option\.mode \? "active" : ""/);
  assert.match(source, /label: "跟随系统"/);
});

test("AppearancePage delegates theme preview colors to CSS", async () => {
  const source = await readFile("src/renderer/components/AppearancePage.tsx", "utf8").catch(() => "");

  assert.doesNotMatch(source, /\bpreview\s*:/);
  assert.doesNotMatch(source, /style=\{\{\s*background:\s*option\.preview\s*\}\}/);
});

test("the platform shortcut toggles and persists the resolved appearance", async () => {
  const [appSource, chromeSource, pagesSource] = await Promise.all([
    readFile("src/renderer/App.tsx", "utf8"),
    readFile("src/renderer/components/WorkspaceChrome.tsx", "utf8"),
    readFile("src/renderer/components/WorkspacePages.tsx", "utf8"),
  ]);

  assert.match(appSource, /event\.key\.toLocaleLowerCase\(\) === "l"[\s\S]*?setMode\(theme === "dark" \? "light" : "dark"\)/);
  assert.match(appSource, /shortcut: formatShortcut\("L"\)/);
  assert.match(chromeSource, /formatShortcut\("L"\)/);
  assert.match(pagesSource, /<span>切换外观<\/span><kbd>\{formatShortcut\("L"\)\}<\/kbd>/);
});

test("useTheme listens for system theme changes and persists the selected mode", async () => {
  const source = await readFile("src/renderer/useTheme.ts", "utf8").catch(() => "");

  assert.match(source, /readSystemIsDark/);
  assert.match(source, /subscribeToSystemTheme/);
  assert.match(source, /writeThemeMode/);
});

test("theme focus rings are opaque and meet 3:1 contrast against actual card backgrounds", async () => {
  const source = await readFile("src/renderer/styles.css", "utf8");
  const themes = [
    { name: "dark", rule: extractCssRule(source, ".app-shell") },
    { name: "light", rule: extractCssRule(source, ".app-shell[data-theme=\"light\"]") },
  ];
  const focusRule = extractCssRule(source, ".appearance-theme-card:focus-visible");
  const backgroundTokens = [
    "app-background",
    "panel-background",
    "surface-background",
    "surface-selected-background",
  ] as const;

  assert.match(focusRule, /outline:\s*2px\s+solid\s+var\(--focus-ring\)/);
  for (const theme of themes) {
    const focusRing = parseCssColor(extractCssToken(theme.rule, "focus-ring"));
    const appBackground = parseCssColor(extractCssToken(theme.rule, "app-background"));

    assert.equal(focusRing.alpha, 1, `${theme.name} focus ring must be opaque`);
    for (const backgroundToken of backgroundTokens) {
      const background = compositeColor(parseCssColor(extractCssToken(theme.rule, backgroundToken)), appBackground);
      const ratio = contrastRatio(focusRing, background);
      assert.ok(ratio >= 3, `${theme.name} focus ring on ${backgroundToken}: ${ratio.toFixed(2)}`);
    }
  }
});

test("sidebar navigation defines active and keyboard focus highlight states", async () => {
  const source = await readFile("src/renderer/styles.css", "utf8");
  const baseRule = extractCssRule(source, ".sidebar-nav button");
  const activeRule = extractCssRule(source, ".sidebar-nav button.active");
  const focusRule = extractCssRule(source, ".sidebar-nav button:focus-visible");

  assert.match(baseRule, /border-left:\s*3px\s+solid\s+transparent/);
  assert.match(activeRule, /border-left-color:\s*var\(--selection-border\)/);
  assert.match(activeRule, /color:\s*var\(--selection-card-text\)/);
  assert.match(activeRule, /background:\s*var\(--surface-selected-background\)/);
  assert.match(focusRule, /outline:\s*2px\s+solid\s+var\(--focus-ring\)/);
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

test("themes use the approved green workbench palettes", async () => {
  const source = await readFile("src/renderer/styles.css", "utf8");
  const darkRule = extractCssRule(source, ".app-shell");
  const lightRule = extractCssRule(source, ".app-shell[data-theme=\"light\"]");

  const darkExpected = {
    "app-background": "#0d1117",
    "sidebar-background": "#010409",
    "panel-background": "#151b23",
    "text-primary": "#f0f6fc",
    "button-primary-background": "#74c4a3",
    "button-primary-hover": "#82d0b0",
    "button-primary-text": "#06120c",
    "border-default": "#2f3742",
    "border-selected": "#54c091",
    "selection-border": "#54c091",
    "selection-tab-text": "#63ad8e",
    "selection-tab-underline": "#54c091",
    "selection-row-text": "#f0f6fc",
    "selection-row-accent": "#54c091",
    "accent": "#54c091",
    "accent-hover": "#63ad8e",
    "text-accent": "#63ad8e",
    "text-action": "#63ad8e",
    "text-success": "#63ad8e",
    "focus-ring": "#54c091",
    "success": "#54c091",
  };
  const lightExpected = {
    "app-background": "#edf1f5",
    "sidebar-background": "#f8fafc",
    "panel-background": "#ffffff",
    "text-primary": "#18232f",
    "border-default": "#dbe3ec",
    "border-selected": "#0f9f76",
    "selection-border": "#0f9f76",
    "selection-tab-text": "#087f5c",
    "selection-tab-underline": "#0f9f76",
    "selection-row-text": "#18232f",
    "selection-row-accent": "#0f9f76",
    "accent": "#0f9f76",
    "accent-hover": "#087f5c",
    "text-accent": "#087f5c",
    "text-action": "#0f9f76",
    "text-success": "#087f5c",
    "focus-ring": "#087f5c",
    "success": "#0f9f76",
  };

  for (const [token, expected] of Object.entries(darkExpected)) assert.equal(extractCssToken(darkRule, token), expected, `unexpected dark token: ${token}`);
  for (const [token, expected] of Object.entries(lightExpected)) assert.equal(extractCssToken(lightRule, token), expected, `unexpected light token: ${token}`);
  assert.match(lightRule, /background:\s*var\(--app-background\)/);
  assert.match(lightRule, /color-scheme:\s*light/);
});

test("light theme primary actions use a muted jade fill with softer white text", async () => {
  const source = await readFile("src/renderer/styles.css", "utf8");
  const lightRule = extractCssRule(source, ".app-shell[data-theme=\"light\"]");
  const buttonRule = extractCssRule(source, ".lf-btn.primary");
  const hoverRule = extractCssRule(source, ".lf-btn.primary:hover:not(:disabled)");

  assert.equal(extractCssToken(lightRule, "button-primary-background"), "#267965");
  assert.equal(extractCssToken(lightRule, "button-primary-hover"), "#1f6655");
  assert.equal(extractCssToken(lightRule, "button-primary-text"), "#f5faf7");
  assert.match(buttonRule, /border-color:\s*var\(--button-primary-background\)/);
  assert.match(buttonRule, /color:\s*var\(--button-primary-text\)/);
  assert.match(buttonRule, /background:\s*var\(--button-primary-background\)/);
  assert.match(buttonRule, /box-shadow:\s*var\(--button-primary-shadow\)/);
  assert.match(hoverRule, /background:\s*var\(--button-primary-hover\)/);
});

test("dark theme reuses the 0.5.0 graphite surfaces and cool text", async () => {
  const source = await readFile("src/renderer/styles.css", "utf8");
  const darkRule = extractCssRule(source, ".app-shell");
  const expected = {
    "app-background": "#0d1117",
    "sidebar-background": "#010409",
    "panel-background": "#151b23",
    "surface-background": "#212830",
    "surface-alt-background": "#262c36",
    "surface-subtle-background": "#1a2029",
    "surface-elevated-background": "#2a313c",
    "input-background": "#010409",
    "code-background": "#010409",
    "border-default": "#2f3742",
    "border-strong": "#3d444d",
    "text-primary": "#f0f6fc",
    "text-secondary": "#b7bdc8",
    "text-muted": "#949ca6",
  };

  for (const [token, value] of Object.entries(expected)) {
    assert.equal(extractCssToken(darkRule, token), value, `unexpected 0.5.0 dark token: ${token}`);
  }
  for (const token of ["app-background", "sidebar-background", "panel-background"] as const) {
    const color = parseCssColor(extractCssToken(darkRule, token));
    assert.ok(color.blue > color.red, `${token} must keep the cool graphite cast`);
  }
  assert.equal(extractCssToken(darkRule, "warning"), "#d29922");
  assert.equal(extractCssToken(darkRule, "info"), "#58a6ff");
  assert.equal(extractCssToken(darkRule, "log-request-action-text"), "#79c0ff");
});

test("dark theme uses the 0.5.0 cool primary text level with green selection text", async () => {
  const source = await readFile("src/renderer/styles.css", "utf8");
  const darkRule = extractCssRule(source, ".app-shell");
  const coolTextTokens = [
    "text-primary",
    "text-bright",
    "selection-card-text",
    "selection-row-text",
    "text-selected",
  ] as const;

  for (const token of coolTextTokens) {
    assert.equal(extractCssToken(darkRule, token), "#f0f6fc", `unexpected dark primary text token: ${token}`);
  }
  assert.equal(extractCssToken(darkRule, "inverse"), "#ffffff");
  const text = parseCssColor(extractCssToken(darkRule, "text-primary"));
  assert.ok(text.blue > text.red, "dark text must keep the cool graphite hue");
  const panel = parseCssColor(extractCssToken(darkRule, "panel-background"));
  assert.ok(contrastRatio(text, panel) >= 12, "dark text must retain strong readability");
  assert.match(source, /\.lf-context-head h1\s*\{[^}]*color:\s*var\(--text-primary\)/);
});

test("dark theme keeps green labels on the softened jade text level", async () => {
  const source = await readFile("src/renderer/styles.css", "utf8");
  const darkRule = extractCssRule(source, ".app-shell");
  const textTokens = [
    "accent-hover",
    "text-accent",
    "text-action",
    "text-success",
    "selection-tab-text",
    "progress-percent-text",
  ] as const;

  for (const token of textTokens) {
    assert.equal(extractCssToken(darkRule, token), "#63ad8e", `unexpected dark green text token: ${token}`);
  }
  for (const selector of [".lf-text-button", ".lf-popover-foot button", ".lf-metric-sub.good", ".lf-status-site"]) {
    assert.match(extractCssRule(source, selector), /color:\s*var\(--text-action\)/, `${selector} must use the softer green text level`);
  }
  assert.equal(extractCssToken(darkRule, "accent"), "#54c091");
  assert.equal(extractCssToken(darkRule, "button-primary-hover"), "#82d0b0");
});

test("light theme uses white panels, subtle gray surfaces, and green selected states", async () => {
  const source = await readFile("src/renderer/styles.css", "utf8");
  const lightRule = extractCssRule(source, ".app-shell[data-theme=\"light\"]");
  const panelRule = source.match(/\.app-shell\[data-theme=\"light\"\][^{]*\.panel[^{]*\{[^}]*\}/s)?.[0] ?? "";
  const selectedInstanceRule = extractCssRule(source, ".proxy-instance-sidebar-card.selected");

  assert.equal(extractCssToken(lightRule, "panel-background"), "#ffffff");
  assert.equal(extractCssToken(lightRule, "surface-background"), "#f7f9fb");
  assert.equal(extractCssToken(lightRule, "surface-selected-background"), "#e9f8f2");
  assert.equal(extractCssToken(lightRule, "border-selected"), "#0f9f76");
  assert.match(panelRule, /box-shadow:\s*0\s+10px\s+26px\s+var\(--shadow-color\)/);
  assert.match(selectedInstanceRule, /border-color:\s*var\(--selection-border\)/);
  assert.doesNotMatch(source, /\.app-shell\[data-theme=\"light\"\] \.proxy-instance-sidebar-card\.selected\s*\{/);
});

test("light theme applies the green selection palette to proxy, JSON tabs, and JSON rows", async () => {
  const source = await readFile("src/renderer/styles.css", "utf8");
  const lightRule = extractCssRule(source, ".app-shell[data-theme=\"light\"]");
  const proxyRule = extractCssRule(source, ".proxy-instance-sidebar-card.selected");
  const tabRule = extractCssRule(source, ".json-preview-tabs button.active");
  const treeRule = extractCssRule(source, ".json-preview-tree-row.selected");
  const tableRule = extractCssRule(source, ".json-preview-table tr.selected");

  assert.equal(extractCssToken(lightRule, "surface-selected-background"), "#e9f8f2");
  assert.equal(extractCssToken(lightRule, "selection-border"), "#0f9f76");
  assert.equal(extractCssToken(lightRule, "selection-tab-underline"), "#0f9f76");
  assert.equal(extractCssToken(lightRule, "selection-row-background"), "#e9f8f2");
  assert.match(proxyRule, /border-color:\s*var\(--selection-border\)/);
  assert.match(proxyRule, /background:\s*var\(--surface-selected-background\)/);
  assert.match(tabRule, /border-bottom-color:\s*var\(--selection-tab-underline\)/);
  assert.match(tabRule, /color:\s*var\(--selection-tab-text\)/);
  assert.match(treeRule, /background:\s*var\(--selection-row-background\)/);
  assert.match(treeRule, /box-shadow:\s*inset 3px 0 0 var\(--selection-row-accent\)/);
  assert.match(tableRule, /background:\s*var\(--selection-row-background\)/);
});

test("selection palette covers logs, rules, login cache, and history options", async () => {
  const source = await readFile("src/renderer/styles.css", "utf8");
  const rules = [
    [".rule-row.selected", /background:\s*var\(--surface-selected-background\)/],
    [".log-row.selected", /background:\s*var\(--selection-row-background\)/],
    [".log-detail-tabs button.active", /color:\s*var\(--selection-tab-text\)/],
    [".login-cache-filters button.active", /background:\s*var\(--surface-selected-background\)/],
    [".login-cache-field-row.selected", /background:\s*var\(--selection-row-background\)/],
    [".address-history-option[aria-selected=\"true\"]", /background:\s*var\(--selection-row-background\)/],
    [".encryption-history-option[aria-selected=\"true\"]", /background:\s*var\(--selection-row-background\)/],
    [".decryption-history-option[aria-selected=\"true\"]", /background:\s*var\(--selection-row-background\)/],
  ] as const;

  for (const [selector, pattern] of rules) {
    assert.match(extractCssRule(source, selector), pattern, `selection token missing from ${selector}`);
  }
});

test("JSON preview reserves success green for status and uses theme interaction colors", async () => {
  const [componentSource, styleSource] = await Promise.all([
    readFile("src/renderer/components/JsonPreviewPage.tsx", "utf8"),
    readFile("src/renderer/styles.css", "utf8"),
  ]);
  const valueStringRule = extractCssRule(styleSource, ".json-preview-value-string");
  const treeSelectedRule = styleSource.match(/^\.json-preview-tree-row\.selected :is\([^}]*\}/m)?.[0] ?? "";
  const exportColorsBlock = componentSource.match(/function exportColors[\s\S]*?\n\}/m)?.[0] ?? "";
  const valueColorBlock = componentSource.match(/function canvasValueColor[\s\S]*?\n\}/m)?.[0] ?? "";

  assert.match(valueStringRule, /color:\s*var\(--text-accent\)/);
  assert.match(treeSelectedRule, /\.json-preview-value/);
  assert.match(valueColorBlock, /type === "string"\) return colors\.info/);
  assert.match(componentSource, /selectionRowBackground: cssToken\(style, "--selection-row-background"/);
  assert.match(componentSource, /selectionTabText: cssToken\(style, "--selection-tab-text"/);
  assert.match(componentSource, /colors\.selectionRowBackground/);
  assert.match(componentSource, /colors\.selectionTabText/);
  assert.doesNotMatch(exportColorsBlock, /#f4f7fb|#f8fafc|#f0f4f8|#d6dfeb|#dbe3ed|#152033|#4e6078|#52647b|#256da8|#086b53|#8a5a00|#a93545|#d7eee7/i);
});

test("renderer source contains no legacy blue theme accents or old slate selection literals", async () => {
  const legacyPalette = /#(?:1f6feb|0969da|0550ae|0a66c2|c4dcf1|d5e8f8|dfe8f1|e7eef5|7c93a8|5b7894)\b/i;
  const files = await rendererSourceFiles("src/renderer");

  for (const file of files) {
    const source = await readFile(file, "utf8");
    assert.doesNotMatch(source, legacyPalette, `legacy color found in ${file}`);
  }
});

test("encryption and decryption progress cards use the green workbench palette", async () => {
  const source = await readFile("src/renderer/styles.css", "utf8");
  const darkRule = extractCssRule(source, ".app-shell");
  const lightRule = extractCssRule(source, ".app-shell[data-theme=\"light\"]");
  const encryptionCard = extractCssRule(source, ".encryption-progress-card");
  const encryptionBar = extractCssRule(source, ".encryption-progress-bar");
  const encryptionFill = source.match(/^\.encryption-progress-bar span \{[^}]*\}/m)?.[0] ?? "";
  const encryptionStat = extractCssRule(source, ".encryption-stat-grid div");
  const decryptionCard = extractCssRule(source, ".decryption-progress-card");
  const decryptionBar = extractCssRule(source, ".decryption-progress-bar");
  const decryptionFill = source.match(/^\.decryption-progress-bar span \{[^}]*\}/m)?.[0] ?? "";
  const decryptionStat = extractCssRule(source, ".decryption-stat-grid div");

  assert.equal(extractCssToken(darkRule, "progress-card-border"), "rgb(84 192 145 / 28%)");
  assert.equal(extractCssToken(darkRule, "progress-track-background"), "#22384c");
  assert.equal(extractCssToken(darkRule, "progress-percent-text"), "#63ad8e");
  assert.equal(extractCssToken(lightRule, "progress-card-border"), "#a9e5d0");
  assert.equal(extractCssToken(lightRule, "progress-track-background"), "#dbe3ec");
  assert.equal(extractCssToken(lightRule, "progress-percent-text"), "#087f5c");

  for (const rule of [encryptionCard, decryptionCard]) {
    assert.match(rule, /border:\s*1px solid var\(--progress-card-border\)/);
    assert.match(rule, /background:\s*var\(--progress-card-background\)/);
    assert.match(rule, /box-shadow:\s*var\(--progress-card-shadow\)/);
  }
  for (const rule of [encryptionBar, decryptionBar]) {
    assert.match(rule, /height:\s*10px/);
    assert.match(rule, /background:\s*var\(--progress-track-background\)/);
    assert.match(rule, /box-shadow:\s*var\(--progress-track-shadow\)/);
  }
  for (const rule of [encryptionFill, decryptionFill]) {
    assert.match(rule, /background:\s*var\(--progress-fill-background\)/);
    assert.match(rule, /box-shadow:\s*var\(--progress-fill-shadow\)/);
  }
  assert.doesNotMatch(source, /\.encryption-progress-card\.completed \.encryption-progress-bar span\s*\{/);
  assert.doesNotMatch(source, /\.decryption-progress-card\.completed \.decryption-progress-bar span\s*\{/);
  assert.doesNotMatch(source, /\.encryption-progress-card\.completed\s*\{/);
  assert.doesNotMatch(source, /\.decryption-progress-card\.completed\s*\{/);
  assert.doesNotMatch(source, /--progress-completed-(?:background|border|orb)/);
  assert.doesNotMatch(source, /\.(?:encryption|decryption)-progress-bar span::after/);
  for (const rule of [encryptionStat, decryptionStat]) {
    assert.match(rule, /border:\s*1px solid var\(--progress-stat-border\)/);
    assert.match(rule, /background:\s*var\(--progress-stat-background\)/);
  }
});

test("overview config fields use a green-tinted dark surface and a soft light surface", async () => {
  const source = await readFile("src/renderer/styles.css", "utf8");
  const darkRule = extractCssRule(source, ".app-shell");
  const lightRule = extractCssRule(source, ".app-shell[data-theme=\"light\"]");
  const fieldRule = extractCssRule(source, ".proxy-instance-overview-field");
  const inputRule = source.match(/^\.proxy-instance-overview-field \.overview-config-input \{[^}]*\}/m)?.[0] ?? "";

  assert.match(extractCssToken(darkRule, "overview-field-background"), /radial-gradient\([^;]*rgb\(84 192 145 \/ 12%\)/);
  assert.match(extractCssToken(darkRule, "overview-field-background"), /linear-gradient\([^;]*#1b2736/);
  assert.match(extractCssToken(lightRule, "overview-field-background"), /linear-gradient\([^;]*#f7f9fb/);
  assert.match(fieldRule, /background:\s*var\(--overview-field-background\)/);
  assert.match(fieldRule, /box-shadow:\s*var\(--overview-field-shadow\)/);
  assert.match(inputRule, /background:\s*var\(--overview-field-input-background\)/);
});

test("theme text tokens meet reading contrast on actual dark and light backgrounds", async () => {
  const source = await readFile("src/renderer/styles.css", "utf8");
  const themes = [
    { name: "dark", rule: extractCssRule(source, ".app-shell") },
    { name: "light", rule: extractCssRule(source, ".app-shell[data-theme=\"light\"]") },
  ];
  const textTokens = ["text-primary", "text-secondary", "text-tertiary"] as const;
  const hintTokens = ["text-muted", "warning"] as const;
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
    for (const textToken of hintTokens) {
      const foreground = parseCssColor(extractCssToken(theme.rule, textToken));
      for (const backgroundToken of backgroundTokens) {
        const background = compositeColor(parseCssColor(extractCssToken(theme.rule, backgroundToken)), appBackground);
        const ratio = contrastRatio(foreground, background);
        assert.ok(ratio >= 3, `${theme.name} ${textToken} on ${backgroundToken}: ${ratio.toFixed(2)}`);
      }
    }
    const faint = parseCssColor(extractCssToken(theme.rule, "text-subtle"));
    for (const backgroundToken of backgroundTokens) {
      const background = compositeColor(parseCssColor(extractCssToken(theme.rule, backgroundToken)), appBackground);
      const ratio = contrastRatio(faint, background);
      assert.ok(ratio >= 2, `${theme.name} text-subtle on ${backgroundToken}: ${ratio.toFixed(2)}`);
    }
    const accentText = parseCssColor(extractCssToken(theme.rule, "text-on-accent"));
    for (const accentBackgroundToken of ["accent", "accent-hover"]) {
      const accentBackground = parseCssColor(extractCssToken(theme.rule, accentBackgroundToken));
      const ratio = contrastRatio(accentText, accentBackground);
      assert.ok(ratio >= 3, `${theme.name} text-on-accent on ${accentBackgroundToken}: ${ratio.toFixed(2)}`);
    }
    const buttonText = parseCssColor(extractCssToken(theme.rule, "button-primary-text"));
    for (const buttonBackgroundToken of ["button-primary-background", "button-primary-hover"]) {
      const buttonBackground = parseCssColor(extractCssToken(theme.rule, buttonBackgroundToken));
      const ratio = contrastRatio(buttonText, buttonBackground);
      assert.ok(ratio >= 4.5, `${theme.name} button-primary-text on ${buttonBackgroundToken}: ${ratio.toFixed(2)}`);
    }
  }
});

test("AppearancePage structure and theme CSS interactions stay accessible and responsive", async () => {
  const [componentSource, styleSource] = await Promise.all([
    readFile("src/renderer/components/AppearancePage.tsx", "utf8"),
    readFile("src/renderer/styles.css", "utf8"),
  ]);
  const modes = [...componentSource.matchAll(/\{ mode: "(system|light|dark)"/g)].map((match) => match[1]);
  const gridRule = extractCssRule(styleSource, ".lf-theme-grid");

  assert.deepEqual(modes, ["light", "dark", "system"]);
  assert.match(componentSource, /themeOptions\.map\(\(option\) => <button/);
  assert.match(componentSource, /type="button"/);
  assert.match(componentSource, /className=\{`lf-theme-card/);
  assert.match(componentSource, /data-theme-option=\{option\.mode\}/);
  assert.match(componentSource, /aria-pressed=\{mode === option\.mode\}/);
  assert.match(componentSource, /onClick=\{\(\) => onModeChange\(option\.mode\)\}/);
  assert.match(componentSource, /className="lf-theme-grid" role="group" aria-label="主题"/);
  assert.match(componentSource, /mode === option\.mode && <span className="lf-theme-check"/);

  assert.match(gridRule, /grid-template-columns:\s*repeat\(3,/);
  for (const mode of ["system", "dark"]) {
    assert.match(styleSource, new RegExp(`\\.lf-theme-card\\[data-theme-option="${mode}"\\] \\.lf-theme-preview`));
  }
  assert.match(styleSource, /\.lf-theme-preview\s*\{[^}]*background:\s*#f4f7fa/s);
  assert.doesNotMatch(styleSource, /\.lf-theme-card:nth-child\(/);
  assert.match(styleSource, /\.lf-theme-card:hover\s*\{/);
  assert.match(styleSource, /\.lf-theme-card\.active\s*\{[^}]*border-color:\s*var\(--accent\)/s);
  assert.match(styleSource, /\.lf-theme-preview::before\s*\{[^}]*border-right:/s);
  assert.match(styleSource, /\.lf-theme-preview::after\s*\{[^}]*background:/s);
  assert.doesNotMatch(styleSource, /\.lf-theme-preview\s*\{[^}]*!important/);
  assert.match(styleSource, /@media \(max-width: 820px\) \{[\s\S]*?\.lf-theme-grid \{[^}]*grid-template-columns:\s*1fr/s);
  assert.match(styleSource, /\.lf-theme-check\s*\{[^}]*color:\s*var\(--accent\)/s);
  assert.match(styleSource, /\.lf-theme-copy strong\s*\{[^}]*color:\s*var\(--text-primary\)/s);
  assert.match(styleSource, /\.lf-settings-panel\s*\{[^}]*padding:\s*14px/s);
  assert.match(styleSource, /\.lf-app button:focus-visible,[\s\S]*?outline:\s*2px solid var\(--accent\)/s);
});
