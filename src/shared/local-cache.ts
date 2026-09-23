export function parseLocalCacheText(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  let lastKey: string | undefined;
  for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (line === "") {
      lastKey = undefined;
      continue;
    }
    const separator = line.indexOf("=");
    const key = separator >= 0 ? line.slice(0, separator).trim() : "";
    if (separator < 0 || key === "") {
      if (lastKey === undefined) throw new Error(`login cache line ${index + 1}: expected key=value`);
      values[lastKey] += `\n${line}`;
      continue;
    }
    lastKey = key.toUpperCase();
    values[lastKey] = line.slice(separator + 1).trim();
  }
  return values;
}

export function formatLocalCacheText(values: Record<string, string>): string {
  return Object.entries(values).map(([key, value]) => `${key} = ${value}`).join("\n");
}
