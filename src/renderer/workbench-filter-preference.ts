export type WorkbenchInstanceFilter = "all" | "running" | "stopped" | "error";

export const DEFAULT_WORKBENCH_INSTANCE_FILTER: WorkbenchInstanceFilter = "all";
export const WORKBENCH_INSTANCE_FILTER_STORAGE_KEY = "local-forwarder.workbench-instance-filter.v1";

export interface WorkbenchFilterStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function getWorkbenchFilterStorage(): WorkbenchFilterStorage | undefined {
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
          // Filter persistence is optional in restricted browser contexts.
        }
      },
    };
  } catch {
    return undefined;
  }
}

export function readWorkbenchInstanceFilter(storage: WorkbenchFilterStorage | undefined): WorkbenchInstanceFilter {
  try {
    const value = storage?.getItem(WORKBENCH_INSTANCE_FILTER_STORAGE_KEY)?.trim();
    return value === "all" || value === "running" || value === "stopped" || value === "error"
      ? value
      : DEFAULT_WORKBENCH_INSTANCE_FILTER;
  } catch {
    return DEFAULT_WORKBENCH_INSTANCE_FILTER;
  }
}

export function writeWorkbenchInstanceFilter(storage: WorkbenchFilterStorage | undefined, filter: WorkbenchInstanceFilter): void {
  try {
    storage?.setItem(WORKBENCH_INSTANCE_FILTER_STORAGE_KEY, filter);
  } catch {
    // The selected filter still applies for the current session.
  }
}
