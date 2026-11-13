export type LoginCacheCategory = "credential" | "identity" | "account" | "session" | "risk" | "other";
export type LoginCacheFilter = "all" | LoginCacheCategory | "sensitive" | "long";

export interface LoginCacheField {
  key: string;
  value: string;
  category: LoginCacheCategory;
  categoryLabel: string;
  sensitive: boolean;
  chars: number;
  lines: number;
  preview: string;
  isLong: boolean;
}

export interface LoginCacheSummary {
  total: number;
  nonEmpty: number;
  empty: number;
  sensitive: number;
  long: number;
  healthPercent: number;
  tokenPresent: boolean;
  sessionPresent: boolean;
  categories: Record<LoginCacheCategory, number>;
}

export interface LoginCacheAccount {
  type: string;
  number: string;
  name: string;
  label: string;
}

export interface LoginCacheCustomerSummary {
  hasCustomer: boolean;
  name: string;
  initial: string;
  code: string;
  type: string;
  branch: string;
  openDate: string;
  certificate: string;
  phone: string;
  lastLogin: string;
  accounts: LoginCacheAccount[];
  accountCount: number;
}

export const LOGIN_CACHE_CATEGORIES: readonly LoginCacheCategory[] = ["credential", "identity", "account", "session", "risk", "other"];
export const LOGIN_CACHE_CATEGORY_LABELS: Record<LoginCacheCategory, string> = {
  credential: "登录凭证",
  identity: "身份资料",
  account: "账户资金",
  session: "会话环境",
  risk: "风险提示",
  other: "其他字段",
};

const LONG_VALUE_THRESHOLD = 200;
const CATEGORY_ORDER = new Map(LOGIN_CACHE_CATEGORIES.map((category, index) => [category, index]));
const CREDENTIAL_KEYS = new Set(["TOKEN", "SESSIONNO", "ACTION", "TYPE", "LOGINTYPE", "USERTYPE", "RIGHTS", "SERVICEID", "REQLINKTYPE", "TOKENTYPE", "LOGINFLAG"]);
const IDENTITY_KEYS = new Set(["USERCODE", "USERNAME", "FULLNAME", "IDNO", "IDTYPE", "KBRANCH", "OPENBRANCH", "OPENDATE", "CUSTCERT", "ORGANPROPFLAG"]);
const ACCOUNT_KEYS = new Set(["ACCOUNTLIST", "FUNDACCOUNT", "BANKMONEY", "ISHKACCOUNT", "ISHKSZACCOUNT", "ASSET_PROP", "MAXCOUNT"]);
const SESSION_KEYS = new Set(["LAST_LOGIN_DATE", "LAST_LOGIN_TIME", "LAST_OP_STATION", "LAST_OP_ENTRUST_WAY", "TZTUSEDTIME", "MOBILETELPHONE", "PRESTORE_INFO"]);
const SENSITIVE_KEYS = new Set(["TOKEN", "RIGHTS", "CUSTCERT", "IDNO", "FUNDACCOUNT", "BANKMONEY", "MOBILETELPHONE", "LAST_OP_STATION"]);
const KEY_PRIORITY = new Map([
  ["TOKEN", 0],
  ["SESSIONNO", 1],
  ["USERCODE", 2],
  ["USERNAME", 3],
  ["FULLNAME", 4],
  ["ACCOUNTLIST", 5],
  ["FUNDACCOUNT", 6],
  ["LAST_LOGIN_DATE", 7],
  ["LAST_LOGIN_TIME", 8],
  ["ERRORNO", 9],
]);

function normalizedKey(key: string): string {
  return key.toUpperCase();
}

export function categoryForLoginCacheKey(key: string): LoginCacheCategory {
  const normalized = normalizedKey(key);
  if (CREDENTIAL_KEYS.has(normalized) || normalized.startsWith("LOGIN")) return "credential";
  if (IDENTITY_KEYS.has(normalized) || normalized.includes("CERT")) return "identity";
  if (ACCOUNT_KEYS.has(normalized) || normalized.includes("ACCOUNT") || normalized.includes("FUND") || normalized.includes("BANK") || normalized.includes("MONEY")) return "account";
  if (SESSION_KEYS.has(normalized) || normalized.startsWith("LAST_") || normalized.startsWith("LASTOP")) return "session";
  if (normalized === "ERRORNO" || normalized.startsWith("ERROR") || normalized.startsWith("SDXFLAG") || normalized.includes("RISK")) return "risk";
  return "other";
}

export function isSensitiveLoginCacheKey(key: string): boolean {
  const normalized = normalizedKey(key);
  return SENSITIVE_KEYS.has(normalized) || normalized.includes("ACCOUNT") || normalized.includes("CERT") || normalized.includes("PASSWORD") || normalized.includes("SECRET") || normalized.includes("PHONE");
}

function displayValue(value: string): string {
  return value.length === 0 ? "空值" : value;
}

