import assert from "node:assert/strict";
import test from "node:test";
import { parseLogRequestParams } from "../../src/shared/log-details";

test("parses the request line, duplicate query keys, and form body", () => {
  const result = parseLogRequestParams(
    "GET /reqxml?Action=100&Action=101\n\naccount=600554432&name=%E5%BC%A0%E4%B8%89",
  );

  assert.equal(result.method, "GET");
  assert.equal(result.path, "/reqxml");
  assert.deepEqual(result.query, [
    { key: "Action", value: "100" },
    { key: "Action", value: "101" },
  ]);
  assert.deepEqual(result.body, [
    { key: "account", value: "600554432" },
    { key: "name", value: "张三" },
  ]);
  assert.equal(result.rawBody, undefined);
});

test("keeps a non-form request body as raw text", () => {
  const result = parseLogRequestParams("POST /api\n\n{\"code\":1}");

  assert.equal(result.method, "POST");
  assert.equal(result.path, "/api");
  assert.deepEqual(result.query, []);
  assert.deepEqual(result.body, []);
  assert.equal(result.rawBody, '{"code":1}');
});
