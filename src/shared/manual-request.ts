export function parseManualRequestPort(text: string): number | undefined {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return undefined;
  const port = Number(trimmed);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : undefined;
}

export function parseManualRequestParams(text: string): Record<string, string> {
  const params: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith(";")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) throw new Error(`第 ${index + 1} 行格式无效，请使用“键=值”格式`);
    const key = trimmed.slice(0, separator).trim();
    if (key === "") throw new Error(`第 ${index + 1} 行缺少参数名`);
    params[key] = trimmed.slice(separator + 1).trim();
  }
  return params;
}

export function serializeManualRequestParams(params: Record<string, string>): string {
  return new URLSearchParams(Object.entries(params)).toString();
}
