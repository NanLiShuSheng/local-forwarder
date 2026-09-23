export const TOAST_DURATION_MS = 5000;

export type ToastKind = "error" | "warning" | "success" | "info";

export interface ToastRecord {
  id: string;
  kind: ToastKind;
  title: string;
  message: string;
}

function rawErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.trim();
  if (typeof error === "string") return error.trim();
  return "";
}

function containsUnlocalizedEnglish(message: string): boolean {
  const allowedTokens = new Set(["hq", "jy", "zx"]);
  return (message.match(/[A-Za-z][A-Za-z-]*/g) ?? []).some((token) => !allowedTokens.has(token.toLowerCase()));
}

export function toUserError(error: unknown, fallback = "操作失败"): string {
  const raw = rawErrorMessage(error);
  if (/EADDRINUSE|address already in use/i.test(raw)) {
    const port = raw.match(/(?:port\s+|:)(\d{1,5})\b/i)?.[1];
    return port === undefined ? "监听端口已被占用，请先释放该端口后重试" : `端口 ${port} 已被占用，请先释放该端口后重试`;
  }
  if (/stop the service before changing configuration/i.test(raw)) return "配置未保存，请先停止服务";
  if (/invalid request payload/i.test(raw)) return "请求参数无效，请检查输入内容";
  if (/invalid configuration/i.test(raw)) return "配置无效，请检查配置后重试";
  if (/ECONNREFUSED|connect(?:ion)? refused/i.test(raw)) return "无法连接目标服务，请检查地址和端口";
  if (/ETIMEDOUT|timed? ?out/i.test(raw)) return "请求超时，请检查目标服务是否可用";
  if (/ENOTFOUND|getaddrinfo/i.test(raw)) return "无法解析目标地址，请检查主机名";
  if (/EACCES|permission denied/i.test(raw)) return "没有权限执行此操作";
  return /[\u4e00-\u9fff]/.test(raw) && !containsUnlocalizedEnglish(raw) ? raw : fallback;
}
