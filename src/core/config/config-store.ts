import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
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

function setNestedValue(target: Record<string, unknown>, field: string, value: unknown): void {
  target[field] = value;
}

function addLegacyExtras(
  output: Record<string, unknown>,
  config: InternalConfig,
  conifg: Record<string, unknown>,
): void {
  const canonicalHttpExtras = new Map<number, Record<string, unknown>>();
  const canonicalTcpExtras = new Map<number, Record<string, unknown>>();
  for (const [pathKey, value] of Object.entries(config.legacy.extra)) {
    const serverMatch = /^server\.(.+)$/.exec(pathKey);
    if (serverMatch && isRecord(output.server)) {
      setNestedValue(output.server, serverMatch[1], value);
      continue;
    }
    const cacheMatch = /^cache\.(.+)$/.exec(pathKey);
    if (cacheMatch && isRecord(output.cache)) {
      setNestedValue(output.cache, cacheMatch[1], value);
      continue;
    }
    const conifgMatch = /^conifg\.(.+)\.([^.]+)$/.exec(pathKey);
    if (conifgMatch) {
      const entry = isRecord(conifg[conifgMatch[1]]) ? conifg[conifgMatch[1]] as Record<string, unknown> : {};
      entry[conifgMatch[2]] = value;
      conifg[conifgMatch[1]] = entry;
      continue;
    }
    const httpMatch = /^httpRules\[(\d+)\]\.(.+)$/.exec(pathKey);
    if (httpMatch) {
      const index = Number(httpMatch[1]);
      const entry = canonicalHttpExtras.get(index) ?? {};
      entry[httpMatch[2]] = value;
      canonicalHttpExtras.set(index, entry);
      continue;
    }
    const tcpMatch = /^tcpTargets\[(\d+)\]\.(.+)$/.exec(pathKey);
    if (tcpMatch) {
      const index = Number(tcpMatch[1]);
      const entry = canonicalTcpExtras.get(index) ?? {};
      entry[tcpMatch[2]] = value;
      canonicalTcpExtras.set(index, entry);
      continue;
    }
    if (!pathKey.includes(".")) output[pathKey] = value;
  }
  if (canonicalHttpExtras.size > 0) {
    output.httpRules = config.httpRules.map((rule, index) => ({ ...rule, ...(canonicalHttpExtras.get(index) ?? {}) }));
  }
  if (canonicalTcpExtras.size > 0) {
    output.tcpTargets = config.tcpTargets.map((target, index) => ({ ...target, ...(canonicalTcpExtras.get(index) ?? {}) }));
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
  const conifg: Record<string, unknown> = {};
  for (const target of config.tcpTargets) {
    conifg["/reqxml"] = { target: `http://${target.host}:${target.port}` };
  }
  for (const rule of config.httpRules) {
    conifg[rule.match] = {
      target: rule.target,
      ...(rule.rewrite === undefined ? {} : { rewrite: rule.rewrite }),
    };
  }
  const output: Record<string, unknown> = {
    server: { ...config.server },
    local: config.localValues,
    map: config.mapValues,
    account: config.accounts,
    conifg,
    cache: { ...config.cache },
  };
  addLegacyExtras(output, config, conifg);
  return output;
}

function writeIni(values: Record<string, string>): string {
  return Object.entries(values)
    .map(([key, value]) => `${key.toUpperCase()}=${value}`)
    .join("\n") + "\n";
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
    const legacyJson = normalized.legacy.files["config.json"];
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "config.js"), `module.exports = ${JSON.stringify(object, null, 2)};\n`, "utf8");
    await writeFile(path.join(directory, "config.json"), `${JSON.stringify(legacyJson ?? { cache: normalized.cache }, null, 2)}\n`, "utf8");
    await writeFile(path.join(directory, "sysconfig.ini"), writeIni(normalized.localValues), "utf8");
  }
}
