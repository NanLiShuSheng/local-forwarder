import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_LOG_TYPE,
  LOG_TYPE_STORAGE_KEY,
  getLogTypeStorage,
  readLogType,
  writeLogType,
  type LogTypeStorage,
} from "../../src/renderer/log-type-preference";

function statefulStorage(initialValue: string | null): LogTypeStorage {
  let value = initialValue;

  return {
    getItem: (key) => {
      assert.equal(key, LOG_TYPE_STORAGE_KEY);
      return value;
    },
    setItem: (key, nextValue) => {
      assert.equal(key, LOG_TYPE_STORAGE_KEY);
      value = nextValue;
    },
  };
}

test("readLogType falls back to reqxml for missing, null, and blank values", () => {
  assert.equal(readLogType(statefulStorage(null)), DEFAULT_LOG_TYPE);
  assert.equal(readLogType(statefulStorage("")), DEFAULT_LOG_TYPE);
  assert.equal(readLogType(statefulStorage("   ")), DEFAULT_LOG_TYPE);
});

test("writeLogType and readLogType round-trip all and dynamic pathnames", () => {
  const storage = statefulStorage(null);

  writeLogType(storage, "all");
  assert.equal(readLogType(storage), "all");

  writeLogType(storage, "/api/data");
  assert.equal(readLogType(storage), "/api/data");
});

test("storage access errors fall back on read and do not throw on write", () => {
  const storage: LogTypeStorage = {
    getItem: () => {
      throw new Error("storage unavailable");
    },
    setItem: () => {
      throw new Error("storage unavailable");
    },
  };

  assert.equal(readLogType(storage), DEFAULT_LOG_TYPE);
  assert.doesNotThrow(() => writeLogType(storage, "/reqreadmap"));
});

test("helpers tolerate an undefined storage adapter", () => {
  assert.equal(readLogType(undefined), DEFAULT_LOG_TYPE);
  assert.doesNotThrow(() => writeLogType(undefined, "/reqreadmap"));
});

test("getLogTypeStorage returns undefined during SSR", () => {
  assert.equal(getLogTypeStorage(), undefined);
});
