/**
 * Browser history (plan row 26, slice 3): what each browser profile had open, and when.
 *
 * Every profile start and stop is one record in <configDir>/history/browser-runs.json, written
 * with configFile.updateJson (lock + atomic rename) like runs.json beside it:
 *
 *   { id, profile, port, browser, mode, startedBy, startedAt, stoppedAt, endedBy, tabs, sampledAt }
 *
 * `tabs` is [{ url, title }]: the page tabs seen the last time anyone looked (sampled about every
 * 30 s while the browser runs, and once more at stop). Only the URL and the title are stored, and
 * every URL is redacted first: userinfo is dropped and the value of any query or fragment parameter
 * whose name looks like a secret (token, key, code, auth, session, password ...) becomes `***`.
 * Only http, https and file pages are kept; chrome://, devtools:// and about:blank are not history.
 *
 * Also here: linking a dev server to the profile it was tested in. A tab on localhost:<port>
 * whose port belongs to a run that is open in runs.json stamps that run with
 * `testedIn: [{ profile, at }]` (additive; the History tab shows it).
 *
 * Nothing here talks to a browser: the sampler is handed `deps` ({ version, pageTabs }) so tests
 * run against a fake. Reading a page is limited to /json on the profile's own loopback port; no
 * page is ever navigated or evaluated. Zero dependencies.
 */
const crypto = require('crypto');
const path = require('path');
const configFile = require('./configFile');

const DEFAULT_MAX_ENTRIES = 500;
const MAX_TABS = 50;
const MAX_TITLE = 200;
const MAX_URL = 1000;
const MAX_TESTED_IN = 5;
// PORTPILOT_BROWSER_SAMPLE_MS is for the end-to-end test, which cannot wait 30 s per sample.
const SAMPLE_MS = Math.max(500, Number(process.env.PORTPILOT_BROWSER_SAMPLE_MS) || 30000);
// A browser that stops answering for this many samples in a row is recorded as closed.
const MISSES_TO_CLOSE = 2;

const SHOWN_PROTOCOLS = new Set(['http:', 'https:', 'file:']);
// A parameter NAME that looks like it carries a secret. Over-matching ("keyword") is the safe side.
const SECRET_NAME_RE = /token|key|code|auth|secret|session|pass|pwd|jwt|bearer|signature|credential|otp/i;
const SECRET_EXACT_RE = /^(sid|sig)$/i;
const looksSecret = (name) => SECRET_NAME_RE.test(name) || SECRET_EXACT_RE.test(name);

const historyPathFor = (configPath) => path.join(path.dirname(configPath), 'history', 'browser-runs.json');
// runs.json lives next to it; written here without runHistory.js, which cannot be bundled into the plugin.
const runsPathFor = (configPath) => path.join(path.dirname(configPath), 'history', 'runs.json');
const emptyHistory = () => ({ v: 1, runs: [] });
const emptyRuns = () => ({ v: 1, runs: [] });
const lower = (s) => String(s).toLowerCase();

// ---- URL redaction -----------------------------------------------------------

/** "a=1&token=x" with every secret-named value replaced by ***. Other pairs are kept byte for byte. */
function redactPairs(str) {
  return str.split('&').map((pair) => {
    const eq = pair.indexOf('=');
    if (eq < 1) return pair;
    let name = pair.slice(0, eq);
    try { name = decodeURIComponent(name.replace(/\+/g, ' ')); } catch { /* keep it raw */ }
    return looksSecret(name) ? `${pair.slice(0, eq)}=***` : pair;
  }).join('&');
}

/** The fragment with secret parameters hidden; a bare token-like blob (no slash, 32+ chars) is hidden whole. */
function redactFragment(hash) {
  const frag = hash.replace(/^#/, '');
  if (!frag) return '';
  const q = frag.indexOf('?');
  if (q >= 0) return `${frag.slice(0, q)}?${redactPairs(frag.slice(q + 1))}`;
  if (frag.includes('=')) return redactPairs(frag);
  if (frag.length >= 32 && !frag.includes('/') && /^[A-Za-z0-9._~+-]+$/.test(frag)) return '***';
  return frag;
}

/**
 * A page URL made safe to keep, or null when it is not a page worth remembering.
 * Never throws.
 */
function redactUrl(raw) {
  let u;
  try { u = new URL(String(raw)); } catch { return null; }
  if (!SHOWN_PROTOCOLS.has(u.protocol)) return null;
  u.username = '';
  u.password = '';
  if (u.search) u.search = `?${redactPairs(u.search.slice(1))}`;
  if (u.hash) {
    const frag = redactFragment(u.hash);
    u.hash = frag ? `#${frag}` : '';
  }
  let out = u.toString();
  if (out.length > MAX_URL) out = `${u.origin === 'null' ? `${u.protocol}//` : u.origin}${u.pathname}`.slice(0, MAX_URL);
  return out;
}

const cleanTitle = (t) => String(t == null ? '' : t).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE);

