import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import type { ForwardRule } from "../../shared/contracts";
import { createDefaultConfig, type InternalConfig } from "./model";

type UnknownRecord = Record<string, unknown>;

export class ConfigParseError extends Error {
  constructor(filename: string, field: string, message: string, cause?: unknown) {
    super(`${filename} ${field}: ${message}`, { cause });
    this.name = "ConfigParseError";
  }
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function keyOf(value: string): string {
  return value.trim().toLowerCase();
}

function recordKey(record: UnknownRecord, wanted: string): string | undefined {
  return Object.keys(record).find((key) => keyOf(key) === wanted);
}

function valueOf(record: UnknownRecord, wanted: string): unknown {
  const key = recordKey(record, wanted);
  return key === undefined ? undefined : record[key];
}

function requiredRecord(value: unknown, filename: string): UnknownRecord {
  if (!isRecord(value)) {
    throw new ConfigParseError(filename, "root", "expected an object");
  }
  return value;
}

function parsePort(value: unknown, filename: string, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new ConfigParseError(filename, field, "port must be an integer between 1 and 65535");
  }
  return value;
}

function parseBoolean(value: unknown, filename: string, field: string): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string" && /^(true|false)$/i.test(value.trim())) {
    return value.trim().toLowerCase() === "true";
  }
  throw new ConfigParseError(filename, field, "expected a boolean");
}

function cloneUnknown(value: unknown): unknown {
  if (value === undefined || typeof value === "function" || typeof value === "symbol") return undefined;
  if (Array.isArray(value)) return Array.from(value, cloneUnknown);
  if (isRecord(value)) {
    const output: UnknownRecord = {};
    for (const [key, entry] of Object.entries(value)) {
      const cloned = cloneUnknown(entry);
      if (cloned !== undefined) output[key] = cloned;
    }
    return output;
  }
  return value;
}

function applyServer(config: InternalConfig, raw: UnknownRecord, filename: string): void {
  const serverValue = valueOf(raw, "server");
  if (serverValue === undefined) return;
  const server = requiredRecord(serverValue, filename);
  const bindHost = valueOf(server, "bindhost");
  const port = valueOf(server, "port");
  const timeoutMs = valueOf(server, "timeoutms");
  const loggingEnabled = valueOf(server, "loggingenabled");
  if (bindHost !== undefined) {
    if (typeof bindHost !== "string") throw new ConfigParseError(filename, "server.bindHost", "expected a string");
    config.server.bindHost = bindHost;
  }
  if (port !== undefined) config.server.port = parsePort(port, filename, "server.port");
  if (timeoutMs !== undefined) {
    if (typeof timeoutMs !== "number" || !Number.isInteger(timeoutMs) || timeoutMs < 0) {
      throw new ConfigParseError(filename, "server.timeoutMs", "expected a non-negative integer");
    }
    config.server.timeoutMs = timeoutMs;
  }
  if (loggingEnabled !== undefined) {
    config.server.loggingEnabled = parseBoolean(loggingEnabled, filename, "server.loggingEnabled");
  }
  preserveUnknown(config, server, ["bindhost", "port", "timeoutms", "loggingenabled"], "server");
}

function applyCache(config: InternalConfig, raw: UnknownRecord, filename: string): void {
  const cacheValue = valueOf(raw, "cache");
  if (cacheValue === undefined) return;
  const cache = requiredRecord(cacheValue, filename);
  for (const field of ["rootdir", "downloadtarget"] as const) {
    const value = valueOf(cache, field);
    if (value !== undefined) {
      if (typeof value !== "string") throw new ConfigParseError(filename, `cache.${field}`, "expected a string");
      config.cache[field === "rootdir" ? "rootDir" : "downloadTarget"] = value;
    }
  }
  const decryptEnabled = valueOf(cache, "decryptenabled");
  const autoDownload = valueOf(cache, "autodownload");
  if (decryptEnabled !== undefined) config.cache.decryptEnabled = parseBoolean(decryptEnabled, filename, "cache.decryptEnabled");
  if (autoDownload !== undefined) config.cache.autoDownload = parseBoolean(autoDownload, filename, "cache.autoDownload");
  preserveUnknown(config, cache, ["rootdir", "downloadtarget", "decryptenabled", "autodownload"], "cache");
}

