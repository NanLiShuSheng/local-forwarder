import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const DEFAULT_USAGE_ANALYTICS_ENDPOINT = "https://analytics.finbr.asia/api/send";
export const USAGE_ANALYTICS_WEBSITE_ID = "4071ca4f-68fe-46f6-a520-910960eb5841";
export const USAGE_ANALYTICS_TIMEOUT_MS = 3_000;

const INSTALL_ID_FILE_NAME = "usage-install-id";
const USAGE_ANALYTICS_USER_AGENT = "Mozilla/5.0 (compatible; LocalForwarder)";
const INSTALL_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface UsageAnalyticsConfig {
  endpoint: string;
  websiteId: string;
}

export interface UsageAnalyticsDependencies {
  generateInstallId?: () => string;
  fetchImpl?: typeof fetch;
}

export interface AppLaunchInput {
  websiteId: string;
  installId: string;
  appVersion: string;
  platform: string;
  arch: string;
  osVersion: string;
  locale: string;
}

export interface UmamiEventRequest {
  type: "event";
  payload: {
    website: string;
    hostname: string;
    url: string;
    referrer: string;
    title: string;
    language: string;
    id: string;
    data: Record<string, string>;
  };
}

export interface TrackAppLaunchOptions extends Omit<AppLaunchInput, "websiteId" | "installId"> {
  endpoint: string;
  websiteId: string;
  userDataPath: string;
  isPackaged: boolean;
  isSmokeMode: boolean;
  installId?: string;
  timeoutMs?: number;
  generateInstallId?: () => string;
  fetchImpl?: typeof fetch;
}

export function getUsageAnalyticsConfig(env: NodeJS.ProcessEnv = process.env): UsageAnalyticsConfig {
  return {
    endpoint: env.LOCAL_FORWARDER_UMAMI_ENDPOINT?.trim() || DEFAULT_USAGE_ANALYTICS_ENDPOINT,
    websiteId: env.LOCAL_FORWARDER_UMAMI_WEBSITE_ID?.trim() || USAGE_ANALYTICS_WEBSITE_ID,
  };
}

export function getUsageInstallIdPath(userDataPath: string): string {
  return path.join(userDataPath, INSTALL_ID_FILE_NAME);
}

export async function readOrCreateUsageInstallId(
  installIdPath: string,
  dependencies: Pick<UsageAnalyticsDependencies, "generateInstallId"> = {},
): Promise<string> {
  try {
    const existing = (await readFile(installIdPath, "utf8")).trim();
    if (INSTALL_ID_PATTERN.test(existing)) return existing;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const installId = (dependencies.generateInstallId ?? randomUUID)();
  if (!INSTALL_ID_PATTERN.test(installId)) throw new Error("Generated usage install id is not a UUID");

  await mkdir(path.dirname(installIdPath), { recursive: true });
  try {
    await writeFile(installIdPath, `${installId}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    return installId;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }

  const concurrentInstallId = (await readFile(installIdPath, "utf8")).trim();
  if (INSTALL_ID_PATTERN.test(concurrentInstallId)) return concurrentInstallId;

  await writeFile(installIdPath, `${installId}\n`, { encoding: "utf8", mode: 0o600 });
  return installId;
}

export function createAppLaunchRequest(input: AppLaunchInput): UmamiEventRequest {
  const query = new URLSearchParams({
    appVersion: input.appVersion,
    platform: input.platform,
    arch: input.arch,
  });
  const locale = input.locale || "unknown";

  return {
    type: "event",
    payload: {
      website: input.websiteId,
      hostname: "local-forwarder",
      url: `/app_launch?${query.toString()}`,
      referrer: "",
      title: "Local Forwarder",
      language: locale,
      id: input.installId,
      data: {
        app_version: input.appVersion,
        platform: input.platform,
        arch: input.arch,
        os_version: input.osVersion || "unknown",
        locale,
      },
    },
  };
}

export async function trackAppLaunch(options: TrackAppLaunchOptions): Promise<boolean> {
  if (!options.isPackaged || options.isSmokeMode) return false;

  const websiteId = options.websiteId.trim();
  const endpoint = options.endpoint.trim();
  if (!websiteId || !endpoint) return false;

  try {
    const installId = options.installId ?? await readOrCreateUsageInstallId(
      getUsageInstallIdPath(options.userDataPath),
      { generateInstallId: options.generateInstallId },
    );
    const request = createAppLaunchRequest({
      websiteId,
      installId,
      appVersion: options.appVersion,
      platform: options.platform,
      arch: options.arch,
      osVersion: options.osVersion,
      locale: options.locale,
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? USAGE_ANALYTICS_TIMEOUT_MS);

    try {
      const response = await (options.fetchImpl ?? fetch)(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": USAGE_ANALYTICS_USER_AGENT,
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
      if (!response.ok) return false;

      const result = await response.json().catch(() => null) as { sessionId?: unknown } | null;
      return typeof result?.sessionId === "string" && result.sessionId.length > 0;
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return false;
  }
}
