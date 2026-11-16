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
const URL_ENCODED_COMPONENT = /^(?:[A-Za-z0-9*._~+\-]|%[0-9A-Fa-f]{2})*$/;
const ENCODED_PLACEHOLDER = /^\([^()]*%[0-9A-Fa-f]{2}[^()]*\)$/;

function toLogKeyValues(params: URLSearchParams): LogKeyValue[] {
  return Array.from(params, ([key, value]) => ({ key, value }));
}

function decodeFormComponent(raw: string): string {
  if (ENCODED_PLACEHOLDER.test(raw)) return raw;
  try {
    return decodeURIComponent(raw.replace(/\+/g, " "));
  } catch {
    return raw;
  }
}

function toFormKeyValues(rawBody: string): LogKeyValue[] {
  return rawBody.split("&").filter((part) => part !== "").map((part) => {
    const separator = part.indexOf("=");
    return {
      key: decodeFormComponent(part.slice(0, separator)),
      value: decodeFormComponent(part.slice(separator + 1)),
    };
  });
}

function isUrlEncodedFormBody(rawBody: string): boolean {
  const parts = rawBody.split("&").filter((part) => part !== "");
  return parts.length > 0 && parts.every((part) => {
    const separator = part.indexOf("=");
    if (separator <= 0) return false;
    return URL_ENCODED_COMPONENT.test(part.slice(0, separator));
  });
}

export function parseLogRequestParams(raw: string): ParsedLogRequest {
  const requestLine = raw.split(/\r?\n/, 1)[0].trim();
  const [method = "", target = ""] = requestLine.split(/\s+/);
  let path = "/";
  let query: LogKeyValue[] = [];
  if (target !== "") {
    try {
      const requestUrl = new URL(target, URL_BASE);
      path = requestUrl.pathname;
      query = toLogKeyValues(requestUrl.searchParams);
    } catch {
      // Keep malformed request logs inspectable without aborting the parser.
    }
  }
  const separator = /\r?\n\r?\n/.exec(raw);
  const rawBody = separator === null || separator.index === undefined
    ? ""
    : raw.slice(separator.index + separator[0].length);
  const body = isUrlEncodedFormBody(rawBody) ? toFormKeyValues(rawBody) : [];

  return {
    method,
    path,
    query,
    body,
    ...(body.length === 0 && rawBody.length > 0 ? { rawBody } : {}),
  };
}

const REQXML_PATH_PATTERN = /(?:^|\/)reqxml$/i;
const REQUEST_LINE_PATTERN = /^([A-Z][A-Z0-9-]*)\s+(\S+)$/;

function lastParamValue(entries: readonly LogKeyValue[], key: string): string | undefined {
  const normalized = key.toLowerCase();
  let found: string | undefined;
  for (const entry of entries) {
    if (entry.key.toLowerCase() === normalized) found = entry.value;
  }
  return found;
}

export function formatLogRequestLabel(message: string, requestParams?: string): string {
  const requestLine = message.split(/\r?\n/, 1)[0]?.trim() ?? "";
  const match = REQUEST_LINE_PATTERN.exec(requestLine);
  if (match === null) return message;
  const [, method, target] = match;
  const parsed = parseLogRequestParams(requestParams === undefined || requestParams.trim() === "" ? `${method} ${target}` : requestParams);
  if (!REQXML_PATH_PATTERN.test(parsed.path)) return message;
  const action = (lastParamValue(parsed.body, "action") ?? lastParamValue(parsed.query, "action"))?.trim();
  if (action === undefined || action === "") return message;
  const serviceId = (lastParamValue(parsed.body, "serviceId") ?? lastParamValue(parsed.query, "serviceId"))?.trim();
  const segments = [parsed.path, action];
  if (serviceId !== undefined && serviceId !== "") segments.push(serviceId);
  return `${method} ${segments.join("/")}`;
}
