export const DISMISSED_UPDATE_VERSION_STORAGE_KEY = "local-forwarder.dismissed-update-version.v1";

interface ParsedUpdateVersion {
  core: number[];
  prerelease?: string[];
}

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

function parseUpdateVersion(value: string): ParsedUpdateVersion | undefined {
  const normalized = value.trim().replace(/^v/i, "").split("+", 1)[0] ?? "";
  const separator = normalized.indexOf("-");
  const coreText = separator === -1 ? normalized : normalized.slice(0, separator);
  const prereleaseText = separator === -1 ? undefined : normalized.slice(separator + 1);
  const core = coreText.split(".");
  if (core.some((part) => !/^\d+$/.test(part))) return undefined;
  const prerelease = prereleaseText?.split(".");
  if (prerelease?.some((part) => part.length === 0 || !/^[0-9A-Za-z-]+$/.test(part))) return undefined;
  return { core: core.map(Number), prerelease };
}

export function compareUpdateVersions(candidate: string, baseline: string): number | undefined {
  const left = parseUpdateVersion(candidate);
  const right = parseUpdateVersion(baseline);
  if (left === undefined || right === undefined) return undefined;

  const coreLength = Math.max(left.core.length, right.core.length);
  for (let index = 0; index < coreLength; index += 1) {
    const difference = (left.core[index] ?? 0) - (right.core[index] ?? 0);
    if (difference !== 0) return difference;
  }

  if (left.prerelease === undefined) return right.prerelease === undefined ? 0 : 1;
  if (right.prerelease === undefined) return -1;
  const prereleaseLength = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < prereleaseLength; index += 1) {
    const leftPart = left.prerelease[index];
    const rightPart = right.prerelease[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    const leftNumeric = /^\d+$/.test(leftPart);
    const rightNumeric = /^\d+$/.test(rightPart);
    if (leftNumeric && rightNumeric) {
      const difference = Number(leftPart) - Number(rightPart);
      if (difference !== 0) return difference;
      continue;
    }
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    if (leftPart !== rightPart) return leftPart < rightPart ? -1 : 1;
  }
  return 0;
}

export function isUpdateVersionNewer(candidate: string, dismissedVersion: string | undefined): boolean {
  if (dismissedVersion === undefined) return true;
  const comparison = compareUpdateVersions(candidate, dismissedVersion);
  return comparison === undefined ? candidate.trim() !== dismissedVersion.trim() : comparison > 0;
}
