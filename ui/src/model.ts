import type { AppRec, Profile, Snapshot } from './host';

export type View = 'home' | 'localhost' | 'browsers' | 'library' | 'ports' | 'scenes' | 'history' | 'settings';
/** 'library' is only a navigation alias: Apps in Manage mode (see App.tsx). */
/** The sections in the segmented control; the rest are under More, and Settings has its own button. */
export const VIEWS: Array<{ view: View; label: string }> = [
  { view: 'home', label: 'Home' },
  { view: 'localhost', label: 'Apps' },
  { view: 'browsers', label: 'Browsers' },
  { view: 'ports', label: 'Ports' },
];
/** Occasional screens: under the More menu in the top bar, and still one Ctrl+K away. */
export const MORE_VIEWS: Array<{ view: View; label: string }> = [
  { view: 'scenes', label: 'Scenes' },
  { view: 'history', label: 'History' },
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

/** The stored record calls it `group`; `groupId` is kept for older fixtures. */
export const groupOf = (a: AppRec): string => a.group || a.groupId || '';

/** Cards bucketed by app group, groups in config order, then the ungrouped ones. */
export function grouped(s: Snapshot, list: Card[]): Array<{ id: string; name: string; cards: Card[] }> {
  const out: Array<{ id: string; name: string; cards: Card[] }> = [];
  for (const g of s.groups) {
    const c = list.filter((x) => groupOf(x.app) === g.id);
    if (c.length) out.push({ id: g.id, name: g.name, cards: c });
  }
  const known = new Set(s.groups.map((g) => g.id));
  const rest = list.filter((x) => !groupOf(x.app) || !known.has(groupOf(x.app)));
  if (rest.length) out.push({ id: '', name: out.length ? 'Other' : 'All apps', cards: rest });
  return out;
}

export const STALE_MS = 5 * 60 * 1000;

export type BrowserGroup = 'inuse' | 'open' | 'blocked' | 'stopped';
export interface BrowserCard { profile: Profile; group: BrowserGroup }
export const BROWSER_GROUPS: Array<{ id: BrowserGroup; label: string }> = [
  { id: 'inuse', label: 'In use' },
  { id: 'open', label: 'Open' },
  { id: 'blocked', label: 'Port blocked' },
  { id: 'stopped', label: 'Stopped' },
];

/** Where a profile sits: leased to a session, running free, its port held by something else, or stopped. */
export function browserGroup(p: Profile): BrowserGroup {
  if (p.state === 'up') return p.leasedTo ? 'inuse' : 'open';
  return p.state === 'blocked' ? 'blocked' : 'stopped';
}

const B_RANK: Record<BrowserGroup, number> = { inuse: 0, open: 1, blocked: 2, stopped: 3 };

/** One card per profile, filtered by every word of the query against its text, running first then by name. */
export function browserCards(s: Snapshot, query = ''): BrowserCard[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const out: BrowserCard[] = [];
  for (const p of s.profiles) {
    const hay = [p.name, p.port, p.purpose, p.note, p.url, ...(p.sites || []), ...(p.accounts || []).flatMap((a) => [a.platform, a.username])]
      .filter(Boolean).join(' ').toLowerCase();
    if (words.every((w) => hay.includes(w))) out.push({ profile: p, group: browserGroup(p) });
  }
  return out.sort((a, b) => B_RANK[a.group] - B_RANK[b.group] || a.profile.name.localeCompare(b.profile.name));
}

/** A stable hue 0-359 from the profile name, for the gradient behind a card with no picture. */
export function hueOf(name: string): number {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

/** "3m", "2h", "5d": how long ago an ISO time was; empty when it is missing or in the future. */
export function ago(iso: string | undefined, now = Date.now()): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t) || t > now) return '';
  const m = Math.floor((now - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.floor(m / 60)}h`;
  return `${Math.floor(m / 1440)}d`;
}
