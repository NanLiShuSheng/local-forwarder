import assert from "node:assert/strict";
import test from "node:test";
import { createUpdateStateSynchronizer, resolveManualCheckResult } from "../../src/renderer/update-state";

test("manual update checks stop waiting after an available update", () => {
  assert.deepEqual(resolveManualCheckResult(true, "available"), { pending: false, notifyLatest: false });
});

test("manual update checks notify once when no update is available", () => {
  assert.deepEqual(resolveManualCheckResult(true, "not-available"), { pending: false, notifyLatest: true });
  assert.deepEqual(resolveManualCheckResult(false, "not-available"), { pending: false, notifyLatest: false });
});

test("manual update checks clear pending for every terminal state", () => {
  for (const state of ["idle", "available", "downloaded", "error"] as const) {
    assert.deepEqual(resolveManualCheckResult(true, state), { pending: false, notifyLatest: false });
  }
  assert.deepEqual(resolveManualCheckResult(true, "checking"), { pending: true, notifyLatest: false });
});

test("a realtime update state cannot be overwritten by a stale initial snapshot", () => {
  const applied: string[] = [];
  const synchronizer = createUpdateStateSynchronizer(
    { state: "idle", currentVersion: "1.0.0" },
    (state) => applied.push(state.state),
  );

  synchronizer.receiveEvent({ state: "available", currentVersion: "1.0.0", update: { version: "1.1.0" } });
  synchronizer.receiveSnapshot({ state: "idle", currentVersion: "1.0.0" });

  assert.deepEqual(applied, ["available"]);
  assert.equal(synchronizer.getState().state, "available");
});

test("an initial update snapshot is applied when no realtime event arrived", () => {
  const applied: string[] = [];
  const synchronizer = createUpdateStateSynchronizer(
    { state: "idle", currentVersion: "" },
    (state) => applied.push(state.state),
  );

  synchronizer.receiveSnapshot({ state: "not-available", currentVersion: "1.0.0" });

  assert.deepEqual(applied, ["not-available"]);
  assert.equal(synchronizer.getRevision(), 0);
});
