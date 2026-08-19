import os from "node:os";
import path from "node:path";
import type { AppConfig, LogEntry, RuntimeStatus } from "../../shared/contracts";
import { getAppConfigValidationError, isValidAppConfig } from "../../shared/validation";
import { ConfigStore } from "../config/config-store";
import { FileCache } from "../cache/file-cache";
import { HttpProxy, type HttpProxyAddress, type HttpProxyOptions, type HttpProxyStats, type TcpBridgeLike } from "../http/http-proxy";
import { TcpBridgePool } from "../tcp/tcp-bridge";
import { createTztCodec } from "../tcp/tzt-codec";

interface HttpRuntime extends TcpBridgeLike {
  start(): Promise<HttpProxyAddress>;
  stop(): Promise<void>;
  getStats(): HttpProxyStats;
  getValues(): { localValues: Record<string, string>; mapValues: Record<string, string>; fileValues: Record<string, string> };
}

export interface ForwardingServiceOptions {
  config: AppConfig;
  configStore?: ConfigStore;
  httpFactory?: (options: HttpProxyOptions) => HttpRuntime;
  tcpFactory?: (options: ConstructorParameters<typeof TcpBridgePool>[0]) => TcpBridgeLike & { close(): Promise<void>; getConnectionCount?: () => number };
  cacheFactory?: (options: { rootDir: string }) => Pick<FileCache, "close" | "getOrDownload" | "remove">;
}

function cloneConfig(config: AppConfig): AppConfig {
  return JSON.parse(JSON.stringify(config)) as AppConfig;
}

export class ForwardingService {
  private config: AppConfig;
  private readonly configStore?: ConfigStore;
  private readonly httpFactory: (options: HttpProxyOptions) => HttpRuntime;
  private readonly tcpFactory: NonNullable<ForwardingServiceOptions["tcpFactory"]>;
  private readonly cacheFactory: NonNullable<ForwardingServiceOptions["cacheFactory"]>;
  private http: HttpRuntime | undefined;
  private tcp: (TcpBridgeLike & { close(): Promise<void>; getConnectionCount?: () => number }) | undefined;
  private cache: Pick<FileCache, "close" | "getOrDownload" | "remove"> | undefined;
  private state: RuntimeStatus["state"] = "stopped";
  private error: string | undefined;
  private readonly logBuffer: LogEntry[] = [];
  private configSaveQueue: Promise<void> = Promise.resolve();
  private address: HttpProxyAddress | undefined;

  public constructor(options: ForwardingServiceOptions) {
    this.config = cloneConfig(options.config);
    this.configStore = options.configStore;
    this.httpFactory = options.httpFactory ?? ((httpOptions) => new HttpProxy(httpOptions) as unknown as HttpRuntime);
    this.tcpFactory = options.tcpFactory ?? ((tcpOptions) => new TcpBridgePool(tcpOptions));
    this.cacheFactory = options.cacheFactory ?? ((cacheOptions) => new FileCache(cacheOptions));
  }

