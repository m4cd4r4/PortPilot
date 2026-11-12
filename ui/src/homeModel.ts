import type { Profile, Run, Snapshot } from './host';
import { cards, type Card } from './model';

export const RECENT_ROWS = 8;
export const BROWSER_ROWS = 3;

export interface HomeLists {
  /** Every running app, worktree copies too, newest start first. */
  running: Card[];
  /** Apps that ran before and are not running now, newest first. An app is in one list or the other, never both. */
  recent: Card[];
  /** Every open profile; when fewer than BROWSER_ROWS are open, the most recently used closed ones fill the list. */
  browsers: Profile[];
  open: number;
}

/** Latest start per app, newest first, from run history. */
export function lastRuns(runs: Run[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of runs) {
    if (!r.appId || !r.startedAt) continue;
    const prev = out.get(r.appId);
    if (!prev || Date.parse(r.startedAt) > Date.parse(prev)) out.set(r.appId, r.startedAt);
  }
  return new Map([...out].sort((a, b) => Date.parse(b[1]) - Date.parse(a[1])));
}

const when = (iso: string | undefined) => Date.parse(iso || '') || 0;

/** What Home lists. Pure. */
export function homeLists(snap: Snapshot, runs: Run[]): HomeLists {
  const all = cards(snap);
  const last = lastRuns(runs);
  const running = all.filter((c) => c.state === 'running')
    .sort((a, b) => when(last.get(b.app.id)) - when(last.get(a.app.id)) || a.app.name.localeCompare(b.app.name));
  const byId = new Map(all.map((c) => [c.app.id, c]));
  const recent = [...last.keys()].map((id) => byId.get(id)).filter((c): c is Card => !!c && c.state !== 'running').slice(0, RECENT_ROWS);
  const byUse = (a: Profile, b: Profile) => when(b.lastUsed) - when(a.lastUsed) || a.name.localeCompare(b.name);
  const up = snap.profiles.filter((p) => p.state === 'up').sort(byUse);
  const rest = snap.profiles.filter((p) => p.state !== 'up').sort(byUse);
  return { running, recent, browsers: [...up, ...rest.slice(0, Math.max(0, BROWSER_ROWS - up.length))], open: up.length };
}
