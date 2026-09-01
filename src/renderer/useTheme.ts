import { useEffect, useState } from "react";
import { readThemeMode, resolveTheme, writeThemeMode, type ResolvedTheme, type ThemeMode, type ThemeStorage } from "./theme";

const SYSTEM_THEME_QUERY = "(prefers-color-scheme: dark)";

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

function readSystemIsDark(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;

  try {
    return window.matchMedia(SYSTEM_THEME_QUERY).matches;
  } catch {
    return true;
  }
}

export interface UseThemeResult {
  mode: ThemeMode;
  theme: ResolvedTheme;
  setMode: (nextMode: ThemeMode) => void;
}

export function useTheme(): UseThemeResult {
  const [mode, setModeState] = useState<ThemeMode>(() => readThemeMode(getThemeStorage()));
  const [systemIsDark, setSystemIsDark] = useState(readSystemIsDark);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;

    let mediaQuery: MediaQueryList;
    try {
      mediaQuery = window.matchMedia(SYSTEM_THEME_QUERY);
    } catch {
      return undefined;
    }

    const handleChange = (event: MediaQueryListEvent) => setSystemIsDark(event.matches);
    if (typeof mediaQuery.addEventListener !== "function") return undefined;
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  const setMode = (nextMode: ThemeMode) => {
    setModeState(nextMode);
    writeThemeMode(getThemeStorage(), nextMode);
  };

  return { mode, theme: resolveTheme(mode, systemIsDark), setMode };
}
