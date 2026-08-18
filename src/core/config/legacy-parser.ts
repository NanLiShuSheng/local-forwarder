import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import type { ForwardRule } from "../../shared/contracts";
import { createDefaultConfig, type InternalConfig } from "./model";

type UnknownRecord = Record<string, unknown>;
const VM_TIMEOUT_MS = 500;
const MAX_LEGACY_INPUT_BYTES = 1_048_576;
const MAX_LEGACY_DEPTH = 64;
const MAX_LEGACY_NODES = 10_000;
const MAX_SERIALIZED_CONFIG_BYTES = 1_000_000;

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

function assertInputSize(text: string, filename: string): void {
  if (Buffer.byteLength(text, "utf8") > MAX_LEGACY_INPUT_BYTES) {
    throw new ConfigParseError(filename, "file", "input is too large");
  }
}

function assertJsonStructure(value: unknown, filename: string): void {
  const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  let nodes = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) continue;
    nodes += 1;
    if (nodes > MAX_LEGACY_NODES) {
      throw new ConfigParseError(filename, "root", "structure exceeds maximum node count");
    }
    if (current.depth > MAX_LEGACY_DEPTH) {
      throw new ConfigParseError(filename, "root", "structure exceeds maximum depth");
    }
    if (Array.isArray(current.value)) {
      for (const child of current.value) pending.push({ value: child, depth: current.depth + 1 });
    } else if (isRecord(current.value)) {
      for (const child of Object.values(current.value)) pending.push({ value: child, depth: current.depth + 1 });
    }
  }
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
      if (typeof value !== "string") throw new ConfigParseError(filename, `cache.${field === "rootdir" ? "rootDir" : "downloadTarget"}`, "expected a string");
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
  if (enabled !== undefined && typeof enabled !== "boolean") throw new ConfigParseError(filename, `httpRules[${index}].enabled`, "expected a boolean");
  return {
    id: id === undefined ? `http-${index + 1}` : id,
    name: name === undefined ? match : name,
    match,
    target,
    ...(rewrite === undefined ? {} : { rewrite }),
    enabled: enabled === undefined ? true : enabled,
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
      const enabled = valueOf(value, "enabled");
      if (enabled !== undefined && typeof enabled !== "boolean") throw new ConfigParseError(filename, `tcpTargets[${index}].enabled`, "expected a boolean");
      if (isRecord(value)) preserveUnknown(config, value, ["id", "name", "host", "port", "protocol", "enabled"], `tcpTargets[${index}]`);
      return {
        id: id === undefined ? `tcp-${index + 1}` : id,
        name: name === undefined ? host : name,
        host,
        port: parsedPort,
        ...(protocol === undefined ? {} : { protocol }),
        enabled: enabled === undefined ? true : enabled,
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
  const existingTcpTargets = config.tcpTargets;
  for (const [match, entry] of Object.entries(value)) {
    const rule = isRecord(entry) ? entry : { target: entry };
    if (isRecord(entry)) preserveUnknown(config, entry, ["target", "url", "id", "name", "rewrite", "enabled"], `conifg.${match}`);
    const target = valueOf(rule, "target");
    if (match.toLowerCase() === "/reqxml") {
      const targetItems = Array.isArray(target) ? target : [target];
      for (const [index, item] of targetItems.entries()) {
        const field = Array.isArray(target) ? `conifg.${match}.target[${index}]` : `conifg.${match}.target`;
        if (typeof item !== "string") throw new ConfigParseError(filename, field, "expected a string");
        let url: URL;
        try {
          url = new URL(item);
        } catch (error) {
          throw new ConfigParseError(filename, field, "invalid URL", error);
        }
        if (url.protocol !== "http:" && url.protocol !== "https:") {
          throw new ConfigParseError(filename, field, "expected an http or https URL");
        }
        const port = url.port === "" ? (url.protocol === "http:" ? 80 : 443) : Number(url.port);
        const metadata = existingTcpTargets[tcpTargets.length];
        tcpTargets.push({
          id: metadata?.id ?? `tcp-${tcpTargets.length + 1}`,
          name: metadata?.name ?? match,
          host: url.hostname,
          port: parsePort(port, filename, `${field}.port`),
          protocol: url.protocol === "https:" ? "https" : "http",
          enabled: metadata?.enabled ?? true,
        });
      }
      continue;
    }
    const targetValue = valueOf(rule, "target");
    const urlValue = valueOf(rule, "url");
    const targetField = targetValue !== undefined ? "target" : "url";
    const resolvedTarget = targetValue ?? urlValue;
    if (typeof resolvedTarget !== "string") throw new ConfigParseError(filename, `conifg.${match}.${targetField}`, "expected a string");
    const id = valueOf(rule, "id");
    const name = valueOf(rule, "name");
    const rewrite = valueOf(rule, "rewrite");
    const enabled = valueOf(rule, "enabled");
    if (id !== undefined && typeof id !== "string") throw new ConfigParseError(filename, `conifg.${match}.id`, "expected a string");
    if (name !== undefined && typeof name !== "string") throw new ConfigParseError(filename, `conifg.${match}.name`, "expected a string");
    if (rewrite !== undefined && typeof rewrite !== "string") throw new ConfigParseError(filename, `conifg.${match}.rewrite`, "expected a string");
    if (enabled !== undefined && typeof enabled !== "boolean") throw new ConfigParseError(filename, `conifg.${match}.enabled`, "expected a boolean");
    httpRules.push({
      id: id === undefined ? `http-${httpRules.length + 1}` : id,
      name: name === undefined ? match : name,
      match,
      target: resolvedTarget,
      ...(rewrite === undefined ? {} : { rewrite }),
      enabled: enabled === undefined ? true : enabled,
    });
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
  assertJsonStructure(raw, filename);
  const config = applyRawObject(createDefaultConfig(), requiredRecord(raw, filename), filename);
  const matches = new Set<string>();
  for (const [index, rule] of config.httpRules.entries()) {
    if (matches.has(rule.match)) {
      throw new ConfigParseError(filename, `httpRules[${index}].match`, "duplicate HTTP rule match");
    }
    matches.add(rule.match);
  }
  config.legacy.files[filename] = cloneUnknown(raw);
  return config;
}

export function parseSysConfig(text: string, filename = "sysconfig.ini"): Record<string, string> {
  assertInputSize(text, filename);
  const result: Record<string, string> = {};
  let entries = 0;
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const uncommented = line.split(/[;#]/, 1)[0].trim();
    if (uncommented === "") continue;
    const separator = uncommented.indexOf("=");
    if (separator < 0) throw new ConfigParseError(filename, `line ${index + 1}`, "expected key=value");
    const key = uncommented.slice(0, separator).trim();
    if (key === "") throw new ConfigParseError(filename, `line ${index + 1}`, "key cannot be empty");
    entries += 1;
    if (entries > MAX_LEGACY_NODES) {
      throw new ConfigParseError(filename, `line ${index + 1}`, "input exceeds maximum entry count");
    }
    result[key.toUpperCase()] = uncommented.slice(separator + 1).trim();
  }
  return result;
}

export function parseLegacyJson(text: string, filename = "config.json"): InternalConfig {
  assertInputSize(text, filename);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new ConfigParseError(filename, "root", "invalid JSON", error);
  }
  return fromRaw(raw, filename);
}

export function parseLegacyConfigJs(text: string, filename = "config.js"): InternalConfig {
  if (typeof text !== "string") {
    throw new ConfigParseError(filename, "root", "source must be a string");
  }
  assertInputSize(text, filename);
  const context = vm.createContext(Object.create(null), {
    codeGeneration: { strings: false, wasm: false },
  });
  const runOptions = {
    filename,
    timeout: VM_TIMEOUT_MS,
    contextCodeGeneration: { strings: false, wasm: false },
  };
  try {
    vm.runInContext(
      "const __jsonStringify = JSON.stringify; var module = Object.create(null); var exports = Object.create(null); module.exports = exports;",
      context,
      runOptions,
    );
    vm.runInContext(text, context, runOptions);
    const serialized = vm.runInContext("__jsonStringify(module.exports)", context, runOptions);
    if (typeof serialized !== "string") {
      throw new Error("module.exports must be JSON-serializable");
    }
    if (Buffer.byteLength(serialized, "utf8") > MAX_SERIALIZED_CONFIG_BYTES) {
      throw new Error("serialized config is too large");
    }
    return fromRaw(JSON.parse(serialized), filename);
  } catch (error) {
    if (error instanceof ConfigParseError) throw error;
    throw new ConfigParseError(filename, "root", "sandbox execution failed", error);
  }
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
  const filePath = path.join(directory, filename);
  try {
    const details = await stat(filePath);
    if (details.size > MAX_LEGACY_INPUT_BYTES) {
      throw new ConfigParseError(filename, "file", "input is too large");
    }
    const text = await readFile(filePath, "utf8");
    assertInputSize(text, filename);
    return text;
  } catch (error) {
    if (error instanceof ConfigParseError) throw error;
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