/** [{ url, title }] safe to store: redacted, http/https/file only, no duplicates, capped. */
function cleanTabs(tabs) {
  const out = [];
  const seen = new Set();
  for (const t of Array.isArray(tabs) ? tabs : []) {
    const url = redactUrl(t && t.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({ url, title: cleanTitle(t.title) });
    if (out.length >= MAX_TABS) break;
  }
  return out;
}

// ---- Records -----------------------------------------------------------------

function readAll(configPath) {
  const data = configFile.readJson(historyPathFor(configPath), emptyHistory);
  return Array.isArray(data.runs) ? data.runs : [];
}

function newId(now) {
  const stamp = new Date(now).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, '');
  return `b_${stamp}_${crypto.randomBytes(4).toString('hex')}`;
}

function maxEntriesFor(configPath) {
  const settings = (configFile.readJson(configPath, () => ({})) || {}).settings || {};
  const n = Math.floor(Number(settings.browserHistoryMaxRuns));
  return Number.isFinite(n) && n >= 10 ? n : DEFAULT_MAX_ENTRIES;
}

/** Drop the oldest CLOSED entries until `max` hold. An open entry is never dropped. */
function trim(runs, max) {
  for (let i = 0; i < runs.length && runs.length > max;) {
    if (runs[i].stoppedAt) runs.splice(i, 1); else i++;
  }
}

const who = (v) => {
  if (!v || typeof v !== 'object') return null;
  const out = {};
  for (const k of ['kind', 'surface', 'sessionId', 'label', 'reason', 'at']) if (v[k]) out[k] = String(v[k]).slice(0, 200);
  return Object.keys(out).length ? out : null;
};

/**
 * Record that a profile's browser is up. An entry still open for the same profile was lost without
 * a stop being seen, so it is closed as 'unknown' first. Returns the new id.
 * @param {object} o { profile, port, browser, mode, startedBy, tabs?, now? }
 */
function openSession(configPath, o) {
  const now = o.now || Date.now();
  const startedAtIso = new Date(now).toISOString();
  const max = maxEntriesFor(configPath);
  const entry = {
    id: newId(now),
    profile: String(o.profile),
    port: Number(o.port) || null,
    browser: o.browser || null,
    mode: o.mode || null,
    startedBy: who(o.startedBy),
    startedAt: startedAtIso,
    stoppedAt: null,
    endedBy: null,
    tabs: cleanTabs(o.tabs),
    sampledAt: startedAtIso,
  };
  configFile.updateJson(historyPathFor(configPath), (data) => {
    if (!Array.isArray(data.runs)) data.runs = [];
    for (const r of data.runs) {
      if (!r.stoppedAt && lower(r.profile) === lower(entry.profile)) {
        r.stoppedAt = startedAtIso;
        r.endedBy = { kind: 'external', reason: 'unknown' };
      }
    }
    data.runs.push(entry);
    trim(data.runs, max);
  }, emptyHistory);
  return entry.id;
}

/** The open entry for a profile, or null. */
function openEntryFor(configPath, profile) {
  return readAll(configPath).find((r) => !r.stoppedAt && lower(r.profile) === lower(profile)) || null;
}

/**
 * Replace the tabs of a profile's open entry. An empty list never overwrites a known one (a browser
 * mid-start shows no pages for a moment). Writes nothing when the tabs are unchanged.
 * @returns {boolean} true when the entry changed
 */
function sampleSession(configPath, profile, tabs, now = Date.now()) {
  const clean = cleanTabs(tabs);
  if (!clean.length) return false;
  const { result } = configFile.updateJson(historyPathFor(configPath), (data) => {
    const open = (data.runs || []).find((r) => !r.stoppedAt && lower(r.profile) === lower(profile));
    if (!open || JSON.stringify(open.tabs) === JSON.stringify(clean)) return false;
    open.tabs = clean;
    open.sampledAt = new Date(now).toISOString();
    return true;
  }, emptyHistory);
  return !!result;
}

/**
 * Close a profile's open entry. `tabs` (the tabs seen just before the stop) replaces the sampled ones
 * when it is not empty. No open entry: nothing is written.
 * @param {object} o { endedBy, tabs?, now? }
 * @returns {string|null} the closed entry's id
 */
function closeSession(configPath, profile, o = {}) {
  const now = o.now || Date.now();
  const clean = cleanTabs(o.tabs);
  const { result } = configFile.updateJson(historyPathFor(configPath), (data) => {
    const open = (data.runs || []).find((r) => !r.stoppedAt && lower(r.profile) === lower(profile));
    if (!open) return null;
    open.stoppedAt = new Date(now).toISOString();
    open.endedBy = who(o.endedBy) || { kind: 'external', reason: 'unknown' };
    if (clean.length) { open.tabs = clean; open.sampledAt = open.stoppedAt; }
    return open.id;
  }, emptyHistory);
  return result;
}

/** "24h", "7d", "30m" or an ISO date/time -> epoch ms, or null when it is neither. */
function parseSince(since, now = Date.now()) {
  if (since == null || since === '') return undefined;
  const m = /^(\d+)\s*([mhd])$/i.exec(String(since).trim());
  if (m) return now - Number(m[1]) * { m: 60000, h: 3600000, d: 86400000 }[m[2].toLowerCase()];
  const t = Date.parse(String(since));
  return Number.isNaN(t) ? null : t;
}