export function describeLoginCacheField(key: string, value: string): LoginCacheField {
  const category = categoryForLoginCacheKey(key);
  const sensitive = isSensitiveLoginCacheKey(key);
  return {
    key,
    value,
    category,
    categoryLabel: LOGIN_CACHE_CATEGORY_LABELS[category],
    sensitive,
    chars: value.length,
    lines: value.split("\n").length,
    preview: displayValue(value),
    isLong: value.length >= LONG_VALUE_THRESHOLD,
  };
}

export function loginCacheFields(values: Record<string, string>): LoginCacheField[] {
  return Object.entries(values)
    .map(([key, value]) => describeLoginCacheField(key, value))
    .sort((left, right) => {
      const categoryDifference = (CATEGORY_ORDER.get(left.category) ?? 99) - (CATEGORY_ORDER.get(right.category) ?? 99);
      if (categoryDifference !== 0) return categoryDifference;
      const priorityDifference = (KEY_PRIORITY.get(left.key) ?? 99) - (KEY_PRIORITY.get(right.key) ?? 99);
      if (priorityDifference !== 0) return priorityDifference;
      return left.key.localeCompare(right.key);
    });
}

export function filterLoginCacheFields(fields: LoginCacheField[], query: string, filter: LoginCacheFilter): LoginCacheField[] {
  const wanted = query.trim().toLocaleLowerCase();
  return fields.filter((entry) => {
    if (filter === "sensitive" && !entry.sensitive) return false;
    if (filter === "long" && !entry.isLong) return false;
    if (filter !== "all" && filter !== "sensitive" && filter !== "long" && entry.category !== filter) return false;
    if (wanted === "") return true;
    return entry.key.toLocaleLowerCase().includes(wanted) || entry.value.toLocaleLowerCase().includes(wanted);
  });
}

export function loginCacheSummary(values: Record<string, string>): LoginCacheSummary {
  const categories = Object.fromEntries(LOGIN_CACHE_CATEGORIES.map((category) => [category, 0])) as Record<LoginCacheCategory, number>;
  let nonEmpty = 0;
  let sensitive = 0;
  let long = 0;
  for (const [key, value] of Object.entries(values)) {
    categories[categoryForLoginCacheKey(key)] += 1;
    if (value.length > 0) nonEmpty += 1;
    if (isSensitiveLoginCacheKey(key)) sensitive += 1;
    if (value.length >= LONG_VALUE_THRESHOLD) long += 1;
  }
  const total = Object.keys(values).length;
  return {
    total,
    nonEmpty,
    empty: total - nonEmpty,
    sensitive,
    long,
    healthPercent: total === 0 ? 0 : Math.round((nonEmpty / total) * 100),
    tokenPresent: (values.TOKEN ?? "").length > 0,
    sessionPresent: (values.SESSIONNO ?? "").length > 0,
    categories,
  };
}

export function loginCacheValue(values: Record<string, string>, key: string): string {
  const wanted = normalizedKey(key);
  const match = Object.entries(values).find(([candidate]) => normalizedKey(candidate) === wanted);
  return match?.[1] ?? "";
}

export function formatLoginCacheDate(values: Record<string, string>): string {
  const date = loginCacheValue(values, "LAST_LOGIN_DATE").replace(/\D/g, "");
  const time = loginCacheValue(values, "LAST_LOGIN_TIME").replace(/\D/g, "");
  if (date.length < 8) return "—";
  const formattedDate = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
  if (time.length < 6) return formattedDate;
  return `${formattedDate} ${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}`;
}

export function formatLoginCacheDay(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 8) return value.trim() || "—";
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

export function parseLoginCacheAccounts(value: string): LoginCacheAccount[] {
  return value
    .split(/[\u0003\r\n]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      const [type = "", number = "", name = ""] = entry.split("|");
      const normalizedType = type.replace(/ACCOUNT$/i, "").toUpperCase();
      return {
        type: normalizedType,
        number,
        name,
        label: [normalizedType, number, name].filter((part) => part.length > 0).join(" · "),
      };
    });
}

export function loginCacheCustomerSummary(values: Record<string, string>): LoginCacheCustomerSummary {
  const name = loginCacheValue(values, "USERNAME") || loginCacheValue(values, "FULLNAME");
  const code = loginCacheValue(values, "USERCODE");
  const certificate = loginCacheValue(values, "IDNO") || loginCacheValue(values, "CUSTCERT");
  const phone = loginCacheValue(values, "MOBILETELPHONE");
  const accounts = parseLoginCacheAccounts(loginCacheValue(values, "ACCOUNTLIST"));
  return {
    hasCustomer: name.length > 0 || code.length > 0,
    name: name || "未命名客户",
    initial: Array.from(name || "客")[0] ?? "客",
    code: code || "—",
    type: loginCacheValue(values, "USERTYPE") || "—",
    branch: loginCacheValue(values, "KBRANCH") || loginCacheValue(values, "OPENBRANCH") || "—",
    openDate: formatLoginCacheDay(loginCacheValue(values, "OPENDATE")),
    certificate: certificate || "—",
    phone: phone || "—",
    lastLogin: formatLoginCacheDate(values),
    accounts,
    accountCount: accounts.length,
  };
}
