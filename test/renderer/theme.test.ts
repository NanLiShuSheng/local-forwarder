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

function storageWithValue(value: string | null): ThemeStorage {
  return {
    getItem: () => value,
    setItem: () => undefined,
  };
}

test("readThemeMode returns system when the stored value is missing", () => {
  assert.equal(readThemeMode(storageWithValue(null)), "system");
});

test("readThemeMode returns system when the stored value is invalid", () => {
  assert.equal(readThemeMode(storageWithValue("sepia")), "system");
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

test("writeThemeMode stores the mode under the theme storage key", () => {
  const writes: Array<[string, string]> = [];
  const storage: ThemeStorage = {
    getItem: () => null,
    setItem: (key, value) => writes.push([key, value]),
  };

  writeThemeMode(storage, "dark");

  assert.equal(THEME_STORAGE_KEY, "local-forwarder.theme-mode");
  assert.deepEqual(writes, [["local-forwarder.theme-mode", "dark"]]);
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
