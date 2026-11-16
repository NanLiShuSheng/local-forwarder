export const DEFAULT_LOCAL_VALUES: Readonly<Record<string, string>> = Object.freeze({
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

export function defaultLocalValues(): Record<string, string> {
  return { ...DEFAULT_LOCAL_VALUES };
}

export function ensureDefaultLocalValues(values: Record<string, string>): Record<string, string> {
  return Object.keys(values).length === 0 ? defaultLocalValues() : { ...values };
}
