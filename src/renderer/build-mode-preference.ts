import type { EncryptionMode } from "../shared/contracts";

export const DEFAULT_BUILD_ENCRYPTION_MODE: EncryptionMode = "full";
export const BUILD_ENCRYPTION_MODE_STORAGE_KEY = "local-forwarder.build-encryption-mode";

export interface BuildModeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function getBuildModeStorage(): BuildModeStorage | undefined {
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
          // Persistence is optional in restricted browser contexts.
        }
      },
    };
  } catch {
    return undefined;
  }
}

export function readBuildEncryptionMode(storage: BuildModeStorage | undefined): EncryptionMode {
  try {
    const value = storage?.getItem(BUILD_ENCRYPTION_MODE_STORAGE_KEY)?.trim();
    return value === "full" || value === "incremental" ? value : DEFAULT_BUILD_ENCRYPTION_MODE;
  } catch {
    return DEFAULT_BUILD_ENCRYPTION_MODE;
  }
}

export function writeBuildEncryptionMode(storage: BuildModeStorage | undefined, mode: EncryptionMode): void {
  try {
    storage?.setItem(BUILD_ENCRYPTION_MODE_STORAGE_KEY, mode);
  } catch {
    // The selected mode still applies for the current session.
  }
}
