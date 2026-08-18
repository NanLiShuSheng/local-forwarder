import type { AppConfig, LegacyData } from "../../shared/contracts";

export type InternalConfig = AppConfig & { legacy: LegacyData };

export function createDefaultConfig(): InternalConfig {
  return {
    server: {
      bindHost: "127.0.0.1",
      port: 8080,
      timeoutMs: 30_000,
      loggingEnabled: true,
    },
    httpRules: [],
    tcpTargets: [],
    localValues: {},
    mapValues: {},
    accounts: {},
    cache: {
      rootDir: "",
      downloadTarget: "",
      decryptEnabled: false,
      autoDownload: false,
    },
    legacy: {
      files: {},
      extra: {},
    },
  };
}
