import test from "node:test";
import assert from "node:assert/strict";
import { createDefaultConfig } from "../../../src/core/config/model";
import { DEFAULT_REQUEST_PARAMS_TEXT } from "../../../src/shared/config-defaults";
import { parseManualRequestParams } from "../../../src/shared/manual-request";

test("new proxy configs start with the standard forwarding addresses", () => {
  assert.deepEqual(createDefaultConfig().tcpTargets, [
    { id: "tcp-1", name: "hq", host: "60.12.9.58", port: 7778, protocol: "http", transport: "http", enabled: true },
    { id: "tcp-2", name: "jy", host: "123.103.83.82", port: 6064, enabled: true },
    { id: "tcp-3", name: "zx", host: "123.103.83.82", port: 6064, enabled: true },
  ]);
});

test("new proxy configs start with the standard request template", () => {
  const request = createDefaultConfig().request;
  assert.equal(request?.host, "123.103.83.82");
  assert.equal(request?.port, 6064);
  assert.equal(request?.paramsText, DEFAULT_REQUEST_PARAMS_TEXT);
  assert.deepEqual(Object.fromEntries(Object.entries(parseManualRequestParams(DEFAULT_REQUEST_PARAMS_TEXT))), {
    Action: "100",
    account: "600554432",
    password: "600000",
    compassword: "111111",
    MobileCode: "17000000000",
    accounttype: "zjaccount",
    MobileType: "2",
    ReqlinkType: "2",
    Cfrom: "zxzq.iphone",
    TFrom: "iphone",
    maxcount: "1",
  });
});

test("each default config receives its own forwarding target objects", () => {
  const first = createDefaultConfig().tcpTargets;
  const second = createDefaultConfig().tcpTargets;
  assert.notEqual(first, second);
  assert.notEqual(first[0], second[0]);
});
