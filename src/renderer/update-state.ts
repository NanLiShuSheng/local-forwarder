import type { UpdateState, UpdateStateKind } from "../shared/contracts";

export interface ManualCheckResult {
  pending: boolean;
  notifyLatest: boolean;
}

export interface ManualCheckTracker {
  begin(): number;
  current(): number | undefined;
  isCurrent(id: number): boolean;
  complete(id: number): boolean;
  hasPending(): boolean;
}

export interface UpdateStateSynchronizer {
  beginSnapshot(): UpdateStateSnapshotToken;
  receiveEvent(state: UpdateState): void;
  receiveSnapshot(token: UpdateStateSnapshotToken, state: UpdateState): boolean;
  getState(): UpdateState;
}

export interface UpdateStateSnapshotToken {
  sequence: number;
  eventRevision: number;
}

export function resolveManualCheckResult(pending: boolean, state: UpdateStateKind): ManualCheckResult {
  if (!pending) return { pending: false, notifyLatest: false };
  if (state === "not-available") return { pending: false, notifyLatest: true };
  if (state !== "checking") return { pending: false, notifyLatest: false };
  return { pending: true, notifyLatest: false };
}

export function createManualCheckTracker(): ManualCheckTracker {
  let nextId = 0;
  let activeId: number | undefined;

  return {
    begin() {
      activeId = ++nextId;
      return activeId;
    },
    current: () => activeId,
    isCurrent: (id) => activeId === id,
    complete(id) {
      if (activeId !== id) return false;
      activeId = undefined;
      return true;
    },
    hasPending: () => activeId !== undefined,
  };
}

export function createUpdateStateSynchronizer(initialState: UpdateState, applyState: (state: UpdateState) => void): UpdateStateSynchronizer {
  let currentState = initialState;
  let revision = 0;
  let nextSnapshotSequence = 0;
  let latestSnapshotSequence = 0;

  return {
    beginSnapshot() {
      const token = { sequence: ++nextSnapshotSequence, eventRevision: revision };
      latestSnapshotSequence = token.sequence;
      return token;
    },
    receiveEvent(state) {
      revision += 1;
      currentState = state;
      applyState(state);
    },
    receiveSnapshot(token, state) {
      if (token.sequence !== latestSnapshotSequence || token.eventRevision !== revision) return false;
      currentState = state;
      applyState(state);
      return true;
    },
    getState: () => currentState,
  };
}
