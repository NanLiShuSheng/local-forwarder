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
  assert.throws(() => parseLocalCacheText("malformed line\nTOKEN=ok"), /line 1/);
  assert.throws(() => parseLocalCacheText(" = missing-key"), /line 1/);
});

test("keeps continuation lines in multiline login cache values", () => {
  assert.deepEqual(parseLocalCacheText("ErrorMsg5 = first line\nsecond line\nGrid = A|B|\n | | | |\nTOKEN = ok"), {
    ERRORMSG5: "first line\nsecond line",
    GRID: "A|B|\n| | | |",
    TOKEN: "ok",
  });
});
