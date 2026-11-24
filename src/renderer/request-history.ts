import type { ManualRequestConfig } from "../shared/contracts";
import { parseManualRequestParams } from "../shared/manual-request";

export const REQUEST_HISTORY_STORAGE_KEY = "local-forwarder.request-history";
export const REQUEST_HISTORY_LIMIT = 20;

export interface RequestHistoryEntry {
  sentAt: number;
  request: ManualRequestConfig;
}

export interface RequestHistoryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface RequestHistorySummary {
  address: string;
  action?: string;
  account?: string;
  paramCount: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeRequest(value: unknown): ManualRequestConfig | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.host !== "string" || typeof value.paramsText !== "string") return undefined;
  if (typeof value.port !== "number" || !Number.isInteger(value.port) || value.port < 1 || value.port > 65535) return undefined;
  if (value.transport !== undefined && value.transport !== "tzt" && value.transport !== "http") return undefined;
  return {
    host: value.host.trim(),
    port: value.port,
    paramsText: value.paramsText,
    transport: value.transport === "http" ? "http" : "tzt",
  };
}

function normalizeEntry(value: unknown): RequestHistoryEntry | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.sentAt !== "number" || !Number.isFinite(value.sentAt)) return undefined;
  const request = normalizeRequest(value.request);
  if (request === undefined) return undefined;
  return { sentAt: value.sentAt, request };
}

export function requestHistorySignature(request: ManualRequestConfig): string {
  return [
    request.transport === "http" ? "http" : "tzt",
    request.host.trim(),
    request.port,
    request.paramsText.replace(/\r\n?/g, "\n").trimEnd(),
  ].join("\u0000");
}

function fallbackParamCount(text: string): number {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith(";"))
    .length;
}

function firstParam(params: Record<string, string>, names: string[]): string | undefined {
  for (const [key, value] of Object.entries(params)) {
    if (names.includes(key.toLocaleLowerCase()) && value !== "") return value;
  }
  return undefined;
}

export function requestHistorySummary(request: ManualRequestConfig): RequestHistorySummary {
  const transport = request.transport === "http" ? "http" : "tzt";
  const address = `${transport === "http" ? "http" : "tcp"}://${request.host || "127.0.0.1"}:${request.port}${transport === "http" ? "/reqxml" : ""}`;

  try {
    const params = parseManualRequestParams(request.paramsText);
    return {
      address,
      action: firstParam(params, ["action"]),
      account: firstParam(params, ["account"]),
      paramCount: Object.keys(params).length,
    };
  } catch {
    return { address, paramCount: fallbackParamCount(request.paramsText) };
  }
}

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

function clockTime(date: Date, includeSeconds: boolean): string {
  return `${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}${includeSeconds ? `:${twoDigits(date.getSeconds())}` : ""}`;
}

function sameLocalDay(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate();
}

export function formatRequestHistoryTime(sentAt: number, now = Date.now()): string {
  const date = new Date(sentAt);
  if (Number.isNaN(date.getTime())) return "时间未知";

  const current = new Date(now);
  if (sameLocalDay(date, current)) return clockTime(date, true);

  const yesterday = new Date(current.getFullYear(), current.getMonth(), current.getDate() - 1);
  if (sameLocalDay(date, yesterday)) return `昨天 ${clockTime(date, false)}`;

  const datePart = date.getFullYear() === current.getFullYear()
    ? `${date.getMonth() + 1}月${date.getDate()}日`
    : `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
  return `${datePart} ${clockTime(date, false)}`;
}

function normalizeHistory(entries: RequestHistoryEntry[]): RequestHistoryEntry[] {
  const seen = new Set<string>();
  return [...entries]
    .sort((left, right) => right.sentAt - left.sentAt)
    .filter((entry) => {
      const signature = requestHistorySignature(entry.request);
      if (seen.has(signature)) return false;
      seen.add(signature);
      return true;
    })
    .slice(0, REQUEST_HISTORY_LIMIT);
}

export function getRequestHistoryStorage(): RequestHistoryStorage | undefined {
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

export function readRequestHistory(storage: RequestHistoryStorage | undefined): RequestHistoryEntry[] {
  try {
    const raw = storage?.getItem(REQUEST_HISTORY_STORAGE_KEY);
    if (raw === null || raw === undefined) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return normalizeHistory(parsed.map(normalizeEntry).filter((entry): entry is RequestHistoryEntry => entry !== undefined));
  } catch {
    return [];
  }
}

export function writeRequestHistory(storage: RequestHistoryStorage | undefined, entries: RequestHistoryEntry[]): void {
  try {
    storage?.setItem(REQUEST_HISTORY_STORAGE_KEY, JSON.stringify(normalizeHistory(entries)));
  } catch {
    // The current session still keeps history in memory.
  }
}

export function rememberRequestHistory(entries: RequestHistoryEntry[], request: ManualRequestConfig, sentAt = Date.now()): RequestHistoryEntry[] {
  const normalized = normalizeRequest(request);
  if (normalized === undefined) return normalizeHistory(entries);
  return normalizeHistory([{ sentAt, request: normalized }, ...entries]);
}

export function previousRequestHistoryEntry(entries: RequestHistoryEntry[], current: ManualRequestConfig): RequestHistoryEntry | undefined {
  const currentSignature = requestHistorySignature(current);
  return normalizeHistory(entries).find((entry) => requestHistorySignature(entry.request) !== currentSignature);
}
