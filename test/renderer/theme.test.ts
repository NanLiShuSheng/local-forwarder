import assert from "node:assert/strict";
import test from "node:test";
import {
  THEME_STORAGE_KEY,
  isThemeMode,
  readThemeMode,
  resolveTheme,
  writeThemeMode,
  type ThemeStorage,
} from "../../src/renderer/theme";

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
