import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  categoryForLoginCacheKey,
  filterLoginCacheFields,
  formatLoginCacheDate,
  formatLoginCacheDay,
  isSensitiveLoginCacheKey,
  loginCacheCustomerSummary,
  loginCacheFields,
  loginCacheSummary,
  parseLoginCacheAccounts,
} from "../../src/renderer/login-cache-data";

test("classifies login cache keys into readable dashboard groups", () => {
  assert.equal(categoryForLoginCacheKey("TOKEN"), "credential");
  assert.equal(categoryForLoginCacheKey("USERCODE"), "identity");
  assert.equal(categoryForLoginCacheKey("CUSTCERT"), "identity");
  assert.equal(categoryForLoginCacheKey("ACCOUNTLIST"), "account");
  assert.equal(categoryForLoginCacheKey("FUNDACCOUNT"), "account");
  assert.equal(categoryForLoginCacheKey("LAST_LOGIN_DATE"), "session");
  assert.equal(categoryForLoginCacheKey("ERRORMSG5"), "risk");
  assert.equal(categoryForLoginCacheKey("GRID"), "other");
});

test("marks credentials and personal data as sensitive for filtering only", () => {
  assert.equal(isSensitiveLoginCacheKey("TOKEN"), true);
  assert.equal(isSensitiveLoginCacheKey("CUSTCERT"), true);
  assert.equal(isSensitiveLoginCacheKey("ACCOUNTLIST"), true);
  assert.equal(isSensitiveLoginCacheKey("SESSIONNO"), false);
});

test("shows login cache values as complete plaintext without masking or truncation", () => {
  const token = "YcMUQS25@170A-AB7C324cqtqCV";
  const longValue = "x".repeat(240);
  const fields = loginCacheFields({ TOKEN: token, LONG: longValue, EMPTY: "" });
  const byKey = Object.fromEntries(fields.map((entry) => [entry.key, entry]));
  assert.equal(byKey.TOKEN.preview, token);
  assert.equal(byKey.TOKEN.sensitive, true);
  assert.equal(byKey.LONG.preview, longValue);
  assert.equal(byKey.EMPTY.preview, "空值");
});

test("summarizes login cache health and category composition", () => {
  const values = {
    TOKEN: "token-value",
    SESSIONNO: "4",
    USERCODE: "880005597770",
    ACCOUNTLIST: "SHACCOUNT|A120681838|上海A|",
    LAST_LOGIN_DATE: "20260720",
    ERRORNO: "0",
    EMPTY: "",
    LONG: "x".repeat(200),
  };
  assert.deepEqual(loginCacheSummary(values), {
    total: 8,
    nonEmpty: 7,
    empty: 1,
    sensitive: 2,
    long: 1,
    healthPercent: 88,
    tokenPresent: true,
    sessionPresent: true,
    categories: { credential: 2, identity: 1, account: 1, session: 1, risk: 1, other: 2 },
  });
});

test("filters login fields by category, sensitivity, length, and query", () => {
  const fields = loginCacheFields({ TOKEN: "token-value", USERCODE: "880005597770", ERRORNO: "0", LONG: "x".repeat(200) });
  assert.deepEqual(filterLoginCacheFields(fields, "", "credential").map((entry) => entry.key), ["TOKEN"]);
  assert.deepEqual(filterLoginCacheFields(fields, "", "sensitive").map((entry) => entry.key), ["TOKEN"]);
  assert.deepEqual(filterLoginCacheFields(fields, "", "long").map((entry) => entry.key), ["LONG"]);
  assert.deepEqual(filterLoginCacheFields(fields, "8800", "all").map((entry) => entry.key), ["USERCODE"]);
});

test("formats login time and account list entries", () => {
  assert.equal(formatLoginCacheDate({ LAST_LOGIN_DATE: "20260720", LAST_LOGIN_TIME: "091150" }), "2026-07-20 09:11:50");
  assert.equal(formatLoginCacheDate({}), "—");
  assert.equal(formatLoginCacheDay("20201106"), "2020-11-06");
  assert.deepEqual(parseLoginCacheAccounts("SHACCOUNT|A120681838|上海A|\u0003SZACCOUNT|0300756949|深圳A|"), [
    { type: "SH", number: "A120681838", name: "上海A", label: "SH · A120681838 · 上海A" },
    { type: "SZ", number: "0300756949", name: "深圳A", label: "SZ · 0300756949 · 深圳A" },
  ]);
});

