import test from "node:test";
import assert from "node:assert/strict";
import { describeLocalVariable, localVariableEntries, localVariableKeyError, localVariableLabel, localVariableStats, normalizeLocalVariableKey } from "../../src/renderer/local-variable-data";

test("describes and filters local variable values", () => {
  const values = {
    SOFTVERSION: "7.03.039",
    EMPTY: "",
    LONG: "x".repeat(120),
    MOBILECODE: "17000000000",
  };

  assert.equal(describeLocalVariable("LONG", values.LONG).isLong, true);
  assert.equal(describeLocalVariable("EMPTY", "").preview, "空值");
  assert.deepEqual(localVariableEntries(values, "", "all").map((entry) => entry.key), ["EMPTY", "LONG", "MOBILECODE", "SOFTVERSION"]);
  assert.deepEqual(localVariableEntries(values, "", "value").map((entry) => entry.key), ["LONG", "MOBILECODE", "SOFTVERSION"]);
  assert.deepEqual(localVariableEntries(values, "", "empty").map((entry) => entry.key), ["EMPTY"]);
  assert.deepEqual(localVariableEntries(values, "", "long").map((entry) => entry.key), ["LONG"]);
  assert.deepEqual(localVariableEntries(values, "soft", "all").map((entry) => entry.key), ["SOFTVERSION"]);
  assert.deepEqual(localVariableEntries(values, "1700", "all").map((entry) => entry.key), ["MOBILECODE"]);
  assert.deepEqual(localVariableStats(values), { total: 4, nonEmpty: 3, empty: 1, long: 1 });
});

test("normalizes names and rejects empty or duplicate variable names", () => {
  const values = { SOFTVERSION: "7.03.039", MOBILECODE: "17000000000" };
  assert.equal(normalizeLocalVariableKey("  softversion  "), "SOFTVERSION");
  assert.equal(localVariableKeyError(" softversion ", values), "变量“SOFTVERSION”已存在");
  assert.equal(localVariableKeyError(" softversion ", values, "SOFTVERSION"), undefined);
  assert.equal(localVariableKeyError("   ", values), "变量名不能为空");
  assert.equal(localVariableKeyError("BAD=KEY", values), "变量名不能包含等号或换行");
});

test("labels known defaults and supports searching by business label", () => {
  const values = {
    SOFTVERSION: "7.03.039",
    UPVERSION: "6.03.039",
    MOBILECODE: "17000000000",
    JYLOGINFLAG: "2",
    HQVERSION: "2.0",
    TZTRZRQLOGINFLAG: "2",
    TZTGGQQLOGINFLAG: "2",
    TZTSKINTYPE: "0",
    CUSTOM: "custom",
  };

  assert.equal(localVariableLabel("softversion"), "App 版本号");
  assert.equal(localVariableLabel("upversion"), "开户 SDK 版本号");
  assert.equal(localVariableLabel("mobilecode"), "登录手机号");
  assert.equal(localVariableLabel("jyloginflag"), "普通登录状态");
  assert.equal(localVariableLabel("hqversion"), "行情版本");
  assert.equal(localVariableLabel("tztrzrqloginflag"), "两融登录状态");
  assert.equal(localVariableLabel("tztggqqloginflag"), "期权登录状态");
  assert.equal(localVariableLabel("tztskintype"), "App 主题色");
  assert.equal(localVariableLabel("custom"), undefined);
  assert.deepEqual(localVariableEntries(values, "手机号", "all").map((entry) => entry.key), ["MOBILECODE"]);
  assert.deepEqual(localVariableEntries(values, "两融", "all").map((entry) => entry.key), ["TZTRZRQLOGINFLAG"]);
  assert.deepEqual(localVariableEntries(values, "主题色", "all").map((entry) => entry.key), ["TZTSKINTYPE"]);
  assert.equal(describeLocalVariable("SOFTVERSION", values.SOFTVERSION).label, "App 版本号");
});
