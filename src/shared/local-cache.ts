export function parseLocalCacheText(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (line === "") continue;
    const separator = line.indexOf("=");
    const key = separator >= 0 ? line.slice(0, separator).trim() : "";
    if (separator < 0 || key === "") {
      throw new Error(`login cache line ${index + 1}: expected key=value`);
    }
    values[key.toUpperCase()] = line.slice(separator + 1).trim();
  }
  return values;
}
