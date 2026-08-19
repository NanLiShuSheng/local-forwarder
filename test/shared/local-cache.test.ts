import test from "node:test";
import assert from "node:assert/strict";
import { parseLocalCacheText } from "../../src/shared/local-cache";

test("parses pasted login cache while preserving values after the first equals sign", () => {
  assert.deepEqual(parseLocalCacheText(`
    TOKEN = first=value
    SessionNo = 4
    TOKEN = final-value

  `), {
    TOKEN: "final-value",
    SESSIONNO: "4",
  });
});

test("rejects non-empty cache lines without a key and equals sign", () => {
  assert.throws(() => parseLocalCacheText("TOKEN=ok\nmalformed line"), /line 2/);
  assert.throws(() => parseLocalCacheText(" = missing-key"), /line 1/);
});
