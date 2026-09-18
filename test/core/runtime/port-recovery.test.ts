import test from "node:test";
import assert from "node:assert/strict";
import {
  isAutoRecoverablePort,
  parseWindowsListeningProcessIds,
  recoverOccupiedPort,
} from "../../../src/core/runtime/port-recovery";

test("parses Windows netstat listeners for one port and removes duplicate PIDs", () => {
  const output = [
    "  TCP    0.0.0.0:8080       0.0.0.0:0       LISTENING       1234",
    "  TCP    [::]:8080          [::]:0          LISTENING       1234",
    "  TCP    0.0.0.0:8080       0.0.0.0:0       ESTABLISHED     9999",
    "  TCP    0.0.0.0:8081       0.0.0.0:0       LISTENING       5678",
    "  UDP    0.0.0.0:8080       *:*                             2468",
  ].join("\n");

  assert.deepEqual(parseWindowsListeningProcessIds(output, 8080), [1234]);
});

test("only treats 8080 through 8089 as automatically recoverable", () => {
  assert.equal(isAutoRecoverablePort(8080), true);
  assert.equal(isAutoRecoverablePort(8089), true);
  assert.equal(isAutoRecoverablePort(8079), false);
  assert.equal(isAutoRecoverablePort(8090), false);
});

test("stops a listener with SIGTERM after skipping the current process", async () => {
  const signals: Array<[number, NodeJS.Signals]> = [];
  let listCalls = 0;
  await recoverOccupiedPort(8080, {
    listListeningProcessIds: async () => {
      listCalls += 1;
      return listCalls === 1 ? [1234, process.pid] : [];
    },
    sendSignal: (pid, signal) => signals.push([pid, signal]),
    sleep: async () => undefined,
    termGraceMs: 0,
    killGraceMs: 0,
  });

  assert.deepEqual(signals, [[1234, "SIGTERM"]]);
});

test("uses SIGKILL when SIGTERM does not release the listener", async () => {
  const signals: Array<[number, NodeJS.Signals]> = [];
  let listCalls = 0;
  await recoverOccupiedPort(8081, {
    listListeningProcessIds: async () => {
      listCalls += 1;
      return listCalls < 3 ? [1234] : [];
    },
    sendSignal: (pid, signal) => signals.push([pid, signal]),
    sleep: async () => undefined,
    termGraceMs: 0,
    killGraceMs: 0,
  });

  assert.deepEqual(signals, [[1234, "SIGTERM"], [1234, "SIGKILL"]]);
});

test("does not inspect or terminate a non-808x port", async () => {
  let inspected = false;
  await recoverOccupiedPort(8090, {
    listListeningProcessIds: async () => {
      inspected = true;
      return [1234];
    },
    sendSignal: () => { throw new Error("should not terminate"); },
    sleep: async () => undefined,
  });

  assert.equal(inspected, false);
});

test("uses Windows taskkill in ordinary and forced phases", async () => {
  const terminations: Array<[number, boolean]> = [];
  let listCalls = 0;

  await recoverOccupiedPort(8082, {
    platform: "win32",
    listListeningProcessIds: async () => {
      listCalls += 1;
      return listCalls === 1 ? [1234, 1234, process.pid] : listCalls === 2 ? [1234] : [];
    },
    terminateProcess: async (pid, force) => {
      terminations.push([pid, force]);
    },
    sleep: async () => undefined,
    termGraceMs: 0,
    killGraceMs: 0,
  });

  assert.deepEqual(terminations, [[1234, false], [1234, true]]);
});
