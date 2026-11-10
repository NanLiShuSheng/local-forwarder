export type LocalCacheFilter = "all" | "value" | "empty" | "json";
export type LocalCacheValueKind = "empty" | "text" | "json-object" | "json-array";

export interface LocalCacheEntry {
  key: string;
  value: string;
  kind: LocalCacheValueKind;
  label: string;
  formatted: string;
  formattedLines: number;
  preview: string;
  chars: number;
  isJson: boolean;
  isLong: boolean;
}

export interface LocalCacheSummary {
  total: number;
  nonEmpty: number;
  empty: number;
  json: number;
  long: number;
}

const LONG_VALUE_THRESHOLD = 2000;
const PREVIEW_LENGTH = 96;

function previewValue(value: string): string {
  if (value.length === 0) return "空值";
  const singleLine = value.replace(/\s+/g, " ").trim();
  return singleLine.length > PREVIEW_LENGTH ? `${singleLine.slice(0, PREVIEW_LENGTH)}…` : singleLine;
}

function parseJsonContainer(value: string): unknown | undefined {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return undefined;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return parsed !== null && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function describeLocalCacheEntry(key: string, value: string): LocalCacheEntry {
  const parsed = parseJsonContainer(value);
  if (parsed !== undefined) {
    const formatted = JSON.stringify(parsed, null, 2);
    const kind = Array.isArray(parsed) ? "json-array" : "json-object";
    return {
      key,
      value,
      kind,
      label: kind === "json-array" ? "JSON 数组" : "JSON 对象",
      formatted,
      formattedLines: formatted.split("\n").length,
      preview: previewValue(value),
      chars: value.length,
      isJson: true,
      isLong: value.length >= LONG_VALUE_THRESHOLD,
    };
  }

  const kind = value.length === 0 ? "empty" : "text";
  return {
    key,
    value,
    kind,
    label: kind === "empty" ? "空值" : "文本",
    formatted: value,
    formattedLines: value.split("\n").length,
    preview: previewValue(value),
    chars: value.length,
    isJson: false,
    isLong: value.length >= LONG_VALUE_THRESHOLD,
  };
}

export function filterLocalCacheEntries(values: Record<string, string>, query: string, filter: LocalCacheFilter): LocalCacheEntry[] {
  const wanted = query.trim().toLocaleLowerCase();
  return Object.entries(values)
    .map(([key, value]) => describeLocalCacheEntry(key, value))
    .filter((entry) => {
      if (filter === "value" && entry.chars === 0) return false;
      if (filter === "empty" && entry.kind !== "empty") return false;
      if (filter === "json" && !entry.isJson) return false;
      if (wanted === "") return true;
      return entry.key.toLocaleLowerCase().includes(wanted) || entry.value.toLocaleLowerCase().includes(wanted);
    });
}

export function localCacheStats(values: Record<string, string>): LocalCacheSummary {
  let nonEmpty = 0;
  let json = 0;
  let long = 0;
  for (const value of Object.values(values)) {
    if (value.length > 0) nonEmpty += 1;
    const entry = describeLocalCacheEntry("", value);
    if (entry.isJson) json += 1;
    if (entry.isLong) long += 1;
  }
  const total = Object.keys(values).length;
  return { total, nonEmpty, empty: total - nonEmpty, json, long };
}

export function formatLocalCacheCharCount(count: number): string {
  if (count < 1000) return String(count);
  return `${(count / 1000).toFixed(1).replace(/\.0$/, "")}k`;
}

export function localCacheTypeBadge(entry: LocalCacheEntry): { label: string; className: string } {
  if (entry.kind === "empty") return { label: "空", className: "empty" };
  if (entry.isLong) return { label: "超长", className: "long" };
  if (entry.isJson) return { label: "JSON", className: "json" };
  return { label: "文本", className: "text" };
}
