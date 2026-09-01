export type ThemeMode = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "local-forwarder.theme-mode";

export interface ThemeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === "system" || value === "light" || value === "dark";
}

export function readThemeMode(storage: ThemeStorage | undefined): ThemeMode {
  try {
    const value = storage?.getItem(THEME_STORAGE_KEY);
    return isThemeMode(value) ? value : "system";
  } catch {
    return "system";
  }
}

export function writeThemeMode(storage: ThemeStorage | undefined, mode: ThemeMode): void {
  try {
    storage?.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // Storage can be unavailable in restricted browser contexts.
  }
}

export function resolveTheme(mode: ThemeMode, systemIsDark: boolean): ResolvedTheme {
  if (mode === "system") {
    return systemIsDark ? "dark" : "light";
  }
  return mode;
}
