import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_LOCAL_VALUES, defaultLocalValues, ensureDefaultLocalValues } from "../../src/shared/local-values";

test("exposes the requested default local variables", () => {
  assert.deepEqual(DEFAULT_LOCAL_VALUES, {
    SOFTVERSION: "7.03.039",
    UPVERSION: "6.03.039",
    MOBILECODE: "17000000000",
    JYLOGINFLAG: "2",
    HQVERSION: "2.0",
    TZTRZRQLOGINFLAG: "2",
    TZTGGQQLOGINFLAG: "2",
    LOGINTYPE: "1",
    CFROM: "tzt.3.0",
    TZTSKINTYPE: "0",
  });
});

test("uses defaults only when no local variables are configured", () => {
  assert.deepEqual(ensureDefaultLocalValues({}), defaultLocalValues());
  assert.deepEqual(ensureDefaultLocalValues({ CUSTOM: "kept" }), { CUSTOM: "kept" });
});