/**
 * Newest first. Filters: profile (case-insensitive), since (epoch ms: entries that started at or
 * after it, or are still open), limit.
 * @returns {{ total: number, entries: object[] }} total counts the matches before `limit`
 */
function listSessions(configPath, { profile, since, limit = 10 } = {}) {
  let list = readAll(configPath);
  if (profile) list = list.filter((r) => lower(r.profile) === lower(profile));
  if (typeof since === 'number') list = list.filter((r) => !r.stoppedAt || Date.parse(r.startedAt) >= since);
  list = [...list].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  return { total: list.length, entries: list.slice(0, Math.max(1, limit)) };
}

function getSession(configPath, id) {
  return readAll(configPath).find((r) => r.id === id) || null;
}

// ---- Dev server -> profile link ------------------------------------------------

/** The port of a tab on localhost, 127.0.0.1 or [::1]; null for anything else. */
function localhostPort(url) {
  let u;
  try { u = new URL(String(url)); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (!/^(localhost|127\.0\.0\.1|\[::1\])$/i.test(u.hostname)) return null;
  const port = Number(u.port) || (u.protocol === 'https:' ? 443 : 80);
  return port;
}

/**
 * Stamp the open dev-server runs whose port a tab is on with testedIn: [{ profile, at }].
 * Best effort and additive: a run keeps every other field, and a profile is listed once.
 * @returns {string[]} ids of the runs that were stamped
 */
function linkTestedRuns(configPath, profile, tabs, now = Date.now()) {
  const ports = new Set((Array.isArray(tabs) ? tabs : []).map((t) => localhostPort(t && t.url)).filter((p) => p));
  if (!ports.size) return [];
  const wants = (data) => (Array.isArray(data.runs) ? data.runs : []).filter((r) => !r.stoppedAt && ports.has(Number(r.port))
    && !(Array.isArray(r.testedIn) && r.testedIn.some((x) => lower(x.profile) === lower(profile))));
  // Read first: a sample that finds nothing new must not take the runs.json lock.
  if (!wants(configFile.readJson(runsPathFor(configPath), emptyRuns)).length) return [];
  const { result } = configFile.updateJson(runsPathFor(configPath), (data) => {
    const stamped = [];
    for (const r of wants(data)) {
      r.testedIn = [...(Array.isArray(r.testedIn) ? r.testedIn : []), { profile: String(profile), at: new Date(now).toISOString() }].slice(-MAX_TESTED_IN);
      stamped.push(r.id);
    }
    return stamped;
  }, emptyRuns);
  return result;
}

// ---- Sampler -------------------------------------------------------------------

/**
 * One pass over every open entry: read its tabs, store them, link dev servers, and close an entry
 * whose browser has stopped answering for MISSES_TO_CLOSE passes. `misses` is the caller's Map(id -> count).
 * @param {object} d { version(port), pageTabs(port) }
 */
async function sampleOnce(configPath, d, { misses = new Map(), now = Date.now() } = {}) {
  const out = { sampled: 0, closed: 0 };
  for (const e of readAll(configPath).filter((r) => !r.stoppedAt)) {
    let v = null;
    try { v = await d.version(e.port); } catch { /* counts as a miss */ }
    if (!v) {
      const n = (misses.get(e.id) || 0) + 1;
      misses.set(e.id, n);
      if (n >= MISSES_TO_CLOSE) {
        closeSession(configPath, e.profile, { endedBy: { kind: 'external', reason: 'closed' }, now });
        misses.delete(e.id);
        out.closed += 1;
      }
      continue;
    }
    misses.delete(e.id);
    let tabs = [];
    try { tabs = await d.pageTabs(e.port); } catch { /* keep what we had */ }
    sampleSession(configPath, e.profile, tabs, now);
    linkTestedRuns(configPath, e.profile, tabs, now);
    out.sampled += 1;
  }
  return out;
}

/**
 * Sample every SAMPLE_MS while this process lives. The timer is unref'd, so it never keeps a process
 * alive. Several processes may run one (the desktop and each MCP server): a sample replaces tabs
 * with the same answer, so the extra passes change nothing. Returns stop().
 */
function startSampler(configPath, d, { intervalMs = SAMPLE_MS } = {}) {
  const misses = new Map();
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try { await sampleOnce(configPath, d, { misses }); } catch (err) { console.error('[browserHistory] sample failed:', err.message); } finally { running = false; }
  }, intervalMs);
  if (timer.unref) timer.unref();
  return () => clearInterval(timer);
}

module.exports = {
  DEFAULT_MAX_ENTRIES, MAX_TABS, SAMPLE_MS, MISSES_TO_CLOSE,
  historyPathFor, redactUrl, cleanTabs, localhostPort, parseSince, trim,
  openSession, openEntryFor, sampleSession, closeSession, listSessions, getSession,
  linkTestedRuns, sampleOnce, startSampler,
};
