export type LocalVariableFilter = "all" | "value" | "empty" | "long";

export interface LocalVariableEntry {
  key: string;
  value: string;
  label?: string;
  chars: number;
  lines: number;
  preview: string;
  isLong: boolean;
}

export interface LocalVariableStats {
  total: number;
  nonEmpty: number;
  empty: number;
  long: number;
}

export const LOCAL_VARIABLE_LONG_THRESHOLD = 120;
const PREVIEW_LENGTH = 96;

export const LOCAL_VARIABLE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  SOFTVERSION: "App 版本号",
  UPVERSION: "开户 SDK 版本号",
  MOBILECODE: "登录手机号",
  JYLOGINFLAG: "普通登录状态",
  HQVERSION: "行情版本",
  TZTRZRQLOGINFLAG: "两融登录状态",
  TZTGGQQLOGINFLAG: "期权登录状态",
  TZTSKINTYPE: "App 主题色",
});

export function localVariableLabel(key: string): string | undefined {
  return LOCAL_VARIABLE_LABELS[key.trim().toUpperCase()];
}

function previewValue(value: string): string {
  if (value.length === 0) return "空值";
  const singleLine = value.replace(/\s+/g, " ").trim();
  return singleLine.length > PREVIEW_LENGTH ? `${singleLine.slice(0, PREVIEW_LENGTH)}…` : singleLine;
}

export function describeLocalVariable(key: string, value: string): LocalVariableEntry {
  const label = localVariableLabel(key);
  const entry: LocalVariableEntry = {
    key,
    value,
    chars: value.length,
    lines: value.split("\n").length,
    preview: previewValue(value),
    isLong: value.length >= LOCAL_VARIABLE_LONG_THRESHOLD,
  };
  if (label !== undefined) entry.label = label;
  return entry;
}

export function localVariableEntries(values: Record<string, string>, query = "", filter: LocalVariableFilter = "all"): LocalVariableEntry[] {
  const wanted = query.trim().toLocaleLowerCase();
  return Object.entries(values)
    .map(([key, value]) => describeLocalVariable(key, value))
    .filter((entry) => {
      if (filter === "value" && entry.chars === 0) return false;
      if (filter === "empty" && entry.chars > 0) return false;
      if (filter === "long" && !entry.isLong) return false;
      if (wanted === "") return true;
      return entry.key.toLocaleLowerCase().includes(wanted)
        || (entry.label?.toLocaleLowerCase().includes(wanted) ?? false)
        || entry.value.toLocaleLowerCase().includes(wanted);
    })
    .sort((left, right) => left.key.localeCompare(right.key));
}

export function localVariableStats(values: Record<string, string>): LocalVariableStats {
  let nonEmpty = 0;
  let long = 0;
  for (const value of Object.values(values)) {
    if (value.length > 0) nonEmpty += 1;
    if (value.length >= LOCAL_VARIABLE_LONG_THRESHOLD) long += 1;
  }
  const total = Object.keys(values).length;
  return { total, nonEmpty, empty: total - nonEmpty, long };
}

export function normalizeLocalVariableKey(key: string): string {
  return key.trim().toUpperCase();
}

export function localVariableKeyError(key: string, values: Record<string, string>, originalKey?: string): string | undefined {
  const normalized = normalizeLocalVariableKey(key);
  if (normalized === "") return "变量名不能为空";
  if (/[=\r\n]/.test(normalized)) return "变量名不能包含等号或换行";
  const original = originalKey?.toUpperCase();
  const duplicate = Object.keys(values).find((entry) => entry.toUpperCase() === normalized && entry.toUpperCase() !== original);
  return duplicate === undefined ? undefined : `变量“${normalized}”已存在`;
}
