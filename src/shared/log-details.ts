export interface LogKeyValue {
  key: string;
  value: string;
}

export interface ParsedLogRequest {
  method: string;
  path: string;
  query: LogKeyValue[];
  body: LogKeyValue[];
  rawBody?: string;
}

const URL_BASE = "http://local-forwarder.invalid";

function toLogKeyValues(params: URLSearchParams): LogKeyValue[] {
  return Array.from(params, ([key, value]) => ({ key, value }));
}

export function parseLogRequestParams(raw: string): ParsedLogRequest {
  const requestLine = raw.split(/\r?\n/, 1)[0].trim();
  const [method = "", target = ""] = requestLine.split(/\s+/);
  const requestUrl = new URL(target, URL_BASE);
  const separator = /\r?\n\r?\n/.exec(raw);
  const rawBody = separator === null || separator.index === undefined
    ? ""
    : raw.slice(separator.index + separator[0].length);
  const body = rawBody.includes("=")
    ? toLogKeyValues(new URLSearchParams(rawBody))
    : [];

  return {
    method,
    path: requestUrl.pathname,
    query: toLogKeyValues(requestUrl.searchParams),
    body,
    ...(body.length === 0 && rawBody.length > 0 ? { rawBody } : {}),
  };
}
