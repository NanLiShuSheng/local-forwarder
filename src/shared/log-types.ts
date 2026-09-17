export const ALL_LOG_TYPES = "all" as const;

export const FIXED_LOG_TYPES = [
  "/reqxml",
  "/reqreadmap",
  "/reqlocal",
  "/reqsavemap",
  "/reqsavefile",
  "/reqreadfile",
  "/login",
] as const;

export interface LogTypeSource {
  requestPath?: string;
  requestParams?: string;
  message?: string;
}

const URL_BASE = "http://local-forwarder.invalid";
const REQUEST_LINE_PATTERN = /^[A-Z][A-Z0-9-]*\s+(\S+)(?:\s+HTTP\/\S+)?$/;
const URL_SCHEME_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const ABSOLUTE_URL_PATTERN = /^https?:\/\//i;

function normalizeRequestPath(value: string | undefined): string | undefined {
  const candidate = value?.trim();
  if (!candidate || candidate === ALL_LOG_TYPES || candidate === "*") return undefined;
  if (URL_SCHEME_PATTERN.test(candidate) && !ABSOLUTE_URL_PATTERN.test(candidate)) return undefined;

  try {
    return new URL(candidate, URL_BASE).pathname;
  } catch {
    return undefined;
  }
}

function parseRequestPath(value: string | undefined): string | undefined {
  if (!value) return undefined;

  const firstLine = value.split(/\r?\n/, 1)[0]?.trim() ?? "";
  const match = REQUEST_LINE_PATTERN.exec(firstLine);
  const target = match?.[1];
  if (!target || target === "*" || (URL_SCHEME_PATTERN.test(target) && !ABSOLUTE_URL_PATTERN.test(target))) return undefined;

  try {
    return new URL(target, URL_BASE).pathname;
  } catch {
    return undefined;
  }
}

export function getLogType(entry: LogTypeSource): string | undefined {
  const requestPath = entry.requestPath?.trim();
  if (requestPath) return normalizeRequestPath(requestPath);

  return parseRequestPath(entry.requestParams) ?? parseRequestPath(entry.message);
}

export function getLogTypeOptions(logs: readonly LogTypeSource[]): string[] {
  const options: string[] = [...FIXED_LOG_TYPES];
  const seen = new Set<string>(options);

  for (const log of logs) {
    const type = getLogType(log);
    if (type !== undefined && type !== ALL_LOG_TYPES && !seen.has(type)) {
      seen.add(type);
      options.push(type);
    }
  }

  return options;
}

export function matchesLogType(entry: LogTypeSource, selectedType: string): boolean {
  return selectedType === ALL_LOG_TYPES || getLogType(entry) === selectedType;
}
