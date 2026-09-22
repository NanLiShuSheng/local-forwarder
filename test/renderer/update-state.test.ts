import assert from "node:assert/strict";
import test from "node:test";
import { resolveManualCheckResult } from "../../src/renderer/update-state";

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
