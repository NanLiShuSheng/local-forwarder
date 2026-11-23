import assert from "node:assert/strict";
import test from "node:test";
import {
  compareUpdateVersions,
  DISMISSED_UPDATE_VERSION_STORAGE_KEY,
  isUpdateVersionNewer,
  readDismissedUpdateVersion,
  writeDismissedUpdateVersion,
  type UpdateDismissalStorage,
} from "../../src/renderer/update-dismissal";

function statefulStorage(initialValue: string | null): UpdateDismissalStorage {
  let value = initialValue;
  return {
    getItem: (key) => {
      assert.equal(key, DISMISSED_UPDATE_VERSION_STORAGE_KEY);
      return value;
    },
    setItem: (key, nextValue) => {
      assert.equal(key, DISMISSED_UPDATE_VERSION_STORAGE_KEY);
      value = nextValue;
    },
  };
}

test("reads and writes the dismissed update version", () => {
  const storage = statefulStorage(null);

  assert.equal(readDismissedUpdateVersion(storage), undefined);
  writeDismissedUpdateVersion(storage, "0.3.4");
  assert.equal(readDismissedUpdateVersion(storage), "0.3.4");
});

test("ignores blank dismissed update versions", () => {
  assert.equal(readDismissedUpdateVersion(statefulStorage("   ")), undefined);
  assert.equal(readDismissedUpdateVersion(undefined), undefined);
});

test("update dismissal persistence is best effort", () => {
  const storage: UpdateDismissalStorage = {
    getItem: () => {
      throw new Error("storage unavailable");
    },
    setItem: () => {
      throw new Error("storage unavailable");
    },
  };

  assert.equal(readDismissedUpdateVersion(storage), undefined);
  assert.doesNotThrow(() => writeDismissedUpdateVersion(storage, "0.3.4"));
});

test("compares semantic update versions", () => {
  assert.equal(compareUpdateVersions("2.0.4", "2.0.3"), 1);
  assert.equal(compareUpdateVersions("v2.0.3", "2.0.3"), 0);
  assert.equal(compareUpdateVersions("2.0.3", "2.0.4"), -1);
  assert.equal(compareUpdateVersions("2.0.3-beta.2", "2.0.3-beta.1"), 1);
  assert.equal(compareUpdateVersions("2.0.3", "2.0.3-beta.2"), 1);
  assert.equal(compareUpdateVersions("2.0.3+build.7", "2.0.3+build.4"), 0);
  assert.equal(compareUpdateVersions("invalid", "2.0.3"), undefined);
});

test("only a newer online version overrides a dismissed version", () => {
  assert.equal(isUpdateVersionNewer("2.0.4", undefined), true);
  assert.equal(isUpdateVersionNewer("2.0.4", "2.0.4"), false);
  assert.equal(isUpdateVersionNewer("2.0.3", "2.0.4"), false);
  assert.equal(isUpdateVersionNewer("2.0.5", "2.0.4"), true);
});
