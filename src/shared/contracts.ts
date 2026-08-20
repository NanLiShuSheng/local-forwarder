export type RuntimeState = "stopped" | "starting" | "running" | "stopping" | "error";

export interface ForwardRule {
  id: string;
  name: string;
  match: string;
  target: string;
  rewrite?: string;
  enabled: boolean;
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
}

export interface RuntimeStatus {
  state: RuntimeState;
  requestCount: number;
  tcpConnections: number;
  error?: string;
}

export interface OperationResult {
  ok: boolean;
  error?: string;
}

export type EncryptionDirectoryKind = "input" | "output";

export interface EncryptionFileResult {
  relativePath: string;
  outputPath: string;
}

export interface EncryptionResult extends OperationResult {
  totalFiles?: number;
  files?: EncryptionFileResult[];
  logs?: string[];
}

export interface ForwarderApi {
  getConfig(): Promise<AppConfig>;
  saveConfig(config: AppConfig): Promise<OperationResult>;
  importLegacy(): Promise<OperationResult & { config?: AppConfig }>;
  exportConfig(): Promise<OperationResult & { path?: string }>;
  selectProjectDirectory(): Promise<OperationResult & { path?: string; canceled?: boolean }>;
  selectEncryptionDirectory(kind: EncryptionDirectoryKind): Promise<OperationResult & { path?: string; canceled?: boolean }>;
  encryptDirectory(inputDir: string, outputDir: string): Promise<EncryptionResult>;
  start(): Promise<RuntimeStatus>;
  stop(): Promise<RuntimeStatus>;
  status(): Promise<RuntimeStatus>;
  logs(): Promise<LogEntry[]>;
}

export const IPC_CHANNELS = {
  getConfig: "config:get",
  saveConfig: "config:save",
  importLegacy: "config:import-legacy",
  exportConfig: "config:export",
  selectProjectDirectory: "config:select-project-directory",
  selectEncryptionDirectory: "encryption:select-directory",
  encryptDirectory: "encryption:run",
  start: "runtime:start",
  stop: "runtime:stop",
  status: "runtime:status",
  logs: "runtime:logs",
} as const;

declare global {
  interface Window {
    forwarder: ForwarderApi;
  }
}