function applyStringRecord(
  target: Record<string, string>,
  value: unknown,
  filename: string,
  field: string,
  uppercaseKeys: boolean,
): void {
  if (value === undefined) return;
  if (!isRecord(value)) throw new ConfigParseError(filename, field, "expected an object");
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "string") throw new ConfigParseError(filename, `${field}.${key}`, "expected a string");
    target[uppercaseKeys ? key.toUpperCase() : key] = entry;
  }
}

function applyAccounts(config: InternalConfig, raw: UnknownRecord, filename: string): void {
  const value = valueOf(raw, "accounts") ?? valueOf(raw, "account");
  if (value === undefined) return;
  if (!isRecord(value)) throw new ConfigParseError(filename, "accounts", "expected an object");
  for (const [accountName, accountValue] of Object.entries(value)) {
    if (!isRecord(accountValue)) throw new ConfigParseError(filename, `accounts.${accountName}`, "expected an object");
    const account: Record<string, string> = config.accounts[accountName.toLowerCase()] ?? {};
    for (const [field, entry] of Object.entries(accountValue)) {
      if (typeof entry !== "string") throw new ConfigParseError(filename, `accounts.${accountName}.${field}`, "expected a string");
      account[field.toLowerCase()] = entry;
    }
    config.accounts[accountName.toLowerCase()] = account;
  }
}

function asRule(value: unknown, index: number, filename: string): ForwardRule {
  if (!isRecord(value)) throw new ConfigParseError(filename, `httpRules[${index}]`, "expected an object");
  const match = valueOf(value, "match");
  const target = valueOf(value, "target");
  if (typeof match !== "string") throw new ConfigParseError(filename, `httpRules[${index}].match`, "expected a string");
  if (typeof target !== "string") throw new ConfigParseError(filename, `httpRules[${index}].target`, "expected a string");
  const id = valueOf(value, "id");
  const name = valueOf(value, "name");
  const rewrite = valueOf(value, "rewrite");
  const enabled = valueOf(value, "enabled");
  if (id !== undefined && typeof id !== "string") throw new ConfigParseError(filename, `httpRules[${index}].id`, "expected a string");
  if (name !== undefined && typeof name !== "string") throw new ConfigParseError(filename, `httpRules[${index}].name`, "expected a string");
  if (rewrite !== undefined && typeof rewrite !== "string") throw new ConfigParseError(filename, `httpRules[${index}].rewrite`, "expected a string");
  return {
    id: id === undefined ? `http-${index + 1}` : id,
    name: name === undefined ? match : name,
    match,
    target,
    ...(rewrite === undefined ? {} : { rewrite }),
    enabled: enabled === undefined ? true : parseBoolean(enabled, filename, `httpRules[${index}].enabled`),
  };
}

function applyCanonicalRules(config: InternalConfig, raw: UnknownRecord, filename: string): void {
  const httpRules = valueOf(raw, "httprules");
  if (httpRules !== undefined) {
    if (!Array.isArray(httpRules)) throw new ConfigParseError(filename, "httpRules", "expected an array");
    config.httpRules = httpRules.map((rule, index) => {
      const normalized = asRule(rule, index, filename);
      if (isRecord(rule)) preserveUnknown(config, rule, ["id", "name", "match", "target", "rewrite", "enabled"], `httpRules[${index}]`);
      return normalized;
    });
  }
  const tcpTargets = valueOf(raw, "tcptargets");
  if (tcpTargets !== undefined) {
    if (!Array.isArray(tcpTargets)) throw new ConfigParseError(filename, "tcpTargets", "expected an array");
    config.tcpTargets = tcpTargets.map((value, index) => {
      if (!isRecord(value)) throw new ConfigParseError(filename, `tcpTargets[${index}]`, "expected an object");
      const host = valueOf(value, "host");
      const port = valueOf(value, "port");
      const id = valueOf(value, "id");
      const name = valueOf(value, "name");
      const protocol = valueOf(value, "protocol");
      if (typeof host !== "string") throw new ConfigParseError(filename, `tcpTargets[${index}].host`, "expected a string");
      const parsedPort = parsePort(port, filename, `tcpTargets[${index}].port`);
      if (id !== undefined && typeof id !== "string") throw new ConfigParseError(filename, `tcpTargets[${index}].id`, "expected a string");
      if (name !== undefined && typeof name !== "string") throw new ConfigParseError(filename, `tcpTargets[${index}].name`, "expected a string");
      if (protocol !== undefined && protocol !== "http" && protocol !== "https") throw new ConfigParseError(filename, `tcpTargets[${index}].protocol`, "expected http or https");
      if (isRecord(value)) preserveUnknown(config, value, ["id", "name", "host", "port", "protocol", "enabled"], `tcpTargets[${index}]`);
      return {
        id: id === undefined ? `tcp-${index + 1}` : id,
        name: name === undefined ? host : name,
        host,
        port: parsedPort,
        ...(protocol === undefined ? {} : { protocol }),
        enabled: valueOf(value, "enabled") === undefined ? true : parseBoolean(valueOf(value, "enabled"), filename, `tcpTargets[${index}].enabled`),
      };
    });
  }
}

