import type { AppConfig, ForwardRule } from "./contracts";

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

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}

function isLegacyData(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["files", "extra"]) &&
    isRecord(value.files) &&
    isRecord(value.extra)
  );
}

function isForwardRule(value: unknown): value is ForwardRule {
  if (!isRecord(value) || !hasOnlyKeys(value, ["id", "name", "match", "target", "enabled"], ["rewrite"])) {
    return false;
  }
  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.match === "string" &&
    typeof value.target === "string" &&
    typeof value.enabled === "boolean" &&
    (value.rewrite === undefined || typeof value.rewrite === "string")
  );
}

function isTcpTarget(value: unknown): boolean {
  if (!isRecord(value) || !hasOnlyKeys(value, ["id", "name", "host", "port", "enabled"])) {
    return false;
  }
  const port = value.port;
  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.host === "string" &&
    typeof port === "number" &&
    Number.isInteger(port) &&
    port >= 1 &&
    port <= 65535 &&
    typeof value.enabled === "boolean"
  );
}

export function isValidAppConfig(value: unknown): value is AppConfig {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "server",
      "httpRules",
      "tcpTargets",
      "localValues",
      "mapValues",
      "accounts",
      "cache",
    ], ["legacy"])
  ) {
    return false;
  }

  const server = value.server;
  const cache = value.cache;
  const serverPort = isRecord(server) ? server.port : undefined;
  const timeoutMs = isRecord(server) ? server.timeoutMs : undefined;
  if (
    !isRecord(server) ||
    !hasOnlyKeys(server, ["bindHost", "port", "timeoutMs", "loggingEnabled"]) ||
    typeof server.bindHost !== "string" ||
    typeof serverPort !== "number" ||
    !Number.isInteger(serverPort) ||
    serverPort < 1 ||
    serverPort > 65535 ||
    typeof timeoutMs !== "number" ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 0 ||
    typeof server.loggingEnabled !== "boolean"
  ) {
    return false;
  }

  return (
    Array.isArray(value.httpRules) &&
    value.httpRules.every(isForwardRule) &&
    Array.isArray(value.tcpTargets) &&
    value.tcpTargets.every(isTcpTarget) &&
    isStringRecord(value.localValues) &&
    isStringRecord(value.mapValues) &&
    isRecord(value.accounts) &&
    Object.values(value.accounts).every(isStringRecord) &&
    isRecord(cache) &&
    hasOnlyKeys(cache, ["rootDir", "downloadTarget", "decryptEnabled", "autoDownload"]) &&
    typeof cache.rootDir === "string" &&
    typeof cache.downloadTarget === "string" &&
    typeof cache.decryptEnabled === "boolean" &&
    typeof cache.autoDownload === "boolean" &&
    (value.legacy === undefined || isLegacyData(value.legacy))
  );
}
