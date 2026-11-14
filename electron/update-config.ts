export const TENCENT_UPDATE_BASE_URL = "https://www.finbr.asia/local-forwarder/";

export function normalizeUpdateBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
}
