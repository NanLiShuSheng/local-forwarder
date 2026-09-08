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
  loginCache?: Record<string, string>;
}

export interface ProxyWorkspace {
  version: 1;
  selectedInstanceId: string;
  instances: ProxyInstance[];
  sharedValues?: Record<string, string>;
}

export interface ProxyInstanceSummary {
  id: string;
  name: string;
  selected: boolean;
  bindHost: string;
  port: number;
  target: string;
  loginCacheCount: number;
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
  inputHistory: string[];
  outputHistory: string[];
}

export type EncryptionPreferencesPatch = Partial<Pick<EncryptionPreferences, "inputDir" | "outputDir">>;

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

export type EncryptionProgressPhase = "scanning" | "processing" | "completed";
export type EncryptionProgressStatus = "encrypting" | "skipping" | "removing" | "completed";

export interface EncryptionProgress {
  mode: EncryptionMode;
  phase: EncryptionProgressPhase;
  status?: EncryptionProgressStatus;
  current: number;
  total: number;
  processedFiles: number;
  skippedFiles: number;
  removedFiles: number;
  relativePath?: string;
}

export interface ForwarderApi {
  getConfig(): Promise<AppConfig>;
  saveConfig(config: AppConfig): Promise<OperationResult>;
  getSharedValues(): Promise<Record<string, string>>;
  saveSharedValues(values: Record<string, string>): Promise<OperationResult>;
  getLoginCache(): Promise<Record<string, string>>;
  saveLoginCache(values: Record<string, string>): Promise<OperationResult>;
  listProxyInstances(): Promise<ProxyInstanceSummary[]>;
  selectProxyInstance(id: string): Promise<OperationResult & { instanceId?: string }>;
  createProxyInstance(): Promise<OperationResult & { instance?: ProxyInstanceSummary }>;
  duplicateProxyInstance(): Promise<OperationResult & { instance?: ProxyInstanceSummary }>;
  renameProxyInstance(id: string, name: string): Promise<OperationResult>;
  deleteProxyInstance(id: string): Promise<OperationResult>;
  selectProjectDirectory(): Promise<OperationResult & { path?: string; canceled?: boolean }>;
  selectEncryptionDirectory(kind: EncryptionDirectoryKind): Promise<OperationResult & { path?: string; canceled?: boolean; preferences?: EncryptionPreferences }>;
  getEncryptionPreferences(): Promise<EncryptionPreferences>;
  saveEncryptionPreferences(patch: EncryptionPreferencesPatch): Promise<OperationResult & { preferences?: EncryptionPreferences }>;
  encryptDirectory(inputDir: string, outputDir: string, mode: EncryptionMode): Promise<EncryptionResult>;
  onEncryptionProgress(listener: (progress: EncryptionProgress) => void): () => void;
  sendRequest(request: ManualRequestConfig): Promise<ManualRequestResponse>;
  start(id?: string): Promise<RuntimeStatus>;
  stop(id?: string): Promise<RuntimeStatus>;
  startAll(): Promise<OperationResult>;
  stopAll(): Promise<OperationResult>;
  status(): Promise<RuntimeStatus>;
  logs(): Promise<LogEntry[]>;
  clearLogs(): Promise<OperationResult>;
}

export const IPC_CHANNELS = {
  getConfig: "config:get",
  saveConfig: "config:save",
  getSharedValues: "values:shared:get",
  saveSharedValues: "values:shared:save",
  getLoginCache: "values:login:get",
  saveLoginCache: "values:login:save",
  selectProjectDirectory: "config:select-project-directory",
  selectEncryptionDirectory: "encryption:select-directory",
  getEncryptionPreferences: "encryption:get-preferences",
  saveEncryptionPreferences: "encryption:save-preferences",
  encryptDirectory: "encryption:run",
  encryptionProgress: "encryption:progress",
  sendRequest: "request:send",
  listProxyInstances: "proxy-instances:list",
  selectProxyInstance: "proxy-instances:select",
  createProxyInstance: "proxy-instances:create",
  duplicateProxyInstance: "proxy-instances:duplicate",
  renameProxyInstance: "proxy-instances:rename",
  deleteProxyInstance: "proxy-instances:delete",
  start: "runtime:start",
  stop: "runtime:stop",
  startAll: "runtime:start-all",
  stopAll: "runtime:stop-all",
  status: "runtime:status",
  logs: "runtime:logs",
  clearLogs: "runtime:logs:clear",
} as const;

declare global {
  interface Window {
    forwarder: ForwarderApi;
  }
}
