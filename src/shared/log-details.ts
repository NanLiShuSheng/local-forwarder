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

function toLogKeyValues(params: URLSearchParams): LogKeyValue[] {
  return Array.from(params, ([key, value]) => ({ key, value }));
}

function isUrlEncodedFormBody(rawBody: string): boolean {
  return rawBody.split("&").every((part) => {
    const separator = part.indexOf("=");
    if (separator <= 0) return false;
    return URL_ENCODED_COMPONENT.test(part.slice(0, separator))
      && URL_ENCODED_COMPONENT.test(part.slice(separator + 1));
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
  const body = isUrlEncodedFormBody(rawBody)
    ? toLogKeyValues(new URLSearchParams(rawBody))
    : [];

  return {
    method,
    path,
    query,
    body,
    ...(body.length === 0 && rawBody.length > 0 ? { rawBody } : {}),
  };
}
