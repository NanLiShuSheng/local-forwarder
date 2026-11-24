import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { ManualRequestConfig } from "../../src/shared/contracts";
import {
  REQUEST_HISTORY_LIMIT,
  REQUEST_HISTORY_STORAGE_KEY,
  formatRequestHistoryTime,
  previousRequestHistoryEntry,
  readRequestHistory,
  rememberRequestHistory,
  requestHistorySummary,
  requestHistorySignature,
  writeRequestHistory,
  type RequestHistoryEntry,
  type RequestHistoryStorage,
} from "../../src/renderer/request-history";

function request(index: number, patch: Partial<ManualRequestConfig> = {}): ManualRequestConfig {
  return {
    host: `10.20.18.${index}`,
    port: 9100 + index,
    paramsText: `Action=${100 + index}\naccount=60000000000${index % 10}`,
    transport: index % 2 === 0 ? "http" : "tzt",
    ...patch,
  };
}

function entry(index: number, patch: Partial<RequestHistoryEntry> = {}): RequestHistoryEntry {
  return { sentAt: 1_000 + index, request: request(index), ...patch };
}

function statefulStorage(initialValue: string | null): RequestHistoryStorage {
  let value = initialValue;
  return {
    getItem: (key) => {
      assert.equal(key, REQUEST_HISTORY_STORAGE_KEY);
      return value;
    },
    setItem: (key, nextValue) => {
      assert.equal(key, REQUEST_HISTORY_STORAGE_KEY);
      value = nextValue;
    },
  };
}

test("persists only the latest 20 valid request versions in newest-first order", () => {
  const storage = statefulStorage(null);
  const entries = Array.from({ length: 25 }, (_, index) => entry(index));

  writeRequestHistory(storage, entries);
  const loaded = readRequestHistory(storage);

  assert.equal(REQUEST_HISTORY_LIMIT, 20);
  assert.equal(loaded.length, REQUEST_HISTORY_LIMIT);
  assert.deepEqual(loaded.map((historyEntry) => historyEntry.sentAt), Array.from({ length: 20 }, (_, index) => 1_024 - index));
});

test("ignores corrupt request history records and invalid payloads", () => {
  const storage = statefulStorage(JSON.stringify([
    entry(1),
    { sentAt: 2_000, request: { host: "10.0.0.1", port: 0, paramsText: "" } },
    { sentAt: "yesterday", request: request(2) },
    { sentAt: 3_000, request: { host: "10.0.0.2", port: 6064, paramsText: 42 } },
    { sentAt: 4_000, request: request(3, { transport: "ftp" as unknown as ManualRequestConfig["transport"] }) },
  ]));

  assert.deepEqual(readRequestHistory(storage).map((historyEntry) => historyEntry.sentAt), [1_001]);
  assert.deepEqual(readRequestHistory(statefulStorage("{")), []);
  assert.deepEqual(readRequestHistory(statefulStorage(JSON.stringify({ entries: [] }))), []);
});

test("remembers a repeated request once and moves it to the front", () => {
  const first = entry(1, { sentAt: 1_001 });
  const second = entry(2, { sentAt: 1_002 });
  const repeated = { ...first.request, paramsText: first.request.paramsText.replace(/\n/g, "\r\n") };
  const remembered = rememberRequestHistory([second, first], repeated, 2_000);

  assert.equal(remembered.length, 2);
  assert.equal(remembered[0].sentAt, 2_000);
  assert.equal(remembered[0].request.paramsText, repeated.paramsText);
  assert.equal(remembered[1].sentAt, second.sentAt);
});

test("finds the previous distinct request and ignores the current filling", () => {
  const older = entry(1, { sentAt: 1_001 });
  const current = entry(2, { sentAt: 1_002 });
  const history = [current, older];

  assert.equal(previousRequestHistoryEntry(history, current.request)?.sentAt, older.sentAt);
  assert.equal(previousRequestHistoryEntry(history, request(9))?.sentAt, current.sentAt);
  assert.equal(previousRequestHistoryEntry([current], current.request), undefined);
});

