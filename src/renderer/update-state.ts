import type { UpdateState, UpdateStateKind } from "../shared/contracts";

export interface ManualCheckResult {
  pending: boolean;
  notifyLatest: boolean;
}

export interface ManualCheckTracker {
  begin(startRevision?: number, initialState?: UpdateStateKind): number;
  current(): number | undefined;
  isCurrent(id: number): boolean;
  canResolve(id: number, revision: number, state: UpdateStateKind): boolean;
  complete(id: number): boolean;
  hasPending(): boolean;
}

export interface UpdateStateSynchronizer {
  beginSnapshot(): UpdateStateSnapshotToken;
  receiveEvent(state: UpdateState): void;
  receiveSnapshot(token: UpdateStateSnapshotToken, state: UpdateState): boolean;
  getRevision(): number;
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
  let active: { id: number; startRevision: number; sawChecking: boolean } | undefined;

  return {
    begin(startRevision = 0, initialState = "idle") {
      const id = ++nextId;
      active = { id, startRevision, sawChecking: initialState === "checking" };
      return id;
    },
    current: () => active?.id,
    isCurrent: (id) => active?.id === id,
    canResolve(id, revision, state) {
      if (active?.id !== id || revision <= active.startRevision) return false;
      if (state === "checking") {
        active.sawChecking = true;
        return false;
      }
      if (state !== "available" && state !== "not-available") return false;
      return active.sawChecking;
    },
    complete(id) {
      if (active?.id !== id) return false;
      active = undefined;
      return true;
    },
    hasPending: () => active !== undefined,
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
    getRevision: () => revision,
    getState: () => currentState,
  };
}
