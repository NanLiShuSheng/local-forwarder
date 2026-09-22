import assert from "node:assert/strict";
import test from "node:test";
import { createUpdateLifecycleGate } from "../../electron/update-lifecycle";

class Deferred<T> {
  promise: Promise<T>;
  resolve!: (value: T) => void;

  constructor() {
    this.promise = new Promise<T>((resolve) => {
      this.resolve = resolve;
    });
  }
}

test("waits for a start operation that entered before update installation", async () => {
  const gate = createUpdateLifecycleGate();
  const startDeferred = new Deferred<void>();
  let startFinished = false;

  const start = gate.trackStart(async () => {
    await startDeferred.promise;
    startFinished = true;
  });
  gate.beginInstall();
  const waitForStarts = gate.waitForStarts();
  await Promise.resolve();

  assert.equal(startFinished, false);
  startDeferred.resolve();
  await start;
  await waitForStarts;
  assert.equal(startFinished, true);
});

test("rejects new starts while installation is locked and allows them after release", async () => {
  const gate = createUpdateLifecycleGate();
  gate.beginInstall();

  assert.throws(() => gate.trackStart(async () => undefined), /更新安装中，请稍候/);

  gate.endInstall();
  await gate.trackStart(async () => undefined);
});
