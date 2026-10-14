/**
 * Pure view logic for the Browsers tab: state words, ordering, mode labels, claim line, port
 * suggestion, plain-language next steps. Loaded as a browser global (window.PortPilotBrowserView)
 * by the renderer, which runs without Node, and as a CommonJS module by tests. Zero dependencies.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.PortPilotBrowserView = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Same shapes and tokens as the Apps rows (core/status.js): shape and word carry the state,
  // colour only reinforces it.
  const STATES = {
    up:      { state: 'running',  word: 'Running',   glyph: '●', token: '--status-running' },
    down:    { state: 'stopped',  word: 'Stopped',   glyph: '○', token: '--status-stopped' },
    blocked: { state: 'conflict', word: 'Port held', glyph: '▲', token: '--status-conflict' },
  };
  const ORDER = { up: 0, blocked: 1, down: 2 };

  const MODES = [
    { id: 'headed', label: 'Headed', hint: 'A normal visible window.' },
    { id: 'offscreen', label: 'Offscreen', hint: 'A real window placed off your screen. Harder for sites to flag as a bot than headless.' },
    { id: 'headless', label: 'Headless', hint: 'No window at all. The easiest for sites to detect.' },
  ];
  const modeInfo = (id) => MODES.find((m) => m.id === id) || { id, label: String(id || ''), hint: '' };

  const stateOf = (row) => STATES[row && row.state] || STATES.down;

  /** Running first, then port-held, then stopped; by name inside each group. */
  function sortRows(rows) {
    return [...rows].sort((a, b) => {
      const d = (ORDER[a.state] ?? 3) - (ORDER[b.state] ?? 3);
      return d || String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' });
    });
  }

  function summary(rows) {
    const count = (s) => rows.filter((r) => r.state === s).length;
    const parts = [`${count('up')} running`];
    if (count('blocked')) parts.push(`${count('blocked')} port held`);
    parts.push(`${count('down')} stopped`);
    return parts.join(' · ');
  }

  function ago(iso, now = Date.now()) {
    const s = Math.round((now - Date.parse(iso)) / 1000);
    if (!Number.isFinite(s)) return 'earlier';
    if (s < 90) return `${Math.max(0, s)}s ago`;
    if (s < 5400) return `${Math.round(s / 60)}m ago`;
    return `${Math.round(s / 3600)}h ago`;
  }

  /** "Started by claude 4a2f, 3m ago", or '' with no claim. A claim is advisory and never blocks. */
  function claimLine(claim, now) {
    if (!claim || !claim.by) return '';
    return `In use by ${claim.by} · ${ago(claim.at, now)}`;
  }

  /** First free port from 9231 up (9222-9230 and 9240 are the usual hand-made pool). */
  function suggestPort(profiles) {
    const used = new Set(profiles.map((p) => Number(p.port)));
    let port = 9231;
    while (used.has(port) || port === 9240) port += 1;
    return port;
  }

  /** The browser a new profile starts on: the one the newest profile uses if it is installed, else the first installed. */
  function defaultBrowser(profiles, installed) {
    const ids = installed.map((b) => b.id);
    const last = profiles.length ? profiles[profiles.length - 1].browser : null;
    return ids.includes(last) ? last : (ids[0] || '');
  }

  /** "3 tabs: Dashboard, Settings, ..." */
  function tabsLine(tabs) {
    if (!tabs || !tabs.length) return '';
    const names = tabs.slice(0, 3).map((t) => (t.title || t.url || 'untitled').slice(0, 40));
    const more = tabs.length > names.length ? ', ...' : '';
    return `${tabs.length} tab${tabs.length === 1 ? '' : 's'}: ${names.join(', ')}${more}`;
  }

  // ---- History expander ----------------------------------------------------------

  const DAY = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  const CLOCK = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  const MAX_SHOWN_TABS = 6;

  /** "Mon 13 Oct, 14:02 - 14:40" in local time; an open session has no end: "Mon 13 Oct, 14:02". */
  function sessionWhen(e) {
    const a = new Date(e && e.startedAt);
    if (Number.isNaN(a.getTime())) return '';
    const head = `${DAY.format(a).replace(/,/g, '')}, ${CLOCK.format(a)}`;
    const b = e.stoppedAt ? new Date(e.stoppedAt) : null;
    if (!b || Number.isNaN(b.getTime())) return head;
    return `${head} - ${a.toDateString() === b.toDateString() ? '' : `${DAY.format(b).replace(/,/g, '')}, `}${CLOCK.format(b)}`;
  }

  /** Who started a session: "you" for the desktop, "claude b71c" (or the agent's name) otherwise. */
  function startedByWord(by) {
    if (!by) return 'unknown';
    if (by.kind === 'human') return 'you';
    if (by.label) return String(by.label);
    return by.sessionId ? `claude ${String(by.sessionId).replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toLowerCase()}` : (by.kind || 'unknown');
  }

  /** How a session ended: "stopped by you", "closed outside PortPilot", or '' while it runs. */
  function endedWord(e) {
    if (!e || !e.stoppedAt) return '';
    const by = e.endedBy;
    if (!by) return 'ended';
    if (by.reason === 'closed') return 'closed outside PortPilot';
    if (by.reason === 'unknown') return 'end not seen';
    return `stopped by ${startedByWord(by)}`;
  }

  /** One line for a past session: when, who, tab count, how it ended. */
  function sessionLine(e) {
    const n = (e.tabs || []).length;
    return [sessionWhen(e), `started by ${startedByWord(e.startedBy)}`, `${n} tab${n === 1 ? '' : 's'}`, e.stoppedAt ? endedWord(e) : 'running now'].filter(Boolean).join(' · ');
  }

  /** A tab's label: its title, else the address without the scheme. */
  function tabLabel(t) {
    const title = String((t && t.title) || '').trim();
    if (title) return title.slice(0, 80);
    return String((t && t.url) || '').replace(/^[a-z]+:\/\//i, '').slice(0, 80);
  }

  /** The tabs to list for a session and how many were left out. */
  function shownTabs(e) {
    const tabs = (e && e.tabs) || [];
    return { shown: tabs.slice(0, MAX_SHOWN_TABS), more: Math.max(0, tabs.length - MAX_SHOWN_TABS) };
  }

  /** The toast after Open again. */
  function reopenText(res) {
    const n = res.opened || 0;
    const parts = [n ? `Opened ${n} tab${n === 1 ? '' : 's'} in ${res.name}` : `Started ${res.name}; no tabs to add`];
    if (res.failed) parts.push(`${res.failed} could not be opened`);
    if (res.hidden) parts.push('Addresses had secrets hidden when saved, so some pages may ask you to sign in again');
    return parts.join('. ');
  }

  // ---- Purpose, sites and window ---------------------------------------------------

  /** "Google Search Console · search.google.com, analytics.google.com", or '' when neither is set. */
  function purposeLine(row) {
    const sites = Array.isArray(row && row.sites) ? row.sites : [];
    return [row && row.purpose, sites.join(', ')].filter(Boolean).join(' · ');
  }

  /** "1200x800 at 100,50 · stays in front" for a saved window; '' when nothing is saved. */
  function windowLine(w) {
    if (!w) return '';
    const size = Number.isFinite(w.width) || Number.isFinite(w.height) ? `${Number.isFinite(w.width) ? w.width : '?'}x${Number.isFinite(w.height) ? w.height : '?'}` : '';
    const at = Number.isFinite(w.left) || Number.isFinite(w.top) ? `${Number.isFinite(w.left) ? w.left : '?'},${Number.isFinite(w.top) ? w.top : '?'}` : '';
    const place = [size, at && `at ${at}`].filter(Boolean).join(' ');
    return [place, w.front ? 'stays in front' : ''].filter(Boolean).join(' · ');
  }

  /** The toast after Start when a saved window did not land where it was asked to. */
  function placementWarning(win) {
    if (!win) return '';
    const bits = [];
    if (win.requested && Object.keys(win.requested).length && !win.applied) {
      bits.push(win.actual ? 'The window is not exactly where the profile says: the system adjusted it.' : 'The window could not be placed.');
    }
    if (win.front && win.front.topmost === false) bits.push('Always-on-top did not take; the window was brought to the front once.');
    return bits.join(' ');
  }

  // The API's `action` text is written for a model ("Call list_browser_profiles ..."). A person
  // gets the same advice in their own terms.
  const NEXT = {
    PORT_HELD: 'Close the program using that port, or edit this profile to use another port.',
    NOT_OURS: 'Something else started that browser, so PortPilot will not stop it. Close it yourself.',
    NOT_VERIFIED: 'PortPilot could not confirm that browser is this profile. Close it yourself.',
    BROWSER_NOT_FOUND: 'Edit the profile and pick a browser that is installed.',
    START_TIMEOUT: 'Try Start again. If it fails again, close any window already using this profile.',
    LAUNCH_FAILED: 'Check that the browser starts normally on its own.',
    STOP_FAILED: 'Close that browser window yourself.',
    SOURCE_RUNNING: 'Stop the profile first, then duplicate it.',
    PROFILE_RUNNING: 'Stop the profile first.',
    COPY_FAILED: 'Close any browser window using the profile and try again.',
    DUPLICATE_NAME: 'Pick a name that is not already used.',
    DUPLICATE_PORT: 'Pick a port that no other profile uses.',
    DUPLICATE_DIR: 'Pick another name.',
    BAD_BROWSER: 'Pick a browser from the list.',
    BAD_NAME: 'Use letters, digits, dot, dash or underscore.',
    BAD_PORT: 'Use a port from 1024 to 65535.',
    BAD_URL: 'Start with http://, https:// or file://, or leave it blank.',
    BAD_SITES: 'List only hostnames such as search.google.com, separated by commas.',
    BAD_PURPOSE: 'Keep it to a short phrase.',
    BAD_WINDOW: 'Leave a field blank to keep it free, or use whole numbers.',
    NOT_RUNNING: 'Start the profile, put its window where you want it, then capture.',
    CAPTURE_FAILED: 'Open a page in the browser window and try again.',
    BUSY: 'Wait for the current action to finish.',
    IN_USE: 'Another Claude session is using this profile. Pick another profile or ask that session to stop it.',
  };

  /** One sentence for the panel: the error as written, then the next step in plain words. */
  function failureText(res) {
    if (!res) return 'Something went wrong.';
    const error = String(res.error || 'Something went wrong.').replace(/\s+/g, ' ').trim().replace(/^[a-z]/, (c) => c.toUpperCase());
    const next = NEXT[res.code];
    return next ? `${error.replace(/[.\s]+$/, '')}. ${next}` : error;
  }

  /** "Vault Pass 1.10.2, uBlock Origin 1.5" or a plain empty-state sentence. */
  function extensionsText(list) {
    if (!list || !list.length) return 'No extensions installed in this profile yet.';
    return list.map((e) => `${e.name} ${e.version}`).join(', ');
  }

  return { STATES, MODES, modeInfo, stateOf, sortRows, summary, ago, claimLine, suggestPort, defaultBrowser, tabsLine, failureText, extensionsText,
    purposeLine, windowLine, placementWarning,
    sessionWhen, startedByWord, endedWord, sessionLine, tabLabel, shownTabs, reopenText };
});
