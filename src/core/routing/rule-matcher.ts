import type { ForwardRule } from "../../shared/contracts";

export interface ParsedTarget {
  protocol: "http" | "https" | "tcp";
  hostname: string;
  port: number;
  pathname: string;
  search: string;
  hash: string;
  path: string;
  href: string;
  origin: string;
}

const DEFAULT_PORTS = {
  http: 80,
  https: 443,
  tcp: 80,
} as const;

export function matchRule(url: string, rules: readonly ForwardRule[]): ForwardRule | undefined {
  return rules
    .filter((rule) => rule.enabled === true && url.includes(rule.match))
    .sort((left, right) => right.match.length - left.match.length || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))[0];
}

const VARIABLE_PATTERN = /\(\$([A-Za-z0-9_]+)\)|%28\$([A-Za-z0-9_]+)%29|%28%24([A-Za-z0-9_]+)%29/g;

export function substituteVariables(input: string, localValues: Record<string, string>): string {
  const values = new Map<string, string>();
  for (const [key, value] of Object.entries(localValues)) {
    const normalizedKey = key.toLowerCase();
    if (!values.has(normalizedKey)) values.set(normalizedKey, value);
  }

  return input.replace(VARIABLE_PATTERN, (placeholder, plainKey: string | undefined, encodedKey: string | undefined, fullyEncodedKey: string | undefined) => {
    const key = plainKey ?? encodedKey ?? fullyEncodedKey;
    if (key === undefined) return placeholder;
    return values.get(key.toLowerCase()) ?? placeholder;
  });
}

function explicitPort(target: string, protocol: string): string | undefined {
  const authorityStart = protocol.length + 1;
  const remainder = target.slice(authorityStart);
  if (!remainder.startsWith("//")) return undefined;
  const authority = remainder.slice(2).split(/[/?#]/, 1)[0];
  const host = authority.slice(authority.lastIndexOf("@") + 1);
  if (host.startsWith("[")) {
    const closingBracket = host.indexOf("]");
    if (closingBracket >= 0 && host[closingBracket + 1] === ":") return host.slice(closingBracket + 2);
    return undefined;
  }
  const colon = host.lastIndexOf(":");
  return colon >= 0 ? host.slice(colon + 1) : undefined;
}

export function parseTarget(target: string): ParsedTarget {
  const schemeMatch = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(target);
  if (schemeMatch === null) throw new Error(`Invalid target: missing protocol in ${target}`);
  const protocol = schemeMatch[1].toLowerCase();
  if (!(protocol in DEFAULT_PORTS)) throw new Error(`Unsupported protocol: ${protocol}`);
  const authorityRemainder = target.slice(schemeMatch[0].length);
  if (!authorityRemainder.startsWith("//")) throw new Error(`Invalid target: authority is required in ${target}`);
  if (authorityRemainder.startsWith("///")) throw new Error(`Invalid target: host is required in ${target}`);
  const rawPort = explicitPort(target, schemeMatch[1]);
  if (rawPort !== undefined) {
    if (!/^\d+$/.test(rawPort)) throw new Error(`Invalid port in target: ${target}`);
    const numericPort = Number(rawPort);
    if (!Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65535) {
      throw new Error(`Invalid port in target: ${target}`);
    }
  }

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch (error) {
    throw new Error(`Invalid target URL: ${target}`, { cause: error });
  }
  if (parsed.hostname.length === 0) throw new Error(`Invalid target: host is required in ${target}`);

  const normalizedProtocol = protocol as ParsedTarget["protocol"];
  const port = parsed.port === "" ? DEFAULT_PORTS[normalizedProtocol] : Number(parsed.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid port in target: ${target}`);

  return {
    protocol: normalizedProtocol,
    hostname: parsed.hostname,
    port,
    pathname: parsed.pathname,
    search: parsed.search,
    hash: parsed.hash,
    path: `${parsed.pathname}${parsed.search}`,
    href: parsed.href,
    origin: parsed.origin,
  };
}
