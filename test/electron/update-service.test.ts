import assert from "node:assert/strict";
import test from "node:test";
import type {
  UpdateAdapter,
  UpdateService,
  UpdateServiceOptions,
} from "../../electron/update-service";
import type {
  UpdateInfoSnapshot,
  UpdateProgressSnapshot,
  UpdateState,
} from "../../src/shared/contracts";
import { createUpdateService } from "../../electron/update-service";

const update: UpdateInfoSnapshot = {
  version: "1.2.3",
  releaseDate: "2026-09-21T10:00:00.000Z",
  releaseNotes: "修复稳定性问题",
};

class Deferred<T> {
  promise: Promise<T>;
  resolve!: (value: T) => void;
  reject!: (error: unknown) => void;

  constructor() {
    this.promise = new Promise<T>((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }
}

class FakeAdapter implements UpdateAdapter {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  checkCalls = 0;
  downloadCalls = 0;
  quitAndInstallCalls = 0;
  checkDeferred?: Deferred<unknown>;
  downloadDeferred?: Deferred<unknown>;
  private checkingListeners = new Set<() => void>();
  private availableListeners = new Set<(info: UpdateInfoSnapshot) => void>();
  private notAvailableListeners = new Set<() => void>();
  private progressListeners = new Set<(progress: UpdateProgressSnapshot) => void>();
  private downloadedListeners = new Set<(info: UpdateInfoSnapshot) => void>();
  private errorListeners = new Set<(error: unknown) => void>();

  onCheckingForUpdate(listener: () => void): () => void {
    return this.add(this.checkingListeners, listener);
  }

  onUpdateAvailable(listener: (info: UpdateInfoSnapshot) => void): () => void {
    return this.add(this.availableListeners, listener);
  }

  onUpdateNotAvailable(listener: () => void): () => void {
    return this.add(this.notAvailableListeners, listener);
  }

  onDownloadProgress(listener: (progress: UpdateProgressSnapshot) => void): () => void {
    return this.add(this.progressListeners, listener);
  }

  onUpdateDownloaded(listener: (info: UpdateInfoSnapshot) => void): () => void {
    return this.add(this.downloadedListeners, listener);
  }

  onError(listener: (error: unknown) => void): () => void {
    return this.add(this.errorListeners, listener);
  }

  checkForUpdates(): Promise<unknown> {
    this.checkCalls += 1;
    this.checkDeferred ??= new Deferred<unknown>();
    return this.checkDeferred.promise;
  }

  downloadUpdate(): Promise<unknown> {
    this.downloadCalls += 1;
    this.downloadDeferred ??= new Deferred<unknown>();
    return this.downloadDeferred.promise;
  }

  quitAndInstall(): void {
    this.quitAndInstallCalls += 1;
  }

  emitChecking(): void {
    for (const listener of this.checkingListeners) listener();
  }

  emitAvailable(info = update): void {
    for (const listener of this.availableListeners) listener(info);
  }

  emitNotAvailable(): void {
    for (const listener of this.notAvailableListeners) listener();
  }

  emitProgress(progress: UpdateProgressSnapshot): void {
    for (const listener of this.progressListeners) listener(progress);
  }

  emitDownloaded(info = update): void {
    for (const listener of this.downloadedListeners) listener(info);
  }

  emitError(error: unknown): void {
    for (const listener of this.errorListeners) listener(error);
  }

  listenerCount(): number {
    return [
      this.checkingListeners,
      this.availableListeners,
      this.notAvailableListeners,
      this.progressListeners,
      this.downloadedListeners,
      this.errorListeners,
    ].reduce((total, listeners) => total + listeners.size, 0);
  }

  private add<T>(listeners: Set<T>, listener: T): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }
}

function createHarness(overrides: Partial<UpdateServiceOptions> = {}): {
  adapter: FakeAdapter;
  service: UpdateService;
  states: UpdateState[];
  stopAll: () => Promise<{ ok: boolean; error?: string }>;
} {
  const adapter = new FakeAdapter();
  const states: UpdateState[] = [];
  const stopAll = async () => ({ ok: true });
  const service = createUpdateService({
    currentVersion: "1.0.0",
    isPackaged: true,
    isSmokeMode: false,
    updater: adapter,
    stopAll,
    publish: (state) => states.push(state),
    ...overrides,
  });
  return { adapter, service, states, stopAll };
}

test("configures the updater to require explicit download and install", () => {
  const { adapter, service } = createHarness();

  assert.equal(adapter.autoDownload, false);
  assert.equal(adapter.autoInstallOnAppQuit, false);
  service.dispose();
});

test("maps update available and retains release metadata", async () => {
  const { adapter, service } = createHarness();

  const check = service.check();
  adapter.emitAvailable();
  adapter.checkDeferred?.resolve({});
  await check;

  assert.deepEqual(service.getState(), {
    state: "available",
    currentVersion: "1.0.0",
    update,
  });
  service.dispose();
});

test("does not download on availability and downloads only when explicitly requested", async () => {
  const { adapter, service } = createHarness();

  const check = service.check();
  adapter.emitAvailable();
  adapter.checkDeferred?.resolve({});
  await check;
  assert.equal(adapter.downloadCalls, 0);

  const download = service.download();
  assert.equal(adapter.downloadCalls, 1);
  adapter.downloadDeferred?.resolve({});
  await download;
  service.dispose();
});

test("maps and clamps download progress", async () => {
  const { adapter, service } = createHarness();

  const download = service.download();
  adapter.emitProgress({ percent: 142, transferred: 50, total: 100, bytesPerSecond: 20 });
  assert.deepEqual(service.getState(), {
    state: "downloading",
    currentVersion: "1.0.0",
    progress: { percent: 100, transferred: 50, total: 100, bytesPerSecond: 20 },
  });
  adapter.downloadDeferred?.resolve({});
  await download;

  service.dispose();
});

test("maps downloaded and not-available events", async () => {
  const { adapter, service } = createHarness();

  const download = service.download();
  adapter.emitDownloaded();
  adapter.downloadDeferred?.resolve({});
  await download;
  assert.deepEqual(service.getState(), { state: "downloaded", currentVersion: "1.0.0", update });

  const check = service.check();
  adapter.emitNotAvailable();
  adapter.checkDeferred?.resolve({});
  await check;
  assert.deepEqual(service.getState(), { state: "not-available", currentVersion: "1.0.0" });
  service.dispose();
});

test("publishes a Chinese fallback instead of exposing adapter errors", async () => {
  const { adapter, service, states } = createHarness();

  const check = service.check();
  adapter.emitError(new Error("GitHub English failure"));
  adapter.checkDeferred?.reject(new Error("GitHub English failure"));
  const result = await check;

  assert.deepEqual(result, { ok: false, error: "检查更新失败" });
  assert.equal(service.getState().state, "error");
  assert.equal(service.getState().error, "检查更新失败");
  assert.equal(states.some((state) => JSON.stringify(state).includes("GitHub English failure")), false);
  service.dispose();
});

test("does not access the adapter in un-packaged or smoke mode", async () => {
  for (const flags of [{ isPackaged: false, isSmokeMode: false }, { isPackaged: true, isSmokeMode: true }]) {
    const { adapter, service } = createHarness(flags);
    assert.deepEqual(await service.check(), { ok: true });
    assert.deepEqual(await service.download(), { ok: true });
    assert.deepEqual(await service.install(), { ok: true });
    assert.equal(adapter.checkCalls, 0);
    assert.equal(adapter.downloadCalls, 0);
    assert.equal(adapter.quitAndInstallCalls, 0);
    service.dispose();
  }
});

test("reuses in-flight check and download promises", async () => {
  const { adapter, service } = createHarness();

  const checkOne = service.check();
  const checkTwo = service.check();
  assert.equal(checkOne, checkTwo);
  assert.equal(adapter.checkCalls, 1);
  adapter.checkDeferred?.resolve({});
  await checkOne;

  const downloadOne = service.download();
  const downloadTwo = service.download();
  assert.equal(downloadOne, downloadTwo);
  assert.equal(adapter.downloadCalls, 1);
  adapter.downloadDeferred?.resolve({});
  await downloadOne;
  service.dispose();
});

test("installs only after stopping all services and can retry after stop failure", async () => {
  const { adapter, service } = createHarness();
  let stopCalls = 0;
  let shouldStop = false;
  const retryable = createUpdateService({
    currentVersion: "1.0.0",
    isPackaged: true,
    isSmokeMode: false,
    updater: adapter,
    stopAll: async () => {
      stopCalls += 1;
      if (!shouldStop) return { ok: false, error: "停止失败" };
      return { ok: true };
    },
    publish: () => undefined,
  });

  assert.deepEqual(await retryable.install(), { ok: false, error: "安装更新失败" });
  assert.equal(stopCalls, 0);

  const download = retryable.download();
  adapter.emitDownloaded();
  adapter.downloadDeferred?.resolve({});
  await download;

  assert.deepEqual(await retryable.install(), { ok: false, error: "安装更新失败" });
  assert.equal(stopCalls, 1);
  assert.equal(adapter.quitAndInstallCalls, 0);

  shouldStop = true;
  assert.deepEqual(await retryable.install(), { ok: true });
  assert.equal(stopCalls, 2);
  assert.equal(adapter.quitAndInstallCalls, 1);
  retryable.dispose();
  service.dispose();
});

test("dispose removes listeners and clears the delayed background check", async () => {
  const { adapter, service } = createHarness();

  await service.startBackgroundCheck();
  assert.ok(adapter.listenerCount() > 0);
  service.dispose();
  assert.equal(adapter.listenerCount(), 0);
});

test("schedules one unref'd background check after ten seconds", async () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  let timerCalls = 0;
  let delay: number | undefined;
  let callback: (() => void) | undefined;
  globalThis.setTimeout = ((handler: Parameters<typeof setTimeout>[0], timeout?: Parameters<typeof setTimeout>[1]) => {
    timerCalls += 1;
    delay = timeout;
    callback = handler as () => void;
    return { unref: () => undefined } as unknown as ReturnType<typeof setTimeout>;
  }) as typeof globalThis.setTimeout;
  globalThis.clearTimeout = (() => undefined) as typeof globalThis.clearTimeout;

  try {
    const { adapter, service } = createHarness();
    await service.startBackgroundCheck();
    await service.startBackgroundCheck();
    assert.equal(timerCalls, 1);
    assert.equal(delay, 10_000);

    callback?.();
    assert.equal(adapter.checkCalls, 1);
    adapter.checkDeferred?.resolve({});
    await Promise.resolve();
    await service.startBackgroundCheck();
    assert.equal(timerCalls, 1);
    service.dispose();
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});