function applyLegacyConifg(config: InternalConfig, raw: UnknownRecord, filename: string): void {
  const value = valueOf(raw, "conifg") ?? valueOf(raw, "config");
  if (value === undefined) return;
  if (!isRecord(value)) throw new ConfigParseError(filename, "conifg", "expected an object");
  const httpRules: ForwardRule[] = [];
  const tcpTargets: InternalConfig["tcpTargets"] = [];
  for (const [match, entry] of Object.entries(value)) {
    const rule = isRecord(entry) ? entry : { target: entry };
    const target = valueOf(rule, "target");
    if (typeof target !== "string") throw new ConfigParseError(filename, `conifg.${match}.target`, "expected a string");
    if (isRecord(entry)) preserveUnknown(config, entry, ["target"], `conifg.${match}`);
    if (match.toLowerCase() === "/reqxml" && /^https?:\/\//i.test(target)) {
      let url: URL;
      try {
        url = new URL(target);
      } catch (error) {
        throw new ConfigParseError(filename, `conifg.${match}.target`, "invalid URL", error);
      }
      if (url.protocol === "http:" || url.protocol === "https:") {
        const port = url.port === "" ? (url.protocol === "http:" ? 80 : 443) : Number(url.port);
        tcpTargets.push({
          id: `tcp-${tcpTargets.length + 1}`,
          name: match,
          host: url.hostname,
          port: parsePort(port, filename, `conifg.${match}.target.port`),
          protocol: url.protocol === "https:" ? "https" : "http",
          enabled: true,
        });
        continue;
      }
    }
    httpRules.push({ id: `http-${httpRules.length + 1}`, name: match, match, target, enabled: true });
  }
  config.httpRules = httpRules;
  config.tcpTargets = tcpTargets;
}

function preserveUnknown(
  config: InternalConfig,
  record: UnknownRecord,
  knownKeys: readonly string[],
  prefix: string,
): void {
  const known = new Set(knownKeys);
  for (const [key, value] of Object.entries(record)) {
    const normalized = keyOf(key);
    if (!known.has(normalized)) {
      const cloned = cloneUnknown(value);
      if (cloned !== undefined) config.legacy.extra[`${prefix}.${normalized}`] = cloned;
    }
  }
}

function applyRawObject(config: InternalConfig, raw: UnknownRecord, filename: string): InternalConfig {
  applyServer(config, raw, filename);
  applyCache(config, raw, filename);
  applyAccounts(config, raw, filename);
  applyStringRecord(config.localValues, valueOf(raw, "localvalues") ?? valueOf(raw, "local"), filename, "localValues", true);
  applyStringRecord(config.mapValues, valueOf(raw, "mapvalues") ?? valueOf(raw, "map"), filename, "mapValues", true);
  applyCanonicalRules(config, raw, filename);
  applyLegacyConifg(config, raw, filename);

  const known = new Set(["server", "cache", "accounts", "account", "localvalues", "local", "mapvalues", "map", "httprules", "tcptargets", "conifg", "config", "legacy"]);
  for (const [key, value] of Object.entries(raw)) {
    const normalized = keyOf(key);
    if (!known.has(normalized)) {
      const cloned = cloneUnknown(value);
      if (cloned !== undefined) config.legacy.extra[normalized] = cloned;
    }
  }
  return config;
}

