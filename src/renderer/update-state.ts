import type { UpdateState, UpdateStateKind } from "../shared/contracts";

export interface ManualCheckResult {
  pending: boolean;
  notifyLatest: boolean;
}

export interface UpdateStateSynchronizer {
  receiveEvent(state: UpdateState): void;
  receiveSnapshot(state: UpdateState): void;
  getRevision(): number;
  getState(): UpdateState;
}

export function resolveManualCheckResult(pending: boolean, state: UpdateStateKind): ManualCheckResult {
  if (!pending) return { pending: false, notifyLatest: false };
  if (state === "not-available") return { pending: false, notifyLatest: true };
  if (state !== "checking") return { pending: false, notifyLatest: false };
  return { pending: true, notifyLatest: false };
}

export function createUpdateStateSynchronizer(initialState: UpdateState, applyState: (state: UpdateState) => void): UpdateStateSynchronizer {
  let currentState = initialState;
  let revision = 0;

  return {
    receiveEvent(state) {
      revision += 1;
      currentState = state;
      applyState(state);
    },
    receiveSnapshot(state) {
      if (revision > 0) return;
      currentState = state;
      applyState(state);
    },
    getRevision: () => revision,
    getState: () => currentState,
  };
}
