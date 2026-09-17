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
const REQUEST_LINE_PATTERN = /^\S+\s+(\S+)(?:\s+HTTP\/\S+)?$/;

function parseRequestPath(value: string | undefined): string | undefined {
  if (!value) return undefined;

  const firstLine = value.split(/\r?\n/, 1)[0]?.trim() ?? "";
  const match = REQUEST_LINE_PATTERN.exec(firstLine);
  const target = match?.[1];
  if (!target || target === "*") return undefined;

  try {
    return new URL(target, URL_BASE).pathname;
  } catch {
    return undefined;
  }
}

export function getLogType(entry: LogTypeSource): string | undefined {
  const requestPath = entry.requestPath?.trim();
  if (requestPath) return requestPath;

  return parseRequestPath(entry.requestParams) ?? parseRequestPath(entry.message);
}

export function getLogTypeOptions(logs: readonly LogTypeSource[]): string[] {
  const options = [...FIXED_LOG_TYPES];
  const seen = new Set<string>(options);

  for (const log of logs) {
    const type = getLogType(log);
    if (type !== undefined && !seen.has(type)) {
      seen.add(type);
      options.push(type);
    }
  }

  return options;
}

export function matchesLogType(entry: LogTypeSource, selectedType: string): boolean {
  return selectedType === ALL_LOG_TYPES || getLogType(entry) === selectedType;
}
