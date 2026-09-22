import assert from "node:assert/strict";
import test from "node:test";
import { createManualCheckTracker, createUpdateStateSynchronizer, resolveManualCheckResult } from "../../src/renderer/update-state";

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

  const staleSnapshot = synchronizer.beginSnapshot();
  synchronizer.receiveEvent({ state: "available", currentVersion: "1.0.0", update: { version: "1.1.0" } });
  assert.equal(synchronizer.receiveSnapshot(staleSnapshot, { state: "idle", currentVersion: "1.0.0" }), false);

  assert.deepEqual(applied, ["available"]);
  assert.equal(synchronizer.getState().state, "available");
});

test("an initial update snapshot is applied when no realtime event arrived", () => {
  const applied: string[] = [];
  const synchronizer = createUpdateStateSynchronizer(
    { state: "idle", currentVersion: "" },
    (state) => applied.push(state.state),
  );

  const snapshot = synchronizer.beginSnapshot();
  assert.equal(synchronizer.receiveSnapshot(snapshot, { state: "not-available", currentVersion: "1.0.0" }), true);

  assert.deepEqual(applied, ["not-available"]);
  assert.equal(synchronizer.getState().state, "not-available");
});

test("a newer snapshot request wins when responses return out of order", () => {
  const applied: string[] = [];
  const synchronizer = createUpdateStateSynchronizer(
    { state: "idle", currentVersion: "1.0.0" },
    (state) => applied.push(state.state),
  );
  const first = synchronizer.beginSnapshot();
  const second = synchronizer.beginSnapshot();

  assert.equal(synchronizer.receiveSnapshot(first, { state: "available", currentVersion: "1.0.0", update: { version: "1.1.0" } }), false);
  assert.equal(synchronizer.receiveSnapshot(second, { state: "not-available", currentVersion: "1.0.0" }), true);
  assert.deepEqual(applied, ["not-available"]);
});

test("an older manual check cannot complete a newer request", () => {
  const tracker = createManualCheckTracker();
  const first = tracker.begin();
  const second = tracker.begin();

  assert.equal(tracker.complete(first), false);
  assert.equal(tracker.isCurrent(second), true);
  assert.equal(tracker.complete(second), true);
  assert.equal(tracker.hasPending(), false);
});
