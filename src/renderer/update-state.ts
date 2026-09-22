import type { UpdateStateKind } from "../shared/contracts";

export interface ManualCheckResult {
  pending: boolean;
  notifyLatest: boolean;
}

export function resolveManualCheckResult(pending: boolean, state: UpdateStateKind): ManualCheckResult {
  if (!pending) return { pending: false, notifyLatest: false };
  if (state === "not-available") return { pending: false, notifyLatest: true };
  if (state !== "checking") return { pending: false, notifyLatest: false };
  return { pending: true, notifyLatest: false };
}
