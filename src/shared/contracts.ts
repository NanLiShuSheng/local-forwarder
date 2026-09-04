export type RuntimeState = "stopped" | "starting" | "running" | "stopping" | "error";

export interface ForwardRule {
  id: string;
  name: string;
  match: string;
  target: string;
  rewrite?: string;
  enabled: boolean;
}

export interface ManualRequestConfig {
  host: string;
  port: number;
  paramsText: string;
  transport?: "tzt" | "http";
}

export interface ManualRequestResponse extends OperationResult {
  statusCode?: number;
  statusMessage?: string;
  body?: string;
  durationMs?: number;
}

export type StringToolOperation = "replace" | "remove" | "uppercase" | "lowercase" | "url-encode" | "url-decode" | "json-format";

export interface StringToolConfig {
  inputText: string;
  outputText: string;
  operation: StringToolOperation;
  findText: string;
  replaceText: string;
}

export interface ForwardingAddressHistory {
  hq: string[];
  jy: string[];
  zx: string[];
}

export interface AppConfig {
  server: {
    bindHost: string;
    port: number;
    timeoutMs: number;
    loggingEnabled: boolean;
  };
  projectPath?: string;
  httpRules: ForwardRule[];
  tcpTargets: Array<{
    id: string;
    name: string;
    host: string;
    port: number;
    protocol?: "http" | "https";
    basePath?: string;
    transport?: "tcp" | "http";
    enabled: boolean;
  }>;
  forwardingAddressHistory?: ForwardingAddressHistory | string[];
  localText?: string;
  localValues: Record<string, string>;
  mapValues: Record<string, string>;
  accounts: Record<string, Record<string, string>>;
  cache: {
    rootDir: string;
    downloadTarget: string;
    decryptEnabled: boolean;
    autoDownload: boolean;
  };
  request?: ManualRequestConfig;
  stringTool?: StringToolConfig;
  legacy?: LegacyData;
}

export interface LegacyData {
  files: Record<string, unknown>;
  extra: Record<string, unknown>;
}

export interface LogEntry {
  timestamp: string;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  direction?: "inbound" | "outbound";
  protocol?: "http" | "https" | "tcp";
  ruleId?: string;
  statusCode?: number;
  durationMs?: number;
  requestType?: "fetch" | "xhr";
  requestParams?: string;
  responseData?: string;
}

export interface RuntimeStatus {
  state: RuntimeState;
  requestCount: number;
  tcpConnections: number;
  error?: string;
}

export interface ProxyInstance {
  id: string;
  name: string;
  config: AppConfig;
}

export interface ProxyWorkspace {
  version: 1;
  selectedInstanceId: string;
  instances: ProxyInstance[];
}

export interface ProxyInstanceSummary {
  id: string;
  name: string;
  selected: boolean;
  bindHost: string;
  port: number;
  target: string;
  status: RuntimeStatus;
}

export interface OperationResult {
  ok: boolean;
  error?: string;
}

export type EncryptionMode = "full" | "incremental";

export type EncryptionDirectoryKind = "input" | "output";

export interface EncryptionPreferences {
  inputDir: string;
  outputDir: string;
}

export interface EncryptionFileResult {
  relativePath: string;
  outputPath: string;
}

export interface EncryptionResult extends OperationResult {
  mode?: EncryptionMode;
  totalFiles?: number;
  processedFiles?: number;
  skippedFiles?: number;
  removedFiles?: number;
  files?: EncryptionFileResult[];
  logs?: string[];
}

export interface ForwarderApi {
  getConfig(): Promise<AppConfig>;
  saveConfig(config: AppConfig): Promise<OperationResult>;
  listProxyInstances(): Promise<ProxyInstanceSummary[]>;
  selectProxyInstance(id: string): Promise<OperationResult & { instanceId?: string }>;
  createProxyInstance(): Promise<OperationResult & { instance?: ProxyInstanceSummary }>;
  duplicateProxyInstance(): Promise<OperationResult & { instance?: ProxyInstanceSummary }>;
  importLegacy(): Promise<OperationResult & { config?: AppConfig }>;
  exportConfig(): Promise<OperationResult & { path?: string }>;
  selectProjectDirectory(): Promise<OperationResult & { path?: string; canceled?: boolean }>;
  selectEncryptionDirectory(kind: EncryptionDirectoryKind): Promise<OperationResult & { path?: string; canceled?: boolean }>;
  getEncryptionPreferences(): Promise<EncryptionPreferences>;
  saveEncryptionPreferences(patch: Partial<EncryptionPreferences>): Promise<OperationResult & { preferences?: EncryptionPreferences }>;
  encryptDirectory(inputDir: string, outputDir: string, mode: EncryptionMode): Promise<EncryptionResult>;
  sendRequest(request: ManualRequestConfig): Promise<ManualRequestResponse>;
  start(): Promise<RuntimeStatus>;
  stop(): Promise<RuntimeStatus>;
  status(): Promise<RuntimeStatus>;
  logs(): Promise<LogEntry[]>;
  clearLogs(): Promise<OperationResult>;
}

export const IPC_CHANNELS = {
  getConfig: "config:get",
  saveConfig: "config:save",
  importLegacy: "config:import-legacy",
  exportConfig: "config:export",
  selectProjectDirectory: "config:select-project-directory",
  selectEncryptionDirectory: "encryption:select-directory",
  getEncryptionPreferences: "encryption:get-preferences",
  saveEncryptionPreferences: "encryption:save-preferences",
  encryptDirectory: "encryption:run",
  sendRequest: "request:send",
  listProxyInstances: "proxy-instances:list",
  selectProxyInstance: "proxy-instances:select",
  createProxyInstance: "proxy-instances:create",
  duplicateProxyInstance: "proxy-instances:duplicate",
  start: "runtime:start",
  stop: "runtime:stop",
  status: "runtime:status",
  logs: "runtime:logs",
  clearLogs: "runtime:logs:clear",
} as const;

declare global {
  interface Window {
    forwarder: ForwarderApi;
  }
}
