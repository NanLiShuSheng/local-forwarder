import assert from "node:assert/strict";
import test from "node:test";
import { flattenJsonValue, parseJsonPreviewText } from "../../src/shared/json-preview";

async function loadPipeDelimitedArrayParser(): Promise<(value: unknown) => unknown> {
  const module = await import("../../src/shared/json-preview") as unknown as { parsePipeDelimitedArray?: unknown };
  assert.equal(typeof module.parsePipeDelimitedArray, "function");
  return module.parsePipeDelimitedArray as (value: unknown) => unknown;
}

test("parses pure JSON and returns formatted text and root metadata", () => {
  const result = parseJsonPreviewText('{"code":1,"records":[{"name":"查询成功"}]}');
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.source, "json");
    assert.equal(result.rootType, "object");
    assert.match(result.formatted, /\n  "records":/);
  }
});

test("parses a quoted escaped JSON response", () => {
  const result = parseJsonPreviewText('"{\\"code\\":1,\\"timeout\\":false}"');
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.value, { code: 1, timeout: false });
});

test("parses nested JSON object strings inside a response envelope", () => {
  const result = parseJsonPreviewText(JSON.stringify({
    ACTION: "49400",
    ERRORNO: "1",
    RESULT: JSON.stringify({ clzt: 8, totalCount: "43", records: [{ ywqqid: "10830427" }] }),
    TOKEN: "zpmMC153@170A-AE7C7247FuHfr",
  }));
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.value, {
      ACTION: "49400",
      ERRORNO: "1",
      RESULT: { clzt: 8, totalCount: "43", records: [{ ywqqid: "10830427" }] },
      TOKEN: "zpmMC153@170A-AE7C7247FuHfr",
    });
    assert.match(result.formatted, /"RESULT": \{\n/);
  }
});

test("keeps ordinary and malformed nested strings unchanged", () => {
  const result = parseJsonPreviewText(JSON.stringify({ note: "成功", malformed: "{not-json}" }));
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.value, { note: "成功", malformed: "{not-json}" });
});

test("parses an escaped object without an outer string quote", () => {
  const result = parseJsonPreviewText('{\\"code\\":1,\\"note\\":\\"查询成功\\"}');
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.value, { code: 1, note: "查询成功" });
});

test("flattens nested values with JSON paths and types", () => {
  const rows = flattenJsonValue({ records: [{ id: 7, ok: true }], note: null });
  assert.deepEqual(rows.map((row) => [row.path, row.type]), [
    ["$.records", "array"], ["$.records[0]", "object"], ["$.records[0].id", "number"],
    ["$.records[0].ok", "boolean"], ["$.note", "null"],
  ]);
});

test("parses pipe-delimited arrays into indexed headers and aligned rows", async () => {
  const parsePipeDelimitedArray = await loadPipeDelimitedArrayParser();
  assert.deepEqual(parsePipeDelimitedArray([
    "客户编号|资金账户|资产账号类别|主账标志|资产属性|主账标识|",
    "2486178|9910902888|1|主账号|普通客户|1|",
    "2486179|9910902999|1|子账号||0|",
  ]), {
    headers: ["客户编号", "资金账户", "资产账号类别", "主账标志", "资产属性", "主账标识", ""],
    rows: [
      ["2486178", "9910902888", "1", "主账号", "普通客户", "1", ""],
      ["2486179", "9910902999", "1", "子账号", "", "0", ""],
    ],
  });
});

test("does not classify ordinary arrays as pipe-delimited tables", async () => {
  const parsePipeDelimitedArray = await loadPipeDelimitedArrayParser();
  assert.equal(parsePipeDelimitedArray(["客户编号", "2486178"]), undefined);
  assert.equal(parsePipeDelimitedArray(["客户编号|资金账户", 2486178]), undefined);
  assert.equal(parsePipeDelimitedArray([]), undefined);
});

test("rejects malformed JSON with a user-facing error", () => {
  const result = parseJsonPreviewText('{"code":}');
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /JSON/);
});
