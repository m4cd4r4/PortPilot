import type { AppRec, Snapshot } from './host';

export type View = 'home' | 'localhost' | 'browsers' | 'history';
/** The three sections in the segmented control; History has its own top-bar button. */
export const VIEWS: Array<{ view: View; label: string }> = [
  { view: 'home', label: 'Home' },
  { view: 'localhost', label: 'Localhost' },
  { view: 'browsers', label: 'Browsers' },
];

export interface Tally { running: number; apps: number; profilesUp: number; profiles: number; warnings: string[] }

/** Counts for the Home tiles and the slim warning banner. Pure. */
export function tally(s: Snapshot): Tally {
  const top = s.apps.filter((a) => !a.parentId);
  const warnings = s.conflicts.map((c) => {
    const app = s.apps.find((a) => a.id === c.appId);
    const name = app?.name || c.appName;
    const who = c.occupiedBy?.processName ? c.occupiedBy.processName.replace(/\.exe$/i, '') : 'another process';
    return `${name || 'An app'} is blocked: :${c.port} is held by ${who}`;
  });
  return {
    running: top.filter((a) => s.running[a.id]).length,
    apps: top.length,
    profilesUp: s.profiles.filter((p) => p.state === 'up').length,
    profiles: s.profiles.length,
    warnings,
  };
}

export type CardState = 'running' | 'conflict' | 'crashed' | 'stopped';
export interface Card { app: AppRec; state: CardState; port?: number; note: string }
export type Mode = 'gallery' | 'compact' | 'list' | 'grouped';
export const MODES: Array<{ mode: Mode; label: string }> = [
  { mode: 'gallery', label: 'Gallery' },
  { mode: 'compact', label: 'Compact' },
  { mode: 'list', label: 'List' },
  { mode: 'grouped', label: 'Grouped' },
];

const RANK: Record<CardState, number> = { conflict: 0, crashed: 1, running: 2, stopped: 3 };

/** One card per registered app: its state, the port to show and a short reason. Running first, then by name. */
export function cards(s: Snapshot, query = ''): Card[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const out: Card[] = [];
  for (const app of s.apps) {
    const hay = `${app.name} ${app.branch || ''} ${app.preferredPort || ''}`.toLowerCase();
    if (!words.every((w) => hay.includes(w))) continue;
    const live = s.running[app.id];
    const conflict = s.conflicts.find((c) => c.appId === app.id);
    let state: CardState = 'stopped';
    let note = '';
    if (live) state = 'running';
    else if (conflict) {
      state = 'conflict';
      note = `Port held by ${(conflict.occupiedBy?.processName || 'another process').replace(/\.exe$/i, '')}`;
    } else if (s.crashed[app.id]) {
      state = 'crashed';
      const code = s.crashed[app.id].exitCode;
      note = code != null ? `Exited with code ${code}` : 'Exited unexpectedly';
    }
    out.push({ app, state, port: live?.port ?? conflict?.port ?? app.preferredPort, note });
  }
  return out.sort((a, b) => RANK[a.state] - RANK[b.state] || a.app.name.localeCompare(b.app.name));
}

/** Cards bucketed by app group, groups in config order, then the ungrouped ones. */
export function grouped(s: Snapshot, list: Card[]): Array<{ id: string; name: string; cards: Card[] }> {
  const out: Array<{ id: string; name: string; cards: Card[] }> = [];
  for (const g of s.groups) {
    const c = list.filter((x) => x.app.groupId === g.id);
    if (c.length) out.push({ id: g.id, name: g.name, cards: c });
  }
  const known = new Set(s.groups.map((g) => g.id));
  const rest = list.filter((x) => !x.app.groupId || !known.has(x.app.groupId));
  if (rest.length) out.push({ id: '', name: out.length ? 'Other' : 'All apps', cards: rest });
  return out;
}

export const STALE_MS = 5 * 60 * 1000;
