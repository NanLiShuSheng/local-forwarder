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
  clearLogs(): void;
  mergeLocalValues(values: Record<string, string>): void;
  setRuntimeValues?(values: Record<string, string>): void;
  setStoredValues?(mapValues: Record<string, string>, fileValues: Record<string, string>): void;
  applyTcpTargets?(targets: AppConfig["tcpTargets"]): void;
}

interface WorkspacePersistence {
  save(workspace: ProxyWorkspace): Promise<void>;
}

export interface ForwardingServiceManagerOptions {
  workspace: ProxyWorkspace;
  workspaceStore: WorkspacePersistence;
  serviceFactory?: (config: AppConfig, configStore: ForwardingServiceOptions["configStore"], options?: Pick<ForwardingServiceOptions, "onLoginValuesChanged" | "onValuesWritten">) => ManagedForwardingService;
  defaultCacheRoot?: string;
  onValuesChanged?: () => void;
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

const cardTargetLabels = ["hq", "jy", "zx"] as const;

function cardTargetForConfig(config: AppConfig): string | undefined {
  if (config.cardTargetId !== undefined) {
    const index = config.tcpTargets.findIndex((target) => target.id === config.cardTargetId);
    const target = config.tcpTargets[index];
    if (target === undefined) return undefined;
    return `${cardTargetLabels[index] ?? target.name} ${target.host}:${target.port}`;
  }
  const zx = config.tcpTargets[2];
  if (zx === undefined) return undefined;
  return `zx ${zx.host}:${zx.port}`;
}

function targetForConfig(config: AppConfig): string {
  const jyTarget = config.tcpTargets.find((target) => target.id.toLowerCase() === "jy" || target.name.toLowerCase() === "jy");
  const tcpTarget = jyTarget ?? config.tcpTargets[1] ?? config.tcpTargets[0];
  if (tcpTarget !== undefined) return `${tcpTarget.host}:${tcpTarget.port}`;
  const httpTarget = config.httpRules.find((rule) => rule.enabled)?.target ?? config.httpRules[0]?.target;
  return httpTarget ?? "未配置";
}

export class ForwardingServiceManager {
  private workspace: ProxyWorkspace;
  private readonly workspaceStore: WorkspacePersistence;
  private readonly defaultCacheRoot: string | undefined;
  private readonly serviceFactory: NonNullable<ForwardingServiceManagerOptions["serviceFactory"]>;
  private readonly onValuesChanged: (() => void) | undefined;
  private readonly services = new Map<string, ManagedForwardingService>();
  private saveQueue: Promise<void> = Promise.resolve();

  public constructor(options: ForwardingServiceManagerOptions) {
    this.workspace = this.normalizeWorkspace(options.workspace);
    this.workspaceStore = options.workspaceStore;
    this.defaultCacheRoot = options.defaultCacheRoot;
    this.onValuesChanged = options.onValuesChanged;
    this.serviceFactory = options.serviceFactory ?? ((config, configStore, serviceOptions) => new ForwardingService({ config, configStore, onLoginValuesChanged: serviceOptions?.onLoginValuesChanged, onValuesWritten: serviceOptions?.onValuesWritten }));
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
    const firstTargets = this.workspace.instances[0]?.config.tcpTargets;
    if (firstTargets !== undefined) config.tcpTargets = clone(firstTargets);
    const firstHistory = this.workspace.instances[0]?.config.forwardingAddressHistory;
    if (firstHistory !== undefined) config.forwardingAddressHistory = clone(firstHistory);
    this.assignCacheRoot(config, id);
    const instance: ProxyInstance = { id, name: `代理实例 ${this.workspace.instances.length + 1}`, config, loginCache: {} };
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
    const instance: ProxyInstance = { id, name: `${source.name} 副本`, config, loginCache: {} };
    this.workspace.instances.push(instance);
    this.workspace.selectedInstanceId = id;
    this.createService(instance);
    await this.persist();
    return this.summary(instance);
  }

  public async rename(id: string, name: string): Promise<void> {
    const normalizedName = name.trim();
    if (normalizedName === "") throw new Error("代理名称不能为空");
    const instance = this.requireInstance(id);
    instance.name = normalizedName;
    await this.persist();
  }

  public async remove(id: string): Promise<void> {
    if (this.workspace.instances.length <= 1) throw new Error("至少保留一个代理实例");
    this.requireInstance(id);
    await this.requireService(id).stop();
    this.services.delete(id);
    this.workspace.instances = this.workspace.instances.filter((candidate) => candidate.id !== id);
    if (this.workspace.selectedInstanceId === id) this.workspace.selectedInstanceId = this.workspace.instances[0]!.id;
    await this.persist();
  }

  public getConfig(id = this.workspace.selectedInstanceId): AppConfig {
    return this.requireService(id).getConfig();
  }

  public async saveConfig(config: AppConfig): Promise<void> {
    const instance = this.currentInstance();
    await this.requireService().saveConfig({ ...config, localValues: this.runtimeValues(instance) });
  }

  public async start(id = this.workspace.selectedInstanceId): Promise<RuntimeStatus> {
    const instance = this.requireInstance(id);
    this.assertPortAvailable(instance);
    return this.requireService(id).start();
  }

