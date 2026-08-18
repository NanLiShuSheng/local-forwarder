import { lstat, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { getAppConfigValidationError } from "../../shared/validation";
import { createDefaultConfig, type InternalConfig } from "./model";
import { ConfigParseError, importLegacyConfig } from "./legacy-parser";
import type { AppConfig } from "../../shared/contracts";

function assertValidConfig(config: AppConfig, filename: string): void {
  const field = getAppConfigValidationError(config);
  if (field !== undefined) {
    throw new ConfigParseError(filename, field, "invalid internal configuration");
  }
}

function withLegacy(config: AppConfig): InternalConfig {
  return {
    ...config,
    legacy: config.legacy ?? createDefaultConfig().legacy,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function nullRecord(): Record<string, unknown> {
  return Object.create(null) as Record<string, unknown>;
}

function formatTcpHost(host: string): string {
  const unbracketed = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  return unbracketed.includes(":") ? `[${unbracketed}]` : unbracketed;
}

function assertSafeSegment(segment: string, field: string): void {
  if (DANGEROUS_KEYS.has(segment.trim().toLowerCase())) {
    throw new ConfigParseError("config.js", field, "dangerous path segment is not allowed");
  }
}

function assertSafePathText(text: string, field: string): void {
  for (const segment of text.split(".")) assertSafeSegment(segment, field);
}

function copyLegacyValue(value: unknown, field: string): unknown {
  if (Array.isArray(value)) return value.map((entry, index) => copyLegacyValue(entry, `${field}[${index}]`));
  if (!isRecord(value)) return value;
  const output = nullRecord();
  for (const [key, entry] of Object.entries(value)) {
    const entryField = `${field}.${key}`;
    assertSafeSegment(key, entryField);
    output[key] = copyLegacyValue(entry, entryField);
  }
  return output;
}

function setSafePath(target: Record<string, unknown>, segments: readonly string[], value: unknown, field: string): void {
  let current = target;
  for (const [index, segment] of segments.entries()) {
    assertSafeSegment(segment, field);
    if (index === segments.length - 1) {
      current[segment] = value;
      return;
    }
    const existing = current[segment];
    if (!isRecord(existing)) current[segment] = nullRecord();
    current = current[segment] as Record<string, unknown>;
  }
}

function exportHttpRule(rule: InternalConfig["httpRules"][number], index: number): Record<string, unknown> {
  const output = nullRecord();
  setSafePath(output, ["id"], rule.id, `HTTPRULES[${index}].id`);
  setSafePath(output, ["name"], rule.name, `HTTPRULES[${index}].name`);
  setSafePath(output, ["match"], rule.match, `HTTPRULES[${index}].match`);
  setSafePath(output, ["target"], rule.target, `HTTPRULES[${index}].target`);
  if (rule.rewrite !== undefined) setSafePath(output, ["rewrite"], rule.rewrite, `HTTPRULES[${index}].rewrite`);
  setSafePath(output, ["enabled"], rule.enabled, `HTTPRULES[${index}].enabled`);
  return output;
}

function exportTcpTarget(target: InternalConfig["tcpTargets"][number], index: number): Record<string, unknown> {
  const output = nullRecord();
  setSafePath(output, ["id"], target.id, `tcpTargets[${index}].id`);
  setSafePath(output, ["name"], target.name, `tcpTargets[${index}].name`);
  setSafePath(output, ["host"], target.host, `tcpTargets[${index}].host`);
  setSafePath(output, ["port"], target.port, `tcpTargets[${index}].port`);
  if (target.protocol !== undefined) setSafePath(output, ["protocol"], target.protocol, `tcpTargets[${index}].protocol`);
  setSafePath(output, ["enabled"], target.enabled, `tcpTargets[${index}].enabled`);
  return output;
}

function addLegacyExtras(
  output: Record<string, unknown>,
  config: InternalConfig,
  conifg: Record<string, unknown>,
): void {
  const canonicalHttpExtras = new Map<number, Record<string, unknown>>();
  const canonicalTcpExtras = new Map<number, Record<string, unknown>>();
  for (const [pathKey, value] of Object.entries(config.legacy.extra)) {
    const safeValue = copyLegacyValue(value, pathKey);
    const serverMatch = /^server\.(.+)$/.exec(pathKey);
    if (serverMatch && isRecord(output.server)) {
      setSafePath(output.server, serverMatch[1].split("."), safeValue, pathKey);
      continue;
    }
    const cacheMatch = /^cache\.(.+)$/.exec(pathKey);
    if (cacheMatch && isRecord(output.cache)) {
      setSafePath(output.cache, cacheMatch[1].split("."), safeValue, pathKey);
      continue;
    }
    const conifgMatch = /^conifg\.(.+)\.([^.]+)$/.exec(pathKey);
    if (conifgMatch) {
      assertSafeSegment(conifgMatch[1], pathKey);
      if (!isRecord(conifg[conifgMatch[1]])) continue;
      setSafePath(conifg, [conifgMatch[1], conifgMatch[2]], safeValue, pathKey);
      continue;
    }
    const httpMatch = /^httpRules\[(\d+)\]\.(.+)$/.exec(pathKey);
    if (httpMatch) {
      const index = Number(httpMatch[1]);
      const entry = canonicalHttpExtras.get(index) ?? nullRecord();
      assertSafePathText(httpMatch[2], pathKey);
      setSafePath(entry, [httpMatch[2]], safeValue, pathKey);
      canonicalHttpExtras.set(index, entry);
      continue;
    }
    const tcpMatch = /^tcpTargets\[(\d+)\]\.(.+)$/.exec(pathKey);
    if (tcpMatch) {
      const index = Number(tcpMatch[1]);
      const entry = canonicalTcpExtras.get(index) ?? nullRecord();
      assertSafePathText(tcpMatch[2], pathKey);
      setSafePath(entry, [tcpMatch[2]], safeValue, pathKey);
      canonicalTcpExtras.set(index, entry);
      continue;
    }
    if (!pathKey.includes(".")) setSafePath(output, [pathKey], safeValue, pathKey);
  }
  if (canonicalHttpExtras.size > 0) {
    const canonicalKey = Array.isArray(output.HTTPRULES) ? "HTTPRULES" : "httpRules";
    const rules = config.httpRules.map((rule, index) => {
      const entry = exportHttpRule(rule, index);
      const extras = canonicalHttpExtras.get(index);
      if (extras !== undefined) {
        for (const [key, value] of Object.entries(extras)) setSafePath(entry, [key], value, `httpRules[${index}].${key}`);
      }
      return entry;
    });
    setSafePath(output, [canonicalKey], rules, canonicalKey);
  }
  if (canonicalTcpExtras.size > 0) {
    const targets = config.tcpTargets.map((target, index) => {
      const entry = exportTcpTarget(target, index);
      const extras = canonicalTcpExtras.get(index);
      if (extras !== undefined) {
        for (const [key, value] of Object.entries(extras)) setSafePath(entry, [key], value, `tcpTargets[${index}].${key}`);
      }
      return entry;
    });
    setSafePath(output, ["tcpTargets"], targets, "tcpTargets");
  }
}

export function exportInternalJson(config: AppConfig): string {
  return `${JSON.stringify(withLegacy(config), null, 2)}\n`;
}

export function parseInternalJson(text: string, filename = "internal.json"): InternalConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new ConfigParseError(filename, "root", "invalid JSON", error);
  }
  const field = getAppConfigValidationError(parsed);
  if (field !== undefined) throw new ConfigParseError(filename, field, "invalid internal configuration");
  if (!isRecord(parsed)) throw new ConfigParseError(filename, "root", "invalid internal configuration");
  return withLegacy(parsed as unknown as AppConfig);
}

function legacyExportObject(config: InternalConfig): Record<string, unknown> {
  const conifg = nullRecord();
  const reqxmlTargets = config.tcpTargets.map((target) => `${target.protocol ?? "http"}://${formatTcpHost(target.host)}:${target.port}`);
  if (reqxmlTargets.length > 0) {
    const reqxml = nullRecord();
    setSafePath(reqxml, ["target"], reqxmlTargets.length === 1 ? reqxmlTargets[0] : reqxmlTargets, "conifg./reqxml.target");
    setSafePath(conifg, ["/reqxml"], reqxml, "conifg./reqxml");
  }
  const hasReqxmlHttpRule = config.httpRules.some((rule) => rule.match.toLowerCase() === "/reqxml");
  const output = nullRecord();
  if (hasReqxmlHttpRule) {
    setSafePath(output, ["HTTPRULES"], config.httpRules.map(exportHttpRule), "HTTPRULES");
  } else {
    for (const [index, rule] of config.httpRules.entries()) {
      const entry = nullRecord();
      setSafePath(entry, ["target"], rule.target, `conifg.${rule.match}[${index}].target`);
      if (rule.rewrite !== undefined) setSafePath(entry, ["rewrite"], rule.rewrite, `conifg.${rule.match}[${index}].rewrite`);
      setSafePath(entry, ["id"], rule.id, `conifg.${rule.match}[${index}].id`);
      setSafePath(entry, ["name"], rule.name, `conifg.${rule.match}[${index}].name`);
      setSafePath(entry, ["enabled"], rule.enabled, `conifg.${rule.match}[${index}].enabled`);
      setSafePath(conifg, [rule.match], entry, `conifg.${rule.match}[${index}]`);
    }
  }
  setSafePath(output, ["server"], copyLegacyValue(config.server, "server"), "server");
  setSafePath(output, ["local"], copyLegacyValue(config.localValues, "local"), "local");
  setSafePath(output, ["map"], copyLegacyValue(config.mapValues, "map"), "map");
  setSafePath(output, ["account"], copyLegacyValue(config.accounts, "account"), "account");
  setSafePath(output, ["conifg"], conifg, "conifg");
  setSafePath(output, ["tcpTargets"], config.tcpTargets.map(exportTcpTarget), "tcpTargets");
  setSafePath(output, ["cache"], copyLegacyValue(config.cache, "cache"), "cache");
  addLegacyExtras(output, config, conifg);
  return output;
}

function writeIni(values: Record<string, string>): string {
  return Object.entries(values)
    .map(([key, value]) => `${key.toUpperCase()}=${value}`)
    .join("\n") + "\n";
}

async function ensureExportDirectory(directory: string): Promise<void> {
  let details;
  try {
    details = await lstat(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new ConfigParseError("directory", "path", "could not inspect export directory", error);
    }
    await mkdir(directory, { recursive: true });
    details = await lstat(directory);
  }
  if (!details.isDirectory() || details.isSymbolicLink()) {
    throw new ConfigParseError("directory", "path", "export directory must be a real directory");
  }
}

async function assertExportTargets(directory: string): Promise<void> {
  for (const filename of ["config.js", "config.json", "sysconfig.ini"]) {
    try {
      const details = await lstat(path.join(directory, filename));
      if (!details.isFile() || details.isSymbolicLink()) {
        throw new ConfigParseError(filename, "file", "export target must be a regular file and cannot be a symlink");
      }
    } catch (error) {
      if (error instanceof ConfigParseError) throw error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new ConfigParseError(filename, "file", "could not inspect export target", error);
      }
    }
  }
}

