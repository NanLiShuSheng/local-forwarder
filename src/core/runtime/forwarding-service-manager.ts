import crypto from "node:crypto";
import path from "node:path";
import type { AppConfig, LogEntry, ProxyInstance, ProxyInstanceSummary, ProxyWorkspace, RuntimeStatus } from "../../shared/contracts";
import { createDefaultConfig } from "../config/model";
import { ForwardingService, type ForwardingServiceOptions } from "./forwarding-service";

export interface ManagedForwardingService {
  start(): Promise<RuntimeStatus>;
  stop(): Promise<RuntimeStatus>;
  status(): RuntimeStatus;
  getConfig(): AppConfig;
  saveConfig(config: AppConfig): Promise<void>;
  getLogs(): LogEntry[];
  mergeLocalValues(values: Record<string, string>): void;
}

interface WorkspacePersistence {
  save(workspace: ProxyWorkspace): Promise<void>;
}

export interface ForwardingServiceManagerOptions {
  workspace: ProxyWorkspace;
  workspaceStore: WorkspacePersistence;
  serviceFactory?: (config: AppConfig, configStore: ForwardingServiceOptions["configStore"]) => ManagedForwardingService;
  defaultCacheRoot?: string;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isWildcardHost(host: string): boolean {
  return host === "0.0.0.0" || host === "::" || host === "[::]";
}

function hostsConflict(left: string, right: string): boolean {
  return left === right || isWildcardHost(left) || isWildcardHost(right);
}

function targetForConfig(config: AppConfig): string {
  const jyTarget = config.tcpTargets.find((target) => target.id.toLowerCase() === "jy" || target.name.toLowerCase() === "jy");
  const tcpTarget = jyTarget ?? config.tcpTargets[1] ?? config.tcpTargets.find((target) => target.enabled) ?? config.tcpTargets[0];
  if (tcpTarget !== undefined) return `${tcpTarget.host}:${tcpTarget.port}`;
  const httpTarget = config.httpRules.find((rule) => rule.enabled)?.target ?? config.httpRules[0]?.target;
  return httpTarget ?? "未配置";
}

export class ForwardingServiceManager {
  private workspace: ProxyWorkspace;
  private readonly workspaceStore: WorkspacePersistence;
  private readonly defaultCacheRoot: string | undefined;
  private readonly serviceFactory: NonNullable<ForwardingServiceManagerOptions["serviceFactory"]>;
  private readonly services = new Map<string, ManagedForwardingService>();
  private saveQueue: Promise<void> = Promise.resolve();

  public constructor(options: ForwardingServiceManagerOptions) {
    this.workspace = clone(options.workspace);
    this.workspaceStore = options.workspaceStore;
    this.defaultCacheRoot = options.defaultCacheRoot;
    this.serviceFactory = options.serviceFactory ?? ((config, configStore) => new ForwardingService({ config, configStore }));
    for (const instance of this.workspace.instances) {
      this.createService(instance);
    }
  }

  public getSelectedInstanceId(): string {
    return this.workspace.selectedInstanceId;
  }

  public async select(id: string): Promise<void> {
    this.requireInstance(id);
    this.workspace.selectedInstanceId = id;
    await this.persist();
  }

  public list(): ProxyInstanceSummary[] {
    return this.workspace.instances.map((instance) => this.summary(instance));
  }

  public async create(): Promise<ProxyInstanceSummary> {
    const id = this.newId();
    const config = createDefaultConfig();
    const selected = this.currentInstance();
    config.server.bindHost = selected.config.server.bindHost;
    config.server.port = this.nextPort();
    this.assignCacheRoot(config, id);
    const instance: ProxyInstance = { id, name: `代理实例 ${this.workspace.instances.length + 1}`, config };
    this.workspace.instances.push(instance);
    this.workspace.selectedInstanceId = id;
    this.createService(instance);
    await this.persist();
    return this.summary(instance);
  }

  public async duplicate(): Promise<ProxyInstanceSummary> {
    const source = this.currentInstance();
    const id = this.newId();
    const config = clone(source.config);
    config.server.port = this.nextPort();
    this.assignCacheRoot(config, id);
    const instance: ProxyInstance = { id, name: `${source.name} 副本`, config };
    this.workspace.instances.push(instance);
    this.workspace.selectedInstanceId = id;
    this.createService(instance);
    await this.persist();
    return this.summary(instance);
  }