  public async stop(id = this.workspace.selectedInstanceId): Promise<RuntimeStatus> {
    return this.requireService(id).stop();
  }

  public async startAll(): Promise<void> {
    const failures: string[] = [];
    for (const instance of this.workspace.instances) {
      const state = this.requireService(instance.id).status().state;
      if (state === "running" || state === "starting") continue;
      try {
        await this.start(instance.id);
      } catch (error) {
        failures.push(`${instance.name}：${error instanceof Error ? error.message : "启动失败"}`);
      }
    }
    if (failures.length > 0) throw new Error(failures.join("；"));
  }

  public status(id = this.workspace.selectedInstanceId): RuntimeStatus {
    return this.requireService(id).status();
  }

  public getLogs(id = this.workspace.selectedInstanceId): LogEntry[] {
    return this.requireService(id).getLogs();
  }

  public clearLogs(id = this.workspace.selectedInstanceId): void {
    this.requireService(id).clearLogs();
  }

  public mergeLocalValues(values: Record<string, string>): void {
    this.mergeLoginCache(values);
  }

  public getSharedValues(): Record<string, string> {
    return { ...(this.workspace.sharedValues ?? {}) };
  }

  public async saveSharedValues(values: Record<string, string>): Promise<void> {
    this.workspace.sharedValues = { ...values };
    for (const instance of this.workspace.instances) this.applyRuntimeValues(instance);
    this.onValuesChanged?.();
    await this.persist();
  }

  public applyForwardingTargets(targets: AppConfig["tcpTargets"], id = this.workspace.selectedInstanceId): void {
    this.requireService(id).applyTcpTargets?.(targets);
  }

  public getLoginCache(id = this.workspace.selectedInstanceId): Record<string, string> {
    return { ...(this.requireInstance(id).loginCache ?? {}) };
  }

  public async saveLoginCache(values: Record<string, string>, id = this.workspace.selectedInstanceId): Promise<void> {
    const instance = this.requireInstance(id);
    instance.loginCache = { ...values };
    this.applyRuntimeValues(instance);
    this.onValuesChanged?.();
    await this.persist();
  }

  public mergeLoginCache(values: Record<string, string>, id = this.workspace.selectedInstanceId): void {
    const instance = this.requireInstance(id);
    instance.loginCache = { ...(instance.loginCache ?? {}), ...values };
    this.applyRuntimeValues(instance);
    this.onValuesChanged?.();
    void this.persist();
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
    this.services.set(instance.id, this.serviceFactory(this.runtimeConfig(instance), { save: (config) => this.persistConfig(instance.id, config) }, {
      onLoginValuesChanged: (values) => this.mergeLoginCache(values, instance.id),
      onValuesWritten: () => this.onValuesChanged?.(),
    }));
  }

  public getStoredValues(id = this.workspace.selectedInstanceId): { mapValues: Record<string, string>; fileValues: Record<string, string> } {
    const config = this.requireService(id).getConfig();
    return {
      mapValues: { ...config.mapValues },
      fileValues: Object.fromEntries(Object.entries(config.legacy?.files ?? {}).filter(([, value]) => typeof value === "string")) as Record<string, string>,
    };
  }

  public async saveStoredValues(values: { mapValues: Record<string, string>; fileValues: Record<string, string> }, id = this.workspace.selectedInstanceId): Promise<void> {
    const instance = this.requireInstance(id);
    const service = this.requireService(id);
    if (service.setStoredValues !== undefined) {
      service.setStoredValues(values.mapValues, values.fileValues);
    } else {
      instance.config.mapValues = { ...values.mapValues };
      const legacy = (instance.config.legacy ??= { files: {}, extra: {} });
      legacy.files = { ...values.fileValues };
    }
    this.onValuesChanged?.();
    await this.persist();
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
      cardTarget: cardTargetForConfig(config),
      loginCacheCount: Object.keys(instance.loginCache ?? {}).length,
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
    instance.config = { ...clone(config), localValues: {} };
    return this.persist();
  }

  private normalizeWorkspace(workspace: ProxyWorkspace): ProxyWorkspace {
    return {
      version: 1,
      selectedInstanceId: workspace.selectedInstanceId,
      sharedValues: { ...(workspace.sharedValues ?? {}) },
      instances: workspace.instances.map((instance) => ({
        ...clone(instance),
        config: { ...clone(instance.config), localValues: {} },
        loginCache: { ...(instance.loginCache ?? instance.config.localValues) },
      })),
    };
  }

  private runtimeValues(instance: ProxyInstance): Record<string, string> {
    return { ...(this.workspace.sharedValues ?? {}), ...(instance.loginCache ?? {}) };
  }

  private runtimeConfig(instance: ProxyInstance): AppConfig {
    return { ...clone(instance.config), localValues: this.runtimeValues(instance) };
  }

  private applyRuntimeValues(instance: ProxyInstance): void {
    this.services.get(instance.id)?.setRuntimeValues?.(this.runtimeValues(instance));
  }

  private persist(): Promise<void> {
    const snapshot = clone(this.workspace);
    const result = this.saveQueue.then(() => this.workspaceStore.save(snapshot), () => this.workspaceStore.save(snapshot));
    this.saveQueue = result.then(() => undefined, () => undefined);
    return result;
  }
}
