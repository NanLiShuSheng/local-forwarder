export interface UpdateLifecycleGate {
  beginInstall(): void;
  endInstall(): void;
  trackStart<T>(operation: () => Promise<T>): Promise<T>;
  waitForStarts(): Promise<void>;
}

const INSTALL_IN_PROGRESS_ERROR = "更新安装中，请稍候";

export function createUpdateLifecycleGate(): UpdateLifecycleGate {
  let installInProgress = false;
  const activeStarts = new Set<Promise<unknown>>();

  function beginInstall(): void {
    installInProgress = true;
  }

  function endInstall(): void {
    installInProgress = false;
  }

  function trackStart<T>(operation: () => Promise<T>): Promise<T> {
    if (installInProgress) throw new Error(INSTALL_IN_PROGRESS_ERROR);
    const promise = Promise.resolve().then(operation);
    activeStarts.add(promise);
    void promise.then(
      () => activeStarts.delete(promise),
      () => activeStarts.delete(promise),
    );
    return promise;
  }

  async function waitForStarts(): Promise<void> {
    while (activeStarts.size > 0) {
      await Promise.all([...activeStarts]);
    }
  }

  return { beginInstall, endInstall, trackStart, waitForStarts };
}
