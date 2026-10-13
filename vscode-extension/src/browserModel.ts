// Pure model for the Browsers view: profile rows, state mapping, the tab list,
// leased text, URL validation and API-failure wording. No `vscode` import, so the
// root unit tests can require the compiled out/browserModel.js directly
// (tests/vscode-browsers-model.test.cjs). Mode labels, the claim line and the
// plain-language next steps are the desktop Browsers tab's own (core/browserView.js).

interface BrowserViewApi {
  MODES: { id: string; label: string; hint: string }[];
  claimLine(claim: unknown, now?: number): string;
  failureText(res: unknown): string;
}

// The packaged extension carries runtime/core (scripts/copy-runtime.js); a source
// checkout, where the unit tests run, has not built it and reads src/core directly.
function loadBrowserView(): BrowserViewApi {
  for (const rel of ['../runtime/core/browserView.js', '../../src/core/browserView.js']) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      return require(rel);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'MODULE_NOT_FOUND') throw err;
    }
  }
  throw new Error('browserModel: browserView.js not found');
}
const browserView = loadBrowserView();

export const MODES = browserView.MODES;
/** Tabs listed under one running profile. */
export const TAB_CAP = 30;
export const PORT_MIN = 1024;
export const PORT_MAX = 65535;

export type BrowserState = 'running' | 'stopped' | 'held' | 'unknown';

export interface BrowserProfile {
  name: string;
  port: number;
  browser: string;
  mode: string;
  url: string;
  note: string;
  userDataDir: string;
}

export interface BrowserTab {
  id: string;
  title: string;
  url: string;
}

/** What one cheap look at a profile's debug port found. */
export interface Probe {
  /** CDP answers on the port. */
  up: boolean;
  /** Something accepts connections on the port but does not speak CDP. */
  held: boolean;
  tabs: BrowserTab[];
  /** Page targets before the cap. */
  tabCount: number;
}

/**
 * One list_browser_profiles row. Only the fields the view reads; `leasedTo` and
 * `free` come from the session lease and are absent on older builds.
 */
export interface FullRow {
  name?: string;
  state?: string;
  warning?: string;
  claim?: { by?: string; at?: string } | null;
  leasedTo?: unknown;
  free?: unknown;
}

export interface BrowserRow {
  name: string;
  port: number;
  mode: string;
  browser: string;
  state: BrowserState;
  stateWord: string;
  cdpUrl: string;
  description: string;
  tooltip: string[];
  leasedTo: string | null;
  tabs: BrowserTab[];
  /** Page targets beyond the cap. */
  tabsHidden: number;
}

const STATE_WORDS: Record<BrowserState, string> = {
  running: 'Running',
  stopped: 'Stopped',
  held: 'Port held by another process',
  unknown: 'Checking',
};

const lower = (s: string) => s.toLowerCase();
const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/[\r\n\t]+/g, ' ').trim().slice(0, max) : '');

export const isValidPort = (p: unknown): p is number => Number.isInteger(p) && (p as number) >= PORT_MIN && (p as number) <= PORT_MAX;

/** The CDP endpoint, always loopback. */
export const cdpUrlFor = (port: number): string => `http://127.0.0.1:${port}`;

/**
 * The profiles in the shared config's `browserProfiles`, made safe to draw:
 * anything without a name and a usable port is dropped, a repeated name keeps the first.
 */
export function normaliseProfiles(raw: unknown): BrowserProfile[] {
  const seen = new Set<string>();
  const out: BrowserProfile[] = [];
  for (const p of Array.isArray(raw) ? raw : []) {
    if (!p || typeof p !== 'object') continue;
    const r = p as Record<string, unknown>;
    const name = str(r.name, 64);
    if (!name || !isValidPort(r.port) || seen.has(lower(name))) continue;
    seen.add(lower(name));
    out.push({
      name,
      port: r.port,
      browser: str(r.browser, 20) || 'chrome',
      mode: MODES.some(m => m.id === r.mode) ? (r.mode as string) : 'headed',
      url: str(r.url, 500),
      note: str(r.note, 500),
      userDataDir: str(r.userDataDir, 500),
    });
  }
  return out;
}

/** A page target id as CDP writes it (hex or uuid). Anything else never reaches a URL. */
export const isTabId = (id: unknown): id is string => typeof id === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(id);

/**
 * True when `raw` is a CDP target list: a non-empty array of objects with a `type`.
 * An empty list is not proof (any JSON server could return []): the caller confirms with /json/version.
 */
export function looksLikeCdpList(raw: unknown): boolean {
  return Array.isArray(raw) && raw.length > 0 && raw.every(t => !!t && typeof t === 'object' && typeof (t as { type?: unknown }).type === 'string');
}

/** Page tabs only, titles and URLs only, capped. Never reads tab content. */
export function shapeTabs(raw: unknown, cap = TAB_CAP): { tabs: BrowserTab[]; total: number } {
  const pages = (Array.isArray(raw) ? raw : []).filter(
    (t): t is Record<string, unknown> => !!t && typeof t === 'object' && (t as { type?: unknown }).type === 'page' && isTabId((t as { id?: unknown }).id)
  );
  return {
    tabs: pages.slice(0, cap).map(t => ({ id: t.id as string, title: str(t.title, 200), url: str(t.url, 500) })),
    total: pages.length,
  };
}