test("request signatures normalize line endings and whitespace at the end", () => {
  const normalized = request(1);
  const equivalent = { ...normalized, paramsText: `${normalized.paramsText}\r\n` };

  assert.equal(requestHistorySignature(normalized), requestHistorySignature(equivalent));
});

test("request history persistence is best effort", () => {
  const storage: RequestHistoryStorage = {
    getItem: () => {
      throw new Error("storage unavailable");
    },
    setItem: () => {
      throw new Error("storage unavailable");
    },
  };

  assert.deepEqual(readRequestHistory(storage), []);
  assert.deepEqual(readRequestHistory(undefined), []);
  assert.doesNotThrow(() => writeRequestHistory(storage, [entry(1)]));
  assert.doesNotThrow(() => writeRequestHistory(undefined, [entry(1)]));
});

test("summarizes history targets and request parameters", () => {
  const summary = requestHistorySummary({
    host: "123.103.83.82",
    port: 6064,
    transport: "http",
    paramsText: "Action=104\naccount=600000000001\nMobileType=2",
  });

  assert.deepEqual(summary, {
    address: "http://123.103.83.82:6064/reqxml",
    action: "104",
    account: "600000000001",
    paramCount: 3,
  });
  assert.equal(requestHistorySummary({ ...request(1), transport: "tzt" }).address, "tcp://10.20.18.1:9101");
});

test("formats history timestamps for today, yesterday, and older entries", () => {
  const now = new Date(2026, 10, 24, 16, 30, 0).getTime();

  assert.equal(formatRequestHistoryTime(new Date(2026, 10, 24, 15, 42, 8).getTime(), now), "15:42:08");
  assert.equal(formatRequestHistoryTime(new Date(2026, 10, 23, 17, 22, 0).getTime(), now), "昨天 17:22");
  assert.equal(formatRequestHistoryTime(new Date(2026, 9, 2, 9, 5, 0).getTime(), now), "10月2日 09:05");
  assert.equal(formatRequestHistoryTime(new Date(2025, 11, 31, 23, 59, 0).getTime(), now), "2025/12/31 23:59");
});

test("request debug header exposes persistent history with restore-only controls", async () => {
  const [appSource, menuSource, styles] = await Promise.all([
    readFile("src/renderer/App.tsx", "utf8"),
    readFile("src/renderer/components/RequestHistoryMenu.tsx", "utf8"),
    readFile("src/renderer/styles.css", "utf8"),
  ]);

  assert.match(appSource, /readRequestHistory\(requestHistoryStorage\)/);
  assert.match(appSource, /writeRequestHistory\(requestHistoryStorage, requestHistory\)/);
  assert.match(appSource, /rememberRequestHistory\(current, request\)/);
  assert.match(appSource, /<RequestHistoryMenu[\s\S]*?history=\{requestHistory\}/);
  assert.match(appSource, /actions=\{<RequestHistoryMenu/);
  assert.match(appSource, /已恢复请求填充，未自动发送/);
  assert.match(menuSource, /请求历史/);
  assert.match(menuSource, /自动保留最近 20 个请求版本/);
  assert.match(menuSource, /恢复只会回填 IP、端口、协议和请求参数，不会自动发送。/);
  assert.match(menuSource, /aria-expanded=\{open\}/);
  assert.match(menuSource, /className="lf-request-history-popover"/);
  assert.match(menuSource, /disabled=\{isCurrent \|\| restoring !== undefined\}/);
  assert.doesNotMatch(menuSource, /onSendRequest/);
  assert.match(styles, /\.lf-request-history-popover\s*\{/);
  assert.match(styles, /\.lf-request-history-row\.current\s*\{/);
  assert.match(styles, /@keyframes request-history-popover-enter\s*\{/);
});
