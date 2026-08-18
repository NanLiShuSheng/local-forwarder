import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { isValidAppConfig } from "../../shared/validation";
import { createDefaultConfig, type InternalConfig } from "./model";
import { ConfigParseError, importLegacyConfig } from "./legacy-parser";
import type { AppConfig } from "../../shared/contracts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function detailedValidationField(value: unknown): string | undefined {
  if (!isRecord(value)) return "root";

  const server = value.server;
  if (!isRecord(server) || typeof server.port !== "number" || !Number.isInteger(server.port) || server.port < 1 || server.port > 65_535) {
    return "server.port";
  }

  if (!Array.isArray(value.httpRules)) return "httpRules";
  for (const [index, rule] of value.httpRules.entries()) {
    if (!isRecord(rule) || typeof rule.target !== "string") return `httpRules[${index}].target`;
    if (/^https?:\/\//i.test(rule.target)) {
      try {
        new URL(rule.target);
      } catch {
        return `httpRules[${index}].target.port`;
      }
    }
  }

  if (!Array.isArray(value.tcpTargets)) return "tcpTargets";
  for (const [index, target] of value.tcpTargets.entries()) {
    if (!isRecord(target) || typeof target.port !== "number" || !Number.isInteger(target.port) || target.port < 1 || target.port > 65_535) {
      return `tcpTargets[${index}].port`;
    }
  }

  return undefined;
}

function assertValidConfig(config: AppConfig, filename: string): void {
  if (!isValidAppConfig(config)) {
    throw new ConfigParseError(filename, detailedValidationField(config) ?? "root", "invalid internal configuration");
  }
  for (const [index, rule] of config.httpRules.entries()) {
    if (/^https?:\/\//i.test(rule.target)) {
      try {
        new URL(rule.target);
      } catch (error) {
        throw new ConfigParseError(filename, `httpRules[${index}].target.port`, "invalid target port", error);
      }
    }
  }
}

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
  return {
    server: config.server,
    local: config.localValues,
    map: config.mapValues,
    account: config.accounts,
    conifg,
    cache: config.cache,
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
    return importLegacyConfig(directory);
  }

  async exportLegacy(config: AppConfig, directory: string): Promise<void> {
    assertValidConfig(config, "config.js");
    const normalized = withLegacy(config);
    const object = legacyExportObject(normalized);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "config.js"), `module.exports = ${JSON.stringify(object, null, 2)};\n`, "utf8");
    await writeFile(path.join(directory, "config.json"), `${JSON.stringify({ cache: normalized.cache }, null, 2)}\n`, "utf8");
    await writeFile(path.join(directory, "sysconfig.ini"), writeIni(normalized.localValues), "utf8");
  }
}
