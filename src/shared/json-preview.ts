export type JsonPreviewValue = null | boolean | number | string | JsonPreviewValue[] | { [key: string]: JsonPreviewValue };
export type JsonPreviewType = "object" | "array" | "string" | "number" | "boolean" | "null";

export interface JsonPreviewRow {
  path: string;
  key: string;
  value: JsonPreviewValue;
  type: JsonPreviewType;
  depth: number;
}

export interface PipeDelimitedArrayPreview {
  headers: string[];
  rows: string[][];
}

export type JsonPreviewParseResult =
  | { ok: true; value: JsonPreviewValue; formatted: string; source: "json" | "escaped-json"; rootType: JsonPreviewType }
  | { ok: false; error: string };

function isJsonObject(value: unknown): value is { [key: string]: JsonPreviewValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonValue(value: unknown): value is JsonPreviewValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isJsonObject(value) && Object.values(value).every(isJsonValue);
}

export function jsonPreviewType(value: JsonPreviewValue): JsonPreviewType {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  return typeof value as "string" | "number" | "boolean";
}

export function parsePipeDelimitedArray(value: JsonPreviewValue): PipeDelimitedArrayPreview | undefined {
  if (!Array.isArray(value) || value.length === 0 || !value.every((item): item is string => typeof item === "string" && item.includes("|"))) return undefined;
  const splitRows = value.map((item) => item.split("|"));
  const columnCount = Math.max(...splitRows.map((row) => row.length));
  const alignRow = (row: string[]) => Array.from({ length: columnCount }, (_, index) => row[index] ?? "");
  return { headers: alignRow(splitRows[0]), rows: splitRows.slice(1).map(alignRow) };
}

function parseJsonValue(text: string): JsonPreviewValue {
  const value: unknown = JSON.parse(text);
  if (!isJsonValue(value)) throw new Error("只支持标准 JSON 数据");
  return value;
}

function isJsonContainer(value: JsonPreviewValue): value is JsonPreviewValue[] | { [key: string]: JsonPreviewValue } {
  return Array.isArray(value) || isJsonObject(value);
}

function parseNestedJsonString(text: string): JsonPreviewValue | undefined {
  const trimmed = text.trim();
  const looksLikeContainer = (trimmed.startsWith("{") && trimmed.endsWith("}"))
    || (trimmed.startsWith("[") && trimmed.endsWith("]"));
  if (!looksLikeContainer) return undefined;

  try {
    const nestedValue = parseJsonValue(trimmed);
    return isJsonContainer(nestedValue) ? normalizeNestedJsonStrings(nestedValue) : undefined;
  } catch {
    return undefined;
  }
}

function normalizeNestedJsonStrings(value: JsonPreviewValue): JsonPreviewValue {
  if (typeof value === "string") return parseNestedJsonString(value) ?? value;
  if (Array.isArray(value)) return value.map(normalizeNestedJsonStrings);
  if (isJsonObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, normalizeNestedJsonStrings(child)]));
  }
  return value;
}

export function parseJsonPreviewText(input: string): JsonPreviewParseResult {
  const text = input.trim();
  if (text === "") return { ok: false, error: "请输入 JSON 数据" };

  try {
    const firstValue = parseJsonValue(text);
    if (typeof firstValue === "string") {
      try {
        const nestedValue = parseJsonValue(firstValue);
        const normalizedValue = normalizeNestedJsonStrings(nestedValue);
        return { ok: true, value: normalizedValue, formatted: JSON.stringify(normalizedValue, null, 2), source: "escaped-json", rootType: jsonPreviewType(normalizedValue) };
      } catch {
        return { ok: true, value: firstValue, formatted: JSON.stringify(firstValue, null, 2), source: "json", rootType: "string" };
      }
    }
    const normalizedValue = normalizeNestedJsonStrings(firstValue);
    return { ok: true, value: normalizedValue, formatted: JSON.stringify(normalizedValue, null, 2), source: "json", rootType: jsonPreviewType(normalizedValue) };
  } catch (firstError) {
    if (text.includes('\\"')) {
      try {
        const unescaped = text.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
        const value = normalizeNestedJsonStrings(parseJsonValue(unescaped));
        return { ok: true, value, formatted: JSON.stringify(value, null, 2), source: "escaped-json", rootType: jsonPreviewType(value) };
      } catch {
        // Fall through to the original parser error so malformed input remains actionable.
      }
    }
    const message = firstError instanceof Error ? firstError.message : "格式不正确";
    return { ok: false, error: `JSON 解析失败：${message}` };
  }
}

function propertyPath(parentPath: string, key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `${parentPath}.${key}` : `${parentPath}[${JSON.stringify(key)}]`;
}

function childRows(value: JsonPreviewValue, path: string, depth: number): JsonPreviewRow[] {
  if (Array.isArray(value)) {
    return value.flatMap((child, index) => {
      const childPath = `${path}[${index}]`;
      const row: JsonPreviewRow = { path: childPath, key: `[${index}]`, value: child, type: jsonPreviewType(child), depth };
      return [row, ...childRows(child, childPath, depth + 1)];
    });
  }
  if (isJsonObject(value)) {
    return Object.entries(value).flatMap(([key, child]) => {
      const childPath = propertyPath(path, key);
      const row: JsonPreviewRow = { path: childPath, key, value: child, type: jsonPreviewType(child), depth };
      return [row, ...childRows(child, childPath, depth + 1)];
    });
  }
  return [];
}

export function flattenJsonValue(value: JsonPreviewValue, path = "$", depth = 0): JsonPreviewRow[] {
  if (!Array.isArray(value) && !isJsonObject(value)) {
    return [{ path, key: path, value, type: jsonPreviewType(value), depth }];
  }
  return childRows(value, path, depth);
}