  public getConfig(id = this.workspace.selectedInstanceId): AppConfig {
    return this.requireService(id).getConfig();
  }

  public async saveConfig(config: AppConfig): Promise<void> {
    await this.requireService().saveConfig(config);
  }

  public async start(id = this.workspace.selectedInstanceId): Promise<RuntimeStatus> {
    const instance = this.requireInstance(id);
    this.assertPortAvailable(instance);
    return this.requireService(id).start();
  }

  public async stop(id = this.workspace.selectedInstanceId): Promise<RuntimeStatus> {
    return this.requireService(id).stop();
  }

  public status(id = this.workspace.selectedInstanceId): RuntimeStatus {
    return this.requireService(id).status();
  }

  public getLogs(id = this.workspace.selectedInstanceId): LogEntry[] {
    return this.requireService(id).getLogs();
  }

  public mergeLocalValues(values: Record<string, string>): void {
    this.requireService().mergeLocalValues(values);
  }

  public async stopAll(): Promise<void> {
    for (const service of this.services.values()) {
      if (service.status().state !== "stopped") await service.stop().catch(() => undefined);
    }
  }

  private currentInstance(): ProxyInstance {
    return this.requireInstance(this.workspace.selectedInstanceId);
  }

  private requireInstance(id: string): ProxyInstance {
    const instance = this.workspace.instances.find((candidate) => candidate.id === id);
    if (instance === undefined) throw new Error("代理实例不存在");
    return instance;
  }

  private requireService(id = this.workspace.selectedInstanceId): ManagedForwardingService {
    this.requireInstance(id);
    const service = this.services.get(id);
    if (service === undefined) throw new Error("代理实例不存在");
    return service;
  }

  private createService(instance: ProxyInstance): void {
    this.services.set(instance.id, this.serviceFactory(instance.config, { save: (config) => this.persistConfig(instance.id, config) }));
  }

  private summary(instance: ProxyInstance): ProxyInstanceSummary {
    const config = instance.config;
    return {
      id: instance.id,
      name: instance.name,
      selected: instance.id === this.workspace.selectedInstanceId,
      bindHost: config.server.bindHost,
      port: config.server.port,
      target: targetForConfig(config),
      status: this.requireService(instance.id).status(),
    };
  }

  private assertPortAvailable(instance: ProxyInstance): void {
    for (const other of this.workspace.instances) {
      if (other.id === instance.id) continue;
      const state = this.requireService(other.id).status().state;
      if ((state === "running" || state === "starting") && other.config.server.port === instance.config.server.port && hostsConflict(other.config.server.bindHost, instance.config.server.bindHost)) {
        throw new Error(`端口 ${instance.config.server.port} 已被${other.name}占用`);
      }
    }
  }

  private nextPort(): number {
    const ports = this.workspace.instances.map((instance) => instance.config.server.port);
    let candidate = ports.length === 0 ? 8080 : Math.max(8080, ...ports) + 1;
    while (ports.includes(candidate)) candidate += 1;
    return candidate;
  }

  private assignCacheRoot(config: AppConfig, id: string): void {
    if (this.defaultCacheRoot !== undefined) {
      config.cache.rootDir = path.join(this.defaultCacheRoot, id);
    } else if (config.cache.rootDir !== "") {
      config.cache.rootDir = `${config.cache.rootDir}-${id}`;
    }
  }

  private newId(): string {
    let id = `proxy-${crypto.randomUUID()}`;
    while (this.workspace.instances.some((instance) => instance.id === id)) id = `proxy-${crypto.randomUUID()}`;
    return id;
  }

  private persistConfig(id: string, config: AppConfig): Promise<void> {
    const instance = this.requireInstance(id);
    instance.config = clone(config);
    return this.persist();
  }

  private persist(): Promise<void> {
    const snapshot = clone(this.workspace);
    const result = this.saveQueue.then(() => this.workspaceStore.save(snapshot), () => this.workspaceStore.save(snapshot));
    this.saveQueue = result.then(() => undefined, () => undefined);
    return result;
  }
}
