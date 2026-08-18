import path from "node:path";
import { pathToFileURL } from "node:url";

export interface RendererSecurityPolicyOptions {
  mode: "development" | "production";
  devServerUrl: string;
  rendererFilePath: string;
}

export interface RendererSecurityPolicy {
  isTrustedRendererUrl(url: string): boolean;
  shouldAllowNavigation(url: string): boolean;
  windowOpenDecision(_url: string): { action: "deny" };
}

export function createRendererSecurityPolicy(
  options: RendererSecurityPolicyOptions,
): RendererSecurityPolicy {
  const devOrigin = new URL(options.devServerUrl).origin;
  const trustedFileUrl = pathToFileURL(path.resolve(options.rendererFilePath)).href;

  function isTrustedRendererUrl(url: string): boolean {
    try {
      const parsedUrl = new URL(url);
      if (options.mode === "development") {
        return parsedUrl.origin === devOrigin;
      }
      return parsedUrl.protocol === "file:" && parsedUrl.href === trustedFileUrl;
    } catch {
      return false;
    }
  }

  return {
    isTrustedRendererUrl,
    shouldAllowNavigation: isTrustedRendererUrl,
    windowOpenDecision: () => ({ action: "deny" }),
  };
}
