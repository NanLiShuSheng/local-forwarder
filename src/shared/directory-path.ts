export function parseDirectoryInput(value: string): string {
  const raw = value.trim();
  if (raw === "") throw new Error("目录路径无效");

  if (/^[a-z][a-z\d+.-]*:/i.test(raw)) {
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      throw new Error("目录路径无效");
    }
    if (parsed.protocol !== "file:") throw new Error("目录 URL 必须是本地 file URL");
    if (parsed.hostname !== "" && parsed.hostname !== "localhost") throw new Error("目录 URL 必须是本地 file URL");
    try {
      const pathname = decodeURIComponent(parsed.pathname);
      if (!pathname.startsWith("/")) throw new Error("目录路径无效");
      return pathname;
    } catch {
      throw new Error("目录路径无效");
    }
  }

  if (!raw.startsWith("/")) throw new Error("目录路径无效");
  return raw;
}
