export const DISMISSED_UPDATE_VERSION_STORAGE_KEY = "local-forwarder.dismissed-update-version.v1";

export interface UpdateDismissalStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function getUpdateDismissalStorage(): UpdateDismissalStorage | undefined {
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
          // Dismissal persistence is best effort in restricted browser contexts.
        }
      },
    };
  } catch {
    return undefined;
  }
}

export function readDismissedUpdateVersion(storage: UpdateDismissalStorage | undefined): string | undefined {
  try {
    const value = storage?.getItem(DISMISSED_UPDATE_VERSION_STORAGE_KEY)?.trim();
    return value === undefined || value.length === 0 ? undefined : value;
  } catch {
    return undefined;
  }
}

export function writeDismissedUpdateVersion(storage: UpdateDismissalStorage | undefined, version: string): void {
  try {
    storage?.setItem(DISMISSED_UPDATE_VERSION_STORAGE_KEY, version);
  } catch {
    // Dismissal persistence must not block the update card.
  }
}