/** Row state from the 10 s look, refined by the last full API read (which can name who holds the port). */
export function stateOf(probe: Probe | undefined, full?: FullRow): BrowserState {
  if (!probe) return 'unknown';
  // CDP answers, but the API found the holder is not this profile's own browser.
  if (probe.up) return full && full.state === 'blocked' ? 'held' : 'running';
  return probe.held ? 'held' : 'stopped';
}

/** "claude 4a2f" from a lease that may be a string or an object; null when there is none. */
export function leasedText(leasedTo: unknown): string | null {
  if (typeof leasedTo === 'string') return str(leasedTo, 80) || null;
  if (leasedTo && typeof leasedTo === 'object') {
    const o = leasedTo as Record<string, unknown>;
    return str(o.label, 80) || str(o.by, 80) || str(o.sessionId, 80) || null;
  }
  return null;
}

const folderName = (p: BrowserProfile): string =>
  p.userDataDir ? (p.userDataDir.split(/[\\/]+/).filter(Boolean).pop() ?? p.userDataDir) : p.name;

export const descriptionOf = (p: { port: number; mode: string; browser: string }, state?: BrowserState): string =>
  [`:${p.port}`, p.mode, p.browser, state === 'held' ? 'port held' : ''].filter(Boolean).join(' · ');

function tooltipOf(p: BrowserProfile, state: BrowserState, probe: Probe | undefined, full: FullRow | undefined, leased: string | null): string[] {
  const free = full && typeof full.free === 'boolean' ? full.free : null;
  return [
    `${p.name} · ${STATE_WORDS[state]}`,
    ...(state === 'held' && full && str(full.warning, 300) ? [str(full.warning, 300)] : []),
    `CDP: ${cdpUrlFor(p.port)}`,
    ...(p.note ? [`Note: ${p.note}`] : []),
    ...(p.url ? [`Start URL: ${p.url}`] : []),
    `Profile folder: ${folderName(p)}`,
    ...(state === 'running' && probe ? [`Tabs: ${probe.tabCount}${probe.tabCount > TAB_CAP ? ` (first ${TAB_CAP} listed)` : ''}`] : []),
    ...(leased ? [`Leased to ${leased}`] : []),
    ...(!leased && state === 'running' && full && full.claim && full.claim.by ? [browserView.claimLine(full.claim)] : []),
    ...(free !== null ? [`Free: ${free ? 'yes' : 'no'}`] : []),
  ];
}

/** Running first, then port held, then stopped; by name inside each group (the desktop tab's order). */
const ORDER: Record<BrowserState, number> = { running: 0, held: 1, unknown: 2, stopped: 3 };

export function buildRows(
  profiles: BrowserProfile[],
  probes: ReadonlyMap<string, Probe>,
  full: ReadonlyMap<string, FullRow> = new Map()
): BrowserRow[] {
  const rows = profiles.map((p): BrowserRow => {
    const probe = probes.get(p.name);
    const f = full.get(lower(p.name));
    const state = stateOf(probe, f);
    const leased = leasedText(f?.leasedTo);
    return {
      name: p.name,
      port: p.port,
      mode: p.mode,
      browser: p.browser,
      state,
      stateWord: STATE_WORDS[state],
      cdpUrl: cdpUrlFor(p.port),
      description: descriptionOf(p, state),
      tooltip: tooltipOf(p, state, probe, f, leased),
      leasedTo: leased,
      tabs: state === 'running' && probe ? probe.tabs.slice(0, TAB_CAP) : [],
      tabsHidden: state === 'running' && probe ? Math.max(0, probe.tabCount - TAB_CAP) : 0,
    };
  });
  return rows.sort((a, b) => ORDER[a.state] - ORDER[b.state] || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

/** A tab row's label: its title, else its URL. */
export const tabLabel = (t: BrowserTab): string => t.title || t.url || 'Untitled';

/** Only http and https pages can be opened from the view; the result is the normalised URL. */
export function validateOpenUrl(input: string): { ok: true; url: string } | { ok: false; reason: string } {
  const text = (input ?? '').trim();
  if (!text) return { ok: false, reason: 'Enter a URL.' };
  if (/\s/.test(text)) return { ok: false, reason: 'A URL cannot contain spaces.' };
  let u: URL;
  try { u = new URL(text); } catch { return { ok: false, reason: 'That is not a full URL. Start with http:// or https://.' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, reason: 'Only http:// and https:// pages can be opened.' };
  if (!u.hostname) return { ok: false, reason: 'That URL has no host.' };
  return { ok: true, url: u.href };
}

/** Failures the API raises on purpose (it will not touch what PortPilot did not start): information, not a malfunction. */
export const isRefusal = (code: unknown): boolean => code === 'NOT_OURS' || code === 'NOT_VERIFIED' || code === 'PORT_HELD';

/**
 * The API's `error`, then what to do next. The desktop's plain-language next step when it has one
 * for this code, else the API's own `action`. Never a stack: only those two strings are read.
 */
export function failureMessage(res: { error?: unknown; action?: unknown; code?: unknown } | null | undefined): string {
  if (!res) return 'Something went wrong.';
  const withNext = browserView.failureText(res);
  const bare = browserView.failureText({ error: res.error });
  const action = str(res.action, 300);
  if (withNext !== bare || !action) return withNext;
  return `${bare.replace(/[.\s]+$/, '')}. ${action}`;
}
