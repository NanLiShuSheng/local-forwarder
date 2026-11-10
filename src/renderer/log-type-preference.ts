export const DEFAULT_LOG_TYPE = "/reqxml" as const;
export const LOG_TYPE_STORAGE_KEY = "local-forwarder.log-type";
export type LogRequestView = "source" | "parsed";
export const DEFAULT_LOG_REQUEST_VIEW: LogRequestView = "source";
export const LOG_REQUEST_VIEW_STORAGE_KEY = "local-forwarder.log-request-view";

export interface LogTypeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function getLogTypeStorage(): LogTypeStorage | undefined {
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
          // localStorage is optional in restricted browser contexts.
        }
      },
    };
  } catch {
    return undefined;
  }
}

export function readLogType(storage: LogTypeStorage | undefined): string {
  try {
    const value = storage?.getItem(LOG_TYPE_STORAGE_KEY)?.trim();
    return value || DEFAULT_LOG_TYPE;
  } catch {
    return DEFAULT_LOG_TYPE;
  }
}

export function writeLogType(storage: LogTypeStorage | undefined, value: string): void {
  try {
    storage?.setItem(LOG_TYPE_STORAGE_KEY, value);
  } catch {
    // Persistence is best effort and must not block log filtering.
  }
}

export function readLogRequestView(storage: LogTypeStorage | undefined): LogRequestView {
  try {
    const value = storage?.getItem(LOG_REQUEST_VIEW_STORAGE_KEY)?.trim();
    return value === "parsed" || value === "source" ? value : DEFAULT_LOG_REQUEST_VIEW;
  } catch {
    return DEFAULT_LOG_REQUEST_VIEW;
  }
}

export function writeLogRequestView(storage: LogTypeStorage | undefined, value: LogRequestView): void {
  try {
    storage?.setItem(LOG_REQUEST_VIEW_STORAGE_KEY, value);
  } catch {
    // Persistence is best effort and must not block viewing logs.
  }
}

export function persistLogRequestView(
  nextView: LogRequestView,
  storage: LogTypeStorage | undefined,
  setRequestView: (nextView: LogRequestView) => void,
): void {
  setRequestView(nextView);
  writeLogRequestView(storage, nextView);
}