function fromRaw(raw: unknown, filename: string): InternalConfig {
  const config = applyRawObject(createDefaultConfig(), requiredRecord(raw, filename), filename);
  config.legacy.files[filename] = cloneUnknown(raw);
  return config;
}

export function parseSysConfig(text: string, filename = "sysconfig.ini"): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const uncommented = line.split(/[;#]/, 1)[0].trim();
    if (uncommented === "") continue;
    const separator = uncommented.indexOf("=");
    if (separator < 0) throw new ConfigParseError(filename, `line ${index + 1}`, "expected key=value");
    const key = uncommented.slice(0, separator).trim();
    if (key === "") throw new ConfigParseError(filename, `line ${index + 1}`, "key cannot be empty");
    result[key.toUpperCase()] = uncommented.slice(separator + 1).trim();
  }
  return result;
}

export function parseLegacyJson(text: string, filename = "config.json"): InternalConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new ConfigParseError(filename, "root", "invalid JSON", error);
  }
  return fromRaw(raw, filename);
}

export function parseLegacyConfigJs(text: string, filename = "config.js"): InternalConfig {
  const module = { exports: {} as unknown };
  try {
    vm.runInNewContext(text, { module }, {
      filename,
      timeout: 500,
      contextCodeGeneration: { strings: false, wasm: false },
    });
  } catch (error) {
    throw new ConfigParseError(filename, "root", "sandbox execution failed", error);
  }
  return fromRaw(module.exports, filename);
}

function applySysConfig(config: InternalConfig, values: Record<string, string>, filename: string): void {
  for (const [key, value] of Object.entries(values)) {
    if (key === "PORT" || key === "SERVER_PORT") {
      config.server.port = parsePort(Number(value), filename, "server.port");
    } else if (key === "BINDHOST" || key === "SERVER_BINDHOST") {
      config.server.bindHost = value;
    } else if (key === "TIMEOUTMS" || key === "SERVER_TIMEOUTMS") {
      const timeoutMs = Number(value);
      if (!Number.isInteger(timeoutMs) || timeoutMs < 0) throw new ConfigParseError(filename, "server.timeoutMs", "expected a non-negative integer");
      config.server.timeoutMs = timeoutMs;
    } else if (key === "LOGGINGENABLED" || key === "SERVER_LOGGINGENABLED") {
      config.server.loggingEnabled = parseBoolean(value, filename, "server.loggingEnabled");
    } else {
      config.localValues[key] = value;
    }
  }
}

async function readLegacyFile(directory: string, filename: string): Promise<string> {
  try {
    return await readFile(path.join(directory, filename), "utf8");
  } catch (error) {
    throw new ConfigParseError(filename, "file", "could not read legacy file", error);
  }
}

export async function importLegacyConfig(directory: string): Promise<InternalConfig> {
  const jsText = await readLegacyFile(directory, "config.js");
  const jsonText = await readLegacyFile(directory, "config.json");
  const iniText = await readLegacyFile(directory, "sysconfig.ini");
  const config = createDefaultConfig();
  const jsRaw = parseLegacyConfigJs(jsText, "config.js");
  const jsonRaw = parseLegacyJson(jsonText, "config.json");
  const sysValues = parseSysConfig(iniText, "sysconfig.ini");
  applyRawObject(config, jsonRaw.legacy.files["config.json"] as UnknownRecord ?? {}, "config.json");
  applySysConfig(config, sysValues, "sysconfig.ini");
  applyRawObject(config, jsRaw.legacy.files["config.js"] as UnknownRecord ?? {}, "config.js");
  config.legacy.files = {
    "config.js": cloneUnknown(jsRaw.legacy.files["config.js"]),
    "config.json": cloneUnknown(jsonRaw.legacy.files["config.json"]),
    "sysconfig.ini": { ...sysValues },
  };
  return config;
}