  public async start(): Promise<RuntimeStatus> {
    if (this.state === "running" || this.state === "starting") return this.status();
    const validationError = getAppConfigValidationError(this.config);
    if (validationError !== undefined || !isValidAppConfig(this.config)) {
      this.state = "error";
      this.error = `Invalid configuration: ${validationError ?? "unknown field"}`;
      this.appendLog("error", this.error);
      throw new Error(this.error);
    }
    this.state = "starting";
    this.error = undefined;
    const created: Array<() => Promise<void>> = [];
    try {
      const rootDir = this.config.cache.rootDir || path.join(os.tmpdir(), "local-forwarder-cache");
      this.cache = this.cacheFactory({ rootDir });
      created.push(async () => { await this.cache?.close(); this.cache = undefined; });
      this.tcp = this.tcpFactory({ connectTimeoutMs: this.config.server.timeoutMs, requestTimeoutMs: this.config.server.timeoutMs });
      created.push(async () => { await this.tcp?.close(); this.tcp = undefined; });
      this.http = this.httpFactory({
        bindHost: this.config.server.bindHost,
        port: this.config.server.port,
        timeoutMs: this.config.server.timeoutMs,
        projectPath: this.config.projectPath,
        rules: this.config.httpRules,
        localValues: this.config.localValues,
        mapValues: this.config.mapValues,
        fileValues: Object.fromEntries(Object.entries(this.config.legacy?.files ?? {}).filter(([, value]) => typeof value === "string")) as Record<string, string>,
        accounts: this.config.accounts,
        tcpTargets: this.config.tcpTargets,
        tcpBridge: this.tcp,
        cache: this.cache,
        cacheConfig: this.config.cache,
        cacheCodec: this.config.cache.decryptEnabled ? createTztCodec() : undefined,
        onLog: (entry) => this.appendLogEntry(entry),
        onLocalValuesChanged: (values) => this.persistLocalValues(values),
      });
      created.push(async () => { await this.http?.stop(); this.http = undefined; });
      this.address = await this.http.start();
      this.state = "running";
      this.appendLog("info", `Forwarding service started on ${this.address.host}:${this.address.port}`);
      return this.status();
    } catch (error) {
      this.state = "error";
      this.error = error instanceof Error ? error.message : "service start failed";
      this.appendLog("error", this.error);
      for (const cleanup of created.reverse()) await cleanup().catch(() => undefined);
      this.address = undefined;
      throw error;
    }
  }

  public async stop(): Promise<RuntimeStatus> {
    if (this.state === "stopped") return this.status();
    this.state = "stopping";
    await this.http?.stop().catch(() => undefined);
    this.http = undefined;
    await this.tcp?.close().catch(() => undefined);
    this.tcp = undefined;
    await this.cache?.close().catch(() => undefined);
    this.cache = undefined;
    this.address = undefined;
    this.state = "stopped";
    this.error = undefined;
    return this.status();
  }

  public status(): RuntimeStatus {
    const stats = this.http?.getStats();
    return {
      state: this.state,
      requestCount: stats?.requestCount ?? 0,
      tcpConnections: this.tcp?.getConnectionCount?.() ?? stats?.tcpConnections ?? 0,
      error: this.error,
    };
  }

  public getConfig(): AppConfig {
    if (this.http !== undefined) {
      const values = this.http.getValues();
      this.config.localValues = values.localValues;
      this.config.mapValues = values.mapValues;
      if (this.config.legacy !== undefined) this.config.legacy.files = values.fileValues;
    }
    return cloneConfig(this.config);
  }

  public async saveConfig(config: AppConfig): Promise<void> {
    if (!isValidAppConfig(config)) throw new Error(`Invalid configuration: ${getAppConfigValidationError(config) ?? "unknown field"}`);
    if (this.state === "running") throw new Error("stop the service before changing configuration");
    this.config = cloneConfig(config);
    await this.configStore?.save(this.config);
  }

  public getLogs(): LogEntry[] {
    return this.logBuffer.map((entry) => ({ ...entry }));
  }

  private appendLog(level: LogEntry["level"], message: string): void {
    this.appendLogEntry({ timestamp: new Date().toISOString(), level, message });
  }

  private appendLogEntry(entry: LogEntry): void {
    if (!this.config.server.loggingEnabled && entry.level !== "error") return;
    this.logBuffer.push(entry);
    if (this.logBuffer.length > 2000) this.logBuffer.splice(0, this.logBuffer.length - 2000);
  }

  private persistLocalValues(values: Record<string, string>): void {
    this.config.localValues = { ...values };
    if (this.configStore === undefined) return;
    const snapshot = cloneConfig(this.config);
    this.configSaveQueue = this.configSaveQueue
      .then(() => this.configStore?.save(snapshot))
      .catch((error) => this.appendLog("error", error instanceof Error ? error.message : "login cache save failed"));
  }
}
