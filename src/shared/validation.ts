import type { AppConfig } from "./contracts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): boolean {
  const allowedKeys = new Set([...requiredKeys, ...optionalKeys]);
  const keys = Object.keys(value);
  return (
    requiredKeys.every((key) => Object.prototype.hasOwnProperty.call(value, key)) &&
    keys.every((key) => allowedKeys.has(key))
  );
}

function isLegacyData(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["files", "extra"]) &&
    isRecord(value.files) &&
    isRecord(value.extra)
  );
}

function invalidHttpTargetField(target: string, field: string): string | undefined {
  if (target.length === 0) return field;
  if (!/^https?:\/\//i.test(target)) return undefined;
  try {
    new URL(target);
  } catch {
    return `${field}.port`;
  }
  const authority = /^https?:\/\/([^/?#]*)/i.exec(target)?.[1];
  const hostPort = authority?.slice(authority.lastIndexOf("@") + 1);
  let explicitPort: string | undefined;
  if (hostPort?.startsWith("[")) {
    const closingBracket = hostPort.indexOf("]");
    if (closingBracket >= 0 && hostPort[closingBracket + 1] === ":") {
      explicitPort = hostPort.slice(closingBracket + 2);
    }
  } else {
    const colon = hostPort?.lastIndexOf(":") ?? -1;
    if (colon >= 0) explicitPort = hostPort?.slice(colon + 1);
  }
  if (explicitPort !== undefined && (!/^\d+$/.test(explicitPort) || Number(explicitPort) < 1 || Number(explicitPort) > 65535)) {
    return `${field}.port`;
  }
  return undefined;
}

export function getAppConfigValidationError(value: unknown): string | undefined {
  if (!isRecord(value)) return "root";
  if (!hasOnlyKeys(value, [
    "server",
    "httpRules",
    "tcpTargets",
    "localValues",
    "mapValues",
    "accounts",
    "cache",
  ], ["legacy"])) return "root";

  const server = value.server;
  if (!isRecord(server)) return "server";
  if (!hasOnlyKeys(server, ["bindHost", "port", "timeoutMs", "loggingEnabled"])) return "server";
  if (typeof server.bindHost !== "string" || server.bindHost.length === 0) return "server.bindHost";
  if (typeof server.port !== "number" || !Number.isInteger(server.port) || server.port < 1 || server.port > 65535) return "server.port";
  if (typeof server.timeoutMs !== "number" || !Number.isInteger(server.timeoutMs) || server.timeoutMs < 0) return "server.timeoutMs";
  if (typeof server.loggingEnabled !== "boolean") return "server.loggingEnabled";

  if (!Array.isArray(value.httpRules)) return "httpRules";
  for (const [index, rule] of value.httpRules.entries()) {
    const prefix = `httpRules[${index}]`;
    if (!isRecord(rule)) return prefix;
    if (!hasOnlyKeys(rule, ["id", "name", "match", "target", "enabled"], ["rewrite"])) return prefix;
    if (typeof rule.id !== "string" || rule.id.length === 0) return `${prefix}.id`;
    if (typeof rule.name !== "string" || rule.name.length === 0) return `${prefix}.name`;
    if (typeof rule.match !== "string" || rule.match.length === 0) return `${prefix}.match`;
    if (typeof rule.target !== "string") return `${prefix}.target`;
    const targetError = invalidHttpTargetField(rule.target, `${prefix}.target`);
    if (targetError !== undefined) return targetError;
    if (rule.rewrite !== undefined && typeof rule.rewrite !== "string") return `${prefix}.rewrite`;
    if (typeof rule.enabled !== "boolean") return `${prefix}.enabled`;
  }

  if (!Array.isArray(value.tcpTargets)) return "tcpTargets";
  for (const [index, target] of value.tcpTargets.entries()) {
    const prefix = `tcpTargets[${index}]`;
    if (!isRecord(target)) return prefix;
    if (!hasOnlyKeys(target, ["id", "name", "host", "port", "enabled"])) return prefix;
    if (typeof target.id !== "string" || target.id.length === 0) return `${prefix}.id`;
    if (typeof target.name !== "string" || target.name.length === 0) return `${prefix}.name`;
    if (typeof target.host !== "string" || target.host.length === 0) return `${prefix}.host`;
    if (typeof target.port !== "number" || !Number.isInteger(target.port) || target.port < 1 || target.port > 65535) return `${prefix}.port`;
    if (typeof target.enabled !== "boolean") return `${prefix}.enabled`;
  }

  if (!isRecord(value.localValues)) return "localValues";
  for (const [key, entry] of Object.entries(value.localValues)) {
    if (typeof entry !== "string") return `localValues.${key}`;
  }
  if (!isRecord(value.mapValues)) return "mapValues";
  for (const [key, entry] of Object.entries(value.mapValues)) {
    if (typeof entry !== "string") return `mapValues.${key}`;
  }
  if (!isRecord(value.accounts)) return "accounts";
  for (const [account, fields] of Object.entries(value.accounts)) {
    if (!isRecord(fields)) return `accounts.${account}`;
    for (const [key, entry] of Object.entries(fields)) {
      if (typeof entry !== "string") return `accounts.${account}.${key}`;
    }
  }

  const cache = value.cache;
  if (!isRecord(cache)) return "cache";
  if (!hasOnlyKeys(cache, ["rootDir", "downloadTarget", "decryptEnabled", "autoDownload"])) return "cache";
  if (typeof cache.rootDir !== "string") return "cache.rootDir";
  if (typeof cache.downloadTarget !== "string") return "cache.downloadTarget";
  if (typeof cache.decryptEnabled !== "boolean") return "cache.decryptEnabled";
  if (typeof cache.autoDownload !== "boolean") return "cache.autoDownload";
  if (value.legacy !== undefined && !isLegacyData(value.legacy)) return "legacy";
  return undefined;
}

export function isValidAppConfig(value: unknown): value is AppConfig {
  return getAppConfigValidationError(value) === undefined;
}
