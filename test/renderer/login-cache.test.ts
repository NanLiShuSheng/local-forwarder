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
    MOBILETELEPHONE: "123456789",
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

test("renderer exposes login cache as a visual page with a raw text fallback", async () => {
  const [appSource, pageSource, dataSource, styles] = await Promise.all([
    readFile("src/renderer/App.tsx", "utf8"),
    readFile("src/renderer/components/LoginCachePage.tsx", "utf8"),
    readFile("src/renderer/login-cache-data.ts", "utf8"),
    readFile("src/renderer/styles.css", "utf8"),
  ]);
  assert.match(appSource, /import \{ LoginCachePage \} from "\.\/components\/LoginCachePage";/);
  assert.match(appSource, /<LoginCachePage[\s\S]*?values=\{loginCache\}[\s\S]*?onSave=\{saveLoginCache\}/);
  assert.match(pageSource, /className="login-cache-page"/);
  assert.match(pageSource, /login-cache-workspace/);
  assert.match(pageSource, /formatLocalCacheText\(values\)/);
  assert.match(pageSource, /parseLocalCacheText\(text\)/);
  assert.match(pageSource, /onSave\(parsed\)/);
  assert.match(pageSource, /className="config-textarea login-cache-input"/);
  assert.match(pageSource, /所有字段均按明文完整展示/);
  assert.doesNotMatch(pageSource, /脱敏/);
  assert.match(dataSource, /loginCacheSummary/);
  assert.doesNotMatch(dataSource, /maskLoginCacheValue/);
  assert.match(styles, /\.login-cache-workspace/);
  assert.match(styles, /\.login-cache-field-row/);
});

test("renderer matches the v5 customer card, page-level scrolling, and success notice", async () => {
  const [appSource, pageSource, styles] = await Promise.all([
    readFile("src/renderer/App.tsx", "utf8"),
    readFile("src/renderer/components/LoginCachePage.tsx", "utf8"),
    readFile("src/renderer/styles.css", "utf8"),
  ]);
  assert.match(pageSource, /login-cache-customer-card/);
  assert.match(pageSource, /右侧页面整体滚动查看全部内容/);
  assert.match(pageSource, /className="login-cache-field-list" role="list"/);
  assert.doesNotMatch(pageSource, /login-cache-detail-panel/);
  assert.match(styles, /\.login-cache-page[^\{]*\{[^}]*height:\s*auto/);
  assert.match(styles, /\.login-cache-field-list[^\{]*\{[^}]*overflow:\s*visible/);
  assert.match(appSource, /function SidebarCustomer/);
  assert.match(appSource, /className="sidebar-customer"/);
  assert.match(appSource, /function LoginSuccessCard/);
  assert.match(appSource, /result\.loginSuccess/);
  assert.match(appSource, /\}, 2000\)/);
  assert.match(appSource, /<LoginSuccessCard notice=\{loginSuccessNotice\}/);
});
