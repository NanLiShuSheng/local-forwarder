import { useEffect, useState } from "react";
import { readThemeMode, resolveTheme, writeThemeMode, type ResolvedTheme, type ThemeMode, type ThemeStorage } from "./theme";

const SYSTEM_THEME_QUERY = "(prefers-color-scheme: dark)";

export function getSystemThemeQuery(): MediaQueryList | undefined {
  if (typeof window === "undefined") return undefined;

  try {
    if (typeof window.matchMedia !== "function") return undefined;
    return window.matchMedia(SYSTEM_THEME_QUERY);
  } catch {
    return undefined;
  }
}

function getThemeStorage(): ThemeStorage | undefined {
  if (typeof window === "undefined") return undefined;

  try {
    const storage = window.localStorage;
    if (storage === undefined) return undefined;
    return {
      getItem: (key) => {
        try {
          return storage.getItem(key);
        } catch {
          return null;
        }
      },
      setItem: (key, value) => {
        try {
          storage.setItem(key, value);
        } catch {
          // Theme persistence is best effort in restricted browser contexts.
        }
      },
    };
  } catch {
    return undefined;
  }
}

export function readSystemIsDark(): boolean {
  try {
    return getSystemThemeQuery()?.matches ?? true;
  } catch {
    return true;
  }
}

export function subscribeToSystemTheme(onChange: (isDark: boolean) => void): (() => void) | undefined {
  const mediaQuery = getSystemThemeQuery();
  if (!mediaQuery) return undefined;

  const handleChange = (event: MediaQueryListEvent) => onChange(event.matches);
  try {
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handleChange);
      return () => {
        try {
          mediaQuery.removeEventListener("change", handleChange);
        } catch {
          // Media query cleanup is best effort in restricted browser contexts.
        }
      };
    }
    if (typeof mediaQuery.addListener === "function") {
      mediaQuery.addListener(handleChange);
      return () => {
        try {
          mediaQuery.removeListener(handleChange);
        } catch {
          // Media query cleanup is best effort in restricted browser contexts.
        }
      };
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export interface UseThemeResult {
  mode: ThemeMode;
  theme: ResolvedTheme;
  setMode: (nextMode: ThemeMode) => void;
}

export function useTheme(): UseThemeResult {
  const [mode, setModeState] = useState<ThemeMode>(() => readThemeMode(getThemeStorage()));
  const [systemIsDark, setSystemIsDark] = useState(readSystemIsDark);

  useEffect(() => subscribeToSystemTheme((isDark) => setSystemIsDark(isDark)), []);

  const setMode = (nextMode: ThemeMode) => {
    setModeState(nextMode);
    writeThemeMode(getThemeStorage(), nextMode);
  };

  return { mode, theme: resolveTheme(mode, systemIsDark), setMode };
}
