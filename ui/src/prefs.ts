import { useSyncExternalStore } from 'react';

/** Where the section tabs live. The sidebar always gives way to the top bar on a narrow window. */
export type Nav = 'side' | 'top';

export const ACCENTS = [
  { id: 'blue', label: 'Blue', hue: 235 },
  { id: 'teal', label: 'Teal', hue: 168 },
  { id: 'coral', label: 'Coral', hue: 18 },
  { id: 'pink', label: 'Pink', hue: 330 },
  { id: 'violet', label: 'Violet', hue: 280 },
] as const;
export type AccentId = (typeof ACCENTS)[number]['id'];

export interface Prefs { nav: Nav; accent: AccentId }

const KEY = 'portpilot-ui-prefs';
const DEFAULTS: Prefs = { nav: 'side', accent: 'blue' };

/** Reads the saved choices, dropping any value that is not one of the known options. */
export function parsePrefs(raw: string | null): Prefs {
  const out: Prefs = { ...DEFAULTS };
  try {
    const j = JSON.parse(raw || '{}') as Partial<Prefs>;
    if (j.nav === 'side' || j.nav === 'top') out.nav = j.nav;
    if (ACCENTS.some((a) => a.id === j.accent)) out.accent = j.accent as AccentId;
  } catch { /* unreadable: use the defaults */ }
  return out;
}

function load(): Prefs {
  try { return parsePrefs(localStorage.getItem(KEY)); } catch { return { ...DEFAULTS }; }
}

let cur: Prefs = load();
const subs = new Set<() => void>();

/** Puts the accent hue on the page; the colour tokens in styles.css are built from it. */
export function applyPrefs(p: Prefs = cur) {
  const hue = ACCENTS.find((a) => a.id === p.accent)?.hue ?? ACCENTS[0].hue;
  document.documentElement.style.setProperty('--ah', String(hue));
}

export function setPrefs(patch: Partial<Prefs>) {
  cur = { ...cur, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(cur)); } catch { /* storage can be unavailable */ }
  applyPrefs(cur);
  subs.forEach((f) => f());
}

export function usePrefs(): Prefs {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => cur);
}
