import assert from "node:assert/strict";
import test from "node:test";
import {
  ALL_LOG_TYPES,
  FIXED_LOG_TYPES,
  getLogType,
  getLogTypeOptions,
  matchesLogType,
  type LogTypeSource,
} from "../../src/shared/log-types";

function entry(values: Partial<LogTypeSource>): LogTypeSource {
  return { message: "GET /fallback", ...values };
}

test("prefers a non-empty requestPath over requestParams and message", () => {
  assert.equal(
    getLogType(entry({
      requestPath: "/explicit",
      requestParams: "GET /params?source=request-params HTTP/1.1",
      message: "GET /message?source=message HTTP/1.1",
    })),
    "/explicit",
  );
});

test("falls back from requestParams to message and removes query and fragment", () => {
  assert.equal(
    getLogType(entry({
      requestParams: "POST /from-params?source=params#fragment HTTP/1.1",
      message: "GET /from-message?source=message HTTP/1.1",
    })),
    "/from-params",
  );
  assert.equal(
    getLogType(entry({
      requestParams: "",
      message: "GET /from-message?source=message#fragment HTTP/1.1",
    })),
    "/from-message",
  );
});

test("returns undefined when neither field contains a parseable request target", () => {
  assert.equal(
    getLogType({
      requestParams: "not a request line",
      message: "also not a request line",
    }),
    undefined,
  );
  assert.equal(getLogType({}), undefined);
});

test("returns fixed types first and appends ordinary paths in first-seen order", () => {
  const options = getLogTypeOptions([
    entry({ requestPath: "/api/first" }),
    entry({ requestPath: "/reqxml" }),
    entry({ message: "GET /api/second?value=1 HTTP/1.1" }),
    entry({ requestParams: "GET /api/first?value=2 HTTP/1.1" }),
    entry({ requestPath: "/reqreadmap" }),
  ]);

  assert.deepEqual(options, [
    ...FIXED_LOG_TYPES,
    "/api/first",
    "/api/second",
  ]);
  assert.equal(options.includes(ALL_LOG_TYPES), false);
});

test("always includes fixed types in their declared order when there are no logs", () => {
  assert.deepEqual(getLogTypeOptions([]), [...FIXED_LOG_TYPES]);
});

test("matches every entry for all and only the selected type otherwise", () => {
  const matchingEntry = entry({ requestPath: "/api/matching" });
  const otherEntry = entry({ requestPath: "/api/other" });
  const unknownEntry = entry({ message: "not a request line" });

  assert.equal(matchesLogType(matchingEntry, ALL_LOG_TYPES), true);
  assert.equal(matchesLogType(unknownEntry, ALL_LOG_TYPES), true);
  assert.equal(matchesLogType(matchingEntry, "/api/matching"), true);
  assert.equal(matchesLogType(otherEntry, "/api/matching"), false);
  assert.equal(matchesLogType(unknownEntry, "/api/matching"), false);
});
