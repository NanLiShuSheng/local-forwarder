import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { isValidAppConfig } from "../../shared/validation";
import { createDefaultConfig, type InternalConfig } from "./model";
import { ConfigParseError, importLegacyConfig } from "./legacy-parser";
import type { AppConfig } from "../../shared/contracts";

function withLegacy(config: AppConfig): InternalConfig {
  return {
    ...config,
    legacy: config.legacy ?? createDefaultConfig().legacy,
  };
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
  const config = isValidAppConfig(parsed) ? withLegacy(parsed) : undefined;
  if (config === undefined) {
    const field = typeof parsed === "object" && parsed !== null && "server" in parsed ? "server.port" : "root";
    throw new ConfigParseError(filename, field, "invalid internal configuration");
  }
  return config;
}

function legacyExportObject(config: InternalConfig): Record<string, unknown> {
  return {
    server: config.server,
    httpRules: config.httpRules,
    tcpTargets: config.tcpTargets,
    localValues: config.localValues,
    mapValues: config.mapValues,
    accounts: config.accounts,
    cache: config.cache,
    ...config.legacy.extra,
  };
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
    if (!isValidAppConfig(config)) {
      throw new ConfigParseError(path.basename(this.filePath), "root", "invalid internal configuration");
    }
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
    return importLegacyConfig(directory);
  }

  async exportLegacy(config: AppConfig, directory: string): Promise<void> {
    const normalized = withLegacy(config);
    const object = legacyExportObject(normalized);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "config.js"), `module.exports = ${JSON.stringify(object, null, 2)};\n`, "utf8");
    await writeFile(path.join(directory, "config.json"), `${JSON.stringify({ cache: normalized.cache }, null, 2)}\n`, "utf8");
    await writeFile(path.join(directory, "sysconfig.ini"), writeIni(normalized.localValues), "utf8");
  }
}
