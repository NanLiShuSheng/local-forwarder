import type { AppConfig } from "../src/shared/contracts";
import { isValidAppConfig } from "../src/shared/validation";

export interface IpcInvokeEvent {
  senderFrame?: { url: string } | null;
}

export type IpcHandler = (event: IpcInvokeEvent, ...args: unknown[]) => unknown;

export interface IpcTrustPolicy {
  isTrustedRendererUrl(url: string): boolean;
}

export function createTrustedIpcHandler(
  policy: IpcTrustPolicy,
  handler: IpcHandler,
): IpcHandler {
  return (event, ...args) => {
    if (!policy.isTrustedRendererUrl(event.senderFrame?.url ?? "")) {
      throw new Error("Blocked IPC call from an untrusted renderer.");
    }
    return handler(event, ...args);
  };
}

export function createSaveConfigHandler(
  onValidPayload: (config: AppConfig) => unknown,
): IpcHandler {
  return (_event, payload) => {
    if (!isValidAppConfig(payload)) {
      return { ok: false, error: "Invalid configuration payload." };
    }
    return onValidPayload(payload);
  };
}
