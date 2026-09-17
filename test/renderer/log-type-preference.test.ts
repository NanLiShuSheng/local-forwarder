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

function withWindow<T>(windowValue: unknown, callback: () => T): T {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: windowValue });
  try {
    return callback();
  } finally {
    if (descriptor) {
      Object.defineProperty(globalThis, "window", descriptor);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  }
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

test("getLogTypeStorage adapts working browser localStorage", () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const localStorage = statefulStorage(null);

  withWindow({ localStorage }, () => {
    const storage = getLogTypeStorage();
    assert.ok(storage);

    writeLogType(storage, "all");
    assert.equal(readLogType(storage), "all");
    writeLogType(storage, "/api/data");
    assert.equal(readLogType(storage), "/api/data");
  });

  assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis, "window"), originalWindow);
});

test("getLogTypeStorage falls back when window.localStorage access throws", () => {
  const throwingWindow = {};
  Object.defineProperty(throwingWindow, "localStorage", {
    configurable: true,
    get: () => {
      throw new Error("localStorage unavailable");
    },
  });

  withWindow(throwingWindow, () => {
    const storage = getLogTypeStorage();
    assert.equal(storage, undefined);
    assert.equal(readLogType(storage), DEFAULT_LOG_TYPE);
    assert.doesNotThrow(() => writeLogType(storage, "/api/data"));
  });
});

test("getLogTypeStorage contains localStorage method errors", () => {
  const localStorage: LogTypeStorage = {
    getItem: () => {
      throw new Error("getItem unavailable");
    },
    setItem: () => {
      throw new Error("setItem unavailable");
    },
  };

  withWindow({ localStorage }, () => {
    const storage = getLogTypeStorage();
    assert.ok(storage);
    assert.equal(readLogType(storage), DEFAULT_LOG_TYPE);
    assert.doesNotThrow(() => writeLogType(storage, "/api/data"));
  });
});
