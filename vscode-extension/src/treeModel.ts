// Pure ordering and bookkeeping for the sidebar trees. No `vscode` import, so
// the root unit tests can require the compiled out/treeModel.js directly
// (tests/vscode-tree-model.test.cjs).

export type StateKey = 'crashed' | 'conflict' | 'error' | 'starting' | 'running' | 'stopped';

// Lower sorts first: the rows that need attention, then live ones, then idle.
export const STATE_WEIGHT: Record<StateKey, number> = {
  crashed: 0,
  conflict: 1,
  error: 2,
  starting: 3,
  running: 4,
  stopped: 5,
};

export interface SortKey {
  state: StateKey;
  name: string;
  favorite: boolean;
  /** States of the node's children (branch worktrees). */
  childStates?: StateKey[];
}

/** A parent with an active child sorts as that child: min weight of self and children. */
export function effectiveWeight(k: SortKey): number {
  let w = STATE_WEIGHT[k.state] ?? STATE_WEIGHT.stopped;
  for (const s of k.childStates ?? []) w = Math.min(w, STATE_WEIGHT[s] ?? STATE_WEIGHT.stopped);
  return w;
}

export function isIdle(k: SortKey): boolean {
  return effectiveWeight(k) === STATE_WEIGHT.stopped;
}

/** State weight, then favourites, then name. */
export function compareKeys(a: SortKey, b: SortKey): number {
  const w = effectiveWeight(a) - effectiveWeight(b);
  if (w !== 0) return w;
  if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
  return a.name.localeCompare(b.name);
}

/**
 * Sort a sibling list and, when `fold` is on, split off the idle ones so the
 * caller can tuck them under a collapsed "Stopped (N)" node at the end.
 */
export function arrange<T>(items: T[], keyOf: (t: T) => SortKey, fold: boolean): { visible: T[]; stopped: T[] } {
  const sorted = [...items].sort((a, b) => compareKeys(keyOf(a), keyOf(b)));
  if (!fold) return { visible: sorted, stopped: [] };
  return {
    visible: sorted.filter(t => !isIdle(keyOf(t))),
    stopped: sorted.filter(t => isIdle(keyOf(t))),
  };
}

/** Invert appId -> live port into port -> appId (first app wins on a shared port). */
export function appIdByPort(running: Map<string, { port: number }>): Map<number, string> {
  const out = new Map<number, string>();
  for (const [appId, p] of running) if (!out.has(p.port)) out.set(p.port, appId);
  return out;
}

/** An app's newest open run that already has a page thumbnail (runView.rowThumbs). */
export interface RowThumbRef {
  id: string;
  thumb: string;
  port: number | null;
}

/**
 * The preview an Apps row may show, by the desktop's rule (rowThumbs.js): the app
 * must be listening, have a runtime record, and the live port must match the open
 * run's port. A stop outside PortPilot leaves a run open, so an open run alone
 * does not prove its server is the one on screen.
 */
export function previewFor(
  byApp: Record<string, RowThumbRef | undefined>,
  appId: string,
  hasRuntimeRecord: boolean,
  livePort: number | null | undefined
): RowThumbRef | null {
  const cur = byApp[appId];
  if (!cur || !hasRuntimeRecord || livePort == null) return null;
  return cur.port == null || cur.port === livePort ? cur : null;
}

export interface CrashStamp {
  exitCode: number | null;
  at: number;
  port?: number | null;
  errorTail?: string | null;
  startedBy?: { kind: string } | null;
}

/**
 * Crash stamps newer than `since`, oldest first, skipping apps that are
 * listening again. Returns the new high-water mark to pass next time.
 */
export function newCrashes(
  runtime: Record<string, { crashed?: CrashStamp } | undefined>,
  running: Set<string>,
  since: number
): { crashes: Array<{ appId: string; stamp: CrashStamp }>; latest: number } {
  const crashes: Array<{ appId: string; stamp: CrashStamp }> = [];
  let latest = since;
  for (const [appId, entry] of Object.entries(runtime)) {
    const stamp = entry?.crashed;
    if (!stamp || typeof stamp.at !== 'number') continue;
    if (stamp.at > latest) latest = stamp.at;
    if (stamp.at > since && !running.has(appId)) crashes.push({ appId, stamp });
  }
  crashes.sort((a, b) => a.stamp.at - b.stamp.at);
  return { crashes, latest };
}