test("summarizes customer details for the page, sidebar, and login success notice", () => {
  const customer = loginCacheCustomerSummary({
    USERNAME: "中信测试",
    USERCODE: "880005597770",
    USERTYPE: "El*+e",
    KBRANCH: "1018",
    OPENDATE: "20201106",
    IDNO: "880005597770134550",
    MOBILETELPHONE: "123456789",
    LAST_LOGIN_DATE: "20260720",
    LAST_LOGIN_TIME: "091150",
    ACCOUNTLIST: "SHACCOUNT|A120681838|上海A|\u0003SZACCOUNT|0300756949|深圳A|",
  });
  assert.equal(customer.hasCustomer, true);
  assert.equal(customer.name, "中信测试");
  assert.equal(customer.initial, "中");
  assert.equal(customer.code, "880005597770");
  assert.equal(customer.type, "El*+e");
  assert.equal(customer.branch, "1018");
  assert.equal(customer.openDate, "2020-11-06");
  assert.equal(customer.certificate, "880005597770134550");
  assert.equal(customer.phone, "123456789");
  assert.equal(customer.lastLogin, "2026-07-20 09:11:50");
  assert.equal(customer.accountCount, 2);
});

test("renderer exposes login session in the unified data browser with an editable text mode", async () => {
  const [appSource, pageSource, dataSource, chromeSource, styles] = await Promise.all([
    readFile("src/renderer/App.tsx", "utf8"),
    readFile("src/renderer/components/DataBrowserPage.tsx", "utf8"),
    readFile("src/renderer/login-cache-data.ts", "utf8"),
    readFile("src/renderer/components/WorkspaceChrome.tsx", "utf8"),
    readFile("src/renderer/styles.css", "utf8"),
  ]);
  assert.match(appSource, /<DataBrowserPage tab=\{dataTab\} selectedInstance=\{selectedInstance\} sessionValues=\{loginCache\} onSaveSession=\{saveLoginCache\}/);
  assert.doesNotMatch(appSource, /<LoginCachePage/);
  assert.match(pageSource, /if \(tab === "session"\) \{[\s\S]*?await onSaveSession\(next\)/);
  assert.match(pageSource, /formatLocalCacheText\(next\)/);
  assert.match(pageSource, /parseLocalCacheText\(text\)/);
  assert.match(pageSource, /className="[^"]*lf-data-shell"/);
  assert.match(pageSource, /登录缓存/);
  assert.match(pageSource, /编辑原文/);
  assert.doesNotMatch(pageSource, /脱敏/);
  assert.doesNotMatch(dataSource, /maskLoginCacheValue/);
  assert.doesNotMatch(chromeSource, /脱敏/);
  assert.match(styles, /\.lf-data-tabs/);
  assert.match(styles, /\.lf-detail-code/);
});

test("renderer keeps the customer summary in the new operator panel and success notice", async () => {
  const [appSource, chromeSource, styles] = await Promise.all([
    readFile("src/renderer/App.tsx", "utf8"),
    readFile("src/renderer/components/WorkspaceChrome.tsx", "utf8"),
    readFile("src/renderer/styles.css", "utf8"),
  ]);
  assert.match(chromeSource, /loginCacheCustomerSummary\(loginCache\)/);
  assert.match(chromeSource, /className="lf-operator"/);
  assert.match(chromeSource, /className="lf-operator-avatar"/);
  assert.match(chromeSource, /当前登录身份 · \$\{Object\.keys\(loginCache\)\.length\} 个字段/);
  assert.match(styles, /\.lf-context-footer/);
  assert.match(styles, /\.lf-operator\s*\{/);
  assert.match(appSource, /function LoginSuccessCard/);
  assert.match(appSource, /result\.loginSuccess/);
  assert.match(appSource, /3 秒后自动隐藏/);
  assert.match(appSource, /if \(loginSuccessNotice === undefined\) return;[\s\S]*?\}, 3000\);/);
  assert.match(appSource, /<LoginSuccessCard notice=\{loginSuccessNotice\}/);
});