async function writeLegacyFileAtomically(directory: string, filename: string, content: string): Promise<void> {
  const targetPath = path.join(directory, filename);
  const temporaryPath = `${targetPath}.tmp-${process.pid}-${Math.random().toString(16).slice(2)}`;
  try {
    await writeFile(temporaryPath, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await rename(temporaryPath, targetPath);
  } catch (error) {
    throw new ConfigParseError(filename, "file", "could not write legacy file", error);
  } finally {
    try {
      await unlink(temporaryPath);
    } catch (cleanupError) {
      if ((cleanupError as NodeJS.ErrnoException).code !== "ENOENT") {
        // Do not hide the original write/rename result with a cleanup error.
      }
    }
  }
}

export class ConfigStore {
  constructor(private readonly filePath: string) {}

  async load(): Promise<InternalConfig> {
    let text: string;
    try {
      text = await readFile(this.filePath, "utf8");
    } catch (error) {
      throw new ConfigParseError(path.basename(this.filePath), "file", "could not read internal config", error);
    }
    return parseInternalJson(text, path.basename(this.filePath));
  }

  async save(config: AppConfig): Promise<void> {
    assertValidConfig(config, path.basename(this.filePath));
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp-${process.pid}-${Math.random().toString(16).slice(2)}`;
    try {
      await writeFile(temporaryPath, exportInternalJson(config), { encoding: "utf8", mode: 0o600 });
      await rename(temporaryPath, this.filePath);
    } catch (error) {
      throw new ConfigParseError(path.basename(this.filePath), "file", "could not save internal config", error);
    } finally {
      try {
        await unlink(temporaryPath);
      } catch (cleanupError) {
        if ((cleanupError as NodeJS.ErrnoException).code !== "ENOENT") {
          // Do not hide the original write/rename result with a cleanup error.
        }
      }
    }
  }

  async importLegacy(directory: string): Promise<InternalConfig> {
    const config = await importLegacyConfig(directory);
    assertValidConfig(config, "legacy");
    return config;
  }

  async exportLegacy(config: AppConfig, directory: string): Promise<void> {
    assertValidConfig(config, "config.js");
    const normalized = withLegacy(config);
    const object = legacyExportObject(normalized);
    const legacyJson = copyLegacyValue(normalized.legacy.files["config.json"], "legacy.files.config.json");
    await ensureExportDirectory(directory);
    await assertExportTargets(directory);
    await writeLegacyFileAtomically(directory, "config.js", `module.exports = ${JSON.stringify(object, null, 2)};\n`);
    await writeLegacyFileAtomically(directory, "config.json", `${JSON.stringify(legacyJson ?? { cache: normalized.cache }, null, 2)}\n`);
    await writeLegacyFileAtomically(directory, "sysconfig.ini", writeIni(normalized.localValues));
  }
}
