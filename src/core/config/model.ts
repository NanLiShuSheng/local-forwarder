import type { AppConfig, LegacyData, ProxyInstance, ProxyWorkspace } from "../../shared/contracts";
import { createDefaultForwardingTargets, DEFAULT_REQUEST_HOST, DEFAULT_REQUEST_PARAMS_TEXT, DEFAULT_REQUEST_PORT } from "../../shared/config-defaults";
import { parseLocalCacheText } from "../../shared/local-cache";
import { ensureDefaultLocalValues } from "../../shared/local-values";

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
    tcpTargets: createDefaultForwardingTargets(),
    forwardingAddressHistory: { hq: [], jy: [], zx: [] },
    localValues: {},
    mapValues: {},
    accounts: {},
    cache: {
      rootDir: "",
      downloadTarget: "",
      decryptEnabled: false,
      autoDownload: false,
    },
    request: {
      host: DEFAULT_REQUEST_HOST,
      port: DEFAULT_REQUEST_PORT,
      paramsText: DEFAULT_REQUEST_PARAMS_TEXT,
    },
    stringTool: {
      inputText: "",
      outputText: "",
      operation: "replace",
      findText: "",
      replaceText: "",
    },
    legacy: {
      files: {},
      extra: {},
    },
  };
}

export function createDefaultProxyInstance(config: AppConfig = createDefaultConfig()): ProxyInstance {
  const loginCache = { ...config.localValues };
  return { id: "default", name: "默认代理", config: { ...config, localValues: {} }, loginCache };
}

export function createDefaultWorkspace(config: AppConfig = createDefaultConfig()): ProxyWorkspace {
  const instance = createDefaultProxyInstance(config);
  let sharedValues: Record<string, string> = {};
  try { sharedValues = parseLocalCacheText(config.localText ?? ""); } catch { /* malformed legacy text remains in the legacy config only */ }
  return { version: 1, selectedInstanceId: instance.id, sharedValues: ensureDefaultLocalValues(sharedValues), instances: [instance] };
}
