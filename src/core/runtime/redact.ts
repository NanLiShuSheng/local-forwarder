const SENSITIVE_KEYS = new Set([
  "password",
  "token",
  "mobile",
  "account",
  "secret",
  "authorization",
]);

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key.toLowerCase());
}

function copyAndRedact(value: unknown, seen: WeakMap<object, unknown>): unknown {
  if (value === null || typeof value !== "object") return value;
  const existing = seen.get(value);
  if (existing !== undefined) return existing;

  if (Array.isArray(value)) {
    const output: unknown[] = [];
    seen.set(value, output);
    for (const entry of value) output.push(copyAndRedact(entry, seen));
    return output;
  }

  const output: Record<string, unknown> = {};
  seen.set(value, output);
  for (const [key, entry] of Object.entries(value)) {
    output[key] = isSensitiveKey(key) ? "***" : copyAndRedact(entry, seen);
  }
  return output;
}

export function redactObject(value: unknown): unknown {
  return copyAndRedact(value, new WeakMap<object, unknown>());
}

export function redactQuery(url: string): string {
  try {
    new URL(url);
  } catch {
    if (!url.startsWith("/")) return url;
  }

  const queryStart = url.indexOf("?");
  const hashStart = url.indexOf("#");
  if (queryStart < 0 || (hashStart >= 0 && hashStart < queryStart)) return url;
  const queryEnd = hashStart < 0 ? url.length : hashStart;
  const query = url.slice(queryStart + 1, queryEnd);
  const redactedQuery = query.split("&").map((part) => {
    const separator = part.indexOf("=");
    if (separator < 0) return part;
    const rawName = part.slice(0, separator);
    let name: string;
    try {
      name = decodeURIComponent(rawName.replace(/\+/g, " "));
    } catch {
      return part;
    }
    return isSensitiveKey(name) ? `${rawName}=***` : part;
  }).join("&");

  return `${url.slice(0, queryStart + 1)}${redactedQuery}${url.slice(queryEnd)}`;
}
