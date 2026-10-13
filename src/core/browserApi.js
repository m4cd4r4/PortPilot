/**
 * The browser-profile tools (plan row 26, slice 2): one set of five tools that the MCP server and
 * the web agent both expose, so a model asks for a profile by NAME and PortPilot supplies the port
 * and the CDP URL. A caller never chooses a port.
 *
 *   list_browser_profiles  list_browsers  start_browser  stop_browser  set_browser_mode  browser_history
 *
 * Every call resolves, never rejects. Success is `{ success: true, ... }`; failure is
 * `{ success: false, code, error, action }`: `error` is one plain sentence (it names the process
 * holding a blocked port) and `action` is the one thing the caller should do next. The slice 1
 * safety rules stay in browserRun.js: nothing here kills or starts anything on its own.
 *
 * Claim marker: who started or holds a profile lives in portpilot-browser-claims.json beside the
 * config, never in the config itself. A claim is shown only while the browser it was made for is
 * still the one running (same pid), so a crash or an outside restart cannot leave a stale name behind.
 *
 * Lease (browserLease.js): a claim made by a Claude session is a lease while that session's heartbeat
 * is live. Another session that names itself is refused with IN_USE (start_browser and stop_browser)
 * unless it passes takeover:true. A caller that names no session (a person in the desktop app) is
 * never refused, and a lease whose owner has gone quiet is free.
 *
 * History (browserHistory.js): every start and stop is recorded with the tabs that were open, and
 * browser_history lists them.
 *
 * Side effects go through ctx.deps (browserRun's `deps`), so tests use the slice 1 fake spawner.
 * Zero dependencies.
 */
const path = require('path');
const configFile = require('./configFile');
const profiles = require('./browserProfiles');
const run = require('./browserRun');
const history = require('./browserHistory');
const lease = require('./browserLease');

const CLAIMS_FILE = 'portpilot-browser-claims.json';
const emptyClaims = () => ({ profiles: {} });
const lower = (s) => String(s).toLowerCase();

class ApiError extends Error {
  constructor(code, message, extra = {}) { super(message); this.name = 'ApiError'; this.code = code; Object.assign(this, extra); }
}

// ---- Claims ------------------------------------------------------------------

const claimsPathFor = (configPath) => path.join(path.dirname(configPath), CLAIMS_FILE);

function readClaims(configPath) {
  const file = configFile.readJson(claimsPathFor(configPath), emptyClaims);
  return file && file.profiles && typeof file.profiles === 'object' ? file.profiles : {};
}

/** Best effort: a failed stamp must never fail the start or stop it describes. */
function writeClaim(configPath, name, claim) {
  try {
    configFile.updateJson(claimsPathFor(configPath), (file) => {
      if (!file.profiles || typeof file.profiles !== 'object') file.profiles = {};
      if (claim) file.profiles[lower(name)] = claim; else delete file.profiles[lower(name)];
    }, emptyClaims);
  } catch (err) {
    console.error('[browserApi] Failed to write claim:', err.message);
  }
}

/** The claim, only while it belongs to the browser that is up now. */
function liveClaim(configPath, st) {
  if (st.state !== 'up') return null;
  const c = readClaims(configPath)[lower(st.name)];
  if (!c || typeof c.by !== 'string') return null;
  if (c.pid != null && st.pid != null && c.pid !== st.pid) return null;
  return c;
}

const publicClaim = (c) => {
  const out = { by: c.by, surface: c.surface, at: c.at };
  if (c.sessionId) out.sessionId = c.sessionId;
  return out;
};

/** Who is asking: an agent name the caller supplied, else the Claude session, else the surface. */
function callerOf(args, ctx) {
  // Both strings are shown to other callers' models, so only plain label characters get through:
  // no quotes, punctuation or newlines a caller could use to write instructions into someone else's result.
  const clean = (s, max) => String(typeof s === 'string' ? s : '').replace(/[^A-Za-z0-9 ._-]/g, '').trim().slice(0, max);
  const sessionId = clean(args.sessionId, 100);
  const short = sessionId.replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toLowerCase();
  const by = clean(args.agent, 40) || (short ? `claude ${short}` : `unnamed ${ctx.surface} caller`);
  const out = { by, surface: ctx.surface, at: new Date().toISOString() };
  if (sessionId) out.sessionId = sessionId;
  return out;
}

const ago = (iso) => lease.ago(iso);

// ---- Result shapes -----------------------------------------------------------

const cdpUrlFor = (port) => `http://127.0.0.1:${port}`;

function view(st, claim) {
  const out = { name: st.name, port: st.port, cdpUrl: cdpUrlFor(st.port), state: st.state, mode: st.mode, browser: st.browser };
  if (claim) out.claim = publicClaim(claim);
  if (st.warning) { out.warning = st.warning.sentence; out.holder = st.warning.holder; }
  return out;
}

const NEXT = {
  NOT_FOUND: 'Call list_browser_profiles and use one of the names it returns.',
  BAD_ARGS: 'Send the missing argument named in the error.',
  PORT_HELD: 'Do not kill it and do not pick another port. Tell the user which process holds the port and ask them to free it.',
  NOT_OURS: 'Leave it running: this profile did not start that process. Ask the user.',
  NOT_VERIFIED: 'Leave it alone and ask the user to close that browser by hand.',
  BROWSER_NOT_FOUND: 'Call list_browsers, then ask the user to set the profile to an installed browser.',
  START_TIMEOUT: 'Call start_browser once more. If it fails again, ask the user to close any window using this profile.',
  LAUNCH_FAILED: 'Ask the user to check that the browser starts normally.',
  STOP_FAILED: 'Ask the user to close that browser window by hand.',
  BAD_MODE: `Use one of: ${profiles.MODES.join(', ')}.`,
  IN_USE: 'Do not use it. Call list_browser_profiles and pick a profile that shows free: true, or call start_browser with name "any" to be given one. Only if the user agrees to share this one, call again with takeover:true.',
  NO_FREE_PROFILE: 'Every profile is in use or blocked. Ask the user to add a profile in the PortPilot Browsers tab, or to say which one you may take over (then call start_browser with its name and takeover:true).',
  UNKNOWN_TOOL: 'Use one of: list_browser_profiles, list_browsers, start_browser, stop_browser, set_browser_mode, browser_history.',
};

function failure(err, configPath) {
  const code = typeof err.code === 'string' && /^[A-Z_]+$/.test(err.code) ? err.code : 'INTERNAL';
  const out = {
    success: false,
    code,
    error: String(err.message || err).replace(/\s+/g, ' ').trim(),
    action: (typeof err.action === 'string' && err.action) || NEXT[code] || 'Report this error to the user.',
  };
  if (err.holder) out.holder = err.holder;
  if (err.leasedTo) out.leasedTo = err.leasedTo;
  if (code === 'NOT_FOUND') {
    try { out.known = profiles.listProfiles(configPath).map((p) => p.name); } catch { /* the list is a courtesy */ }
  }
  return out;
}

const nameOf = (args) => {
  if (typeof args.name !== 'string' || !args.name.trim()) {
    throw new ApiError('BAD_ARGS', 'name is required: the profile name, as returned by list_browser_profiles (or "any" for start_browser)');
  }
  return args.name.trim();
};

const runOpts = (ctx) => ({ ...(ctx.pollMs ? { pollMs: ctx.pollMs } : {}), ...(ctx.timeoutMs ? { timeoutMs: ctx.timeoutMs } : {}) });

// ---- History and lease helpers -----------------------------------------------

/** Who did it, in the shape the History records keep: { kind, surface, sessionId?, label, at }. */
function startedByOf(caller) {
  const out = { kind: caller.surface === 'desktop' ? 'human' : 'claude', surface: caller.surface, label: caller.by, at: caller.at };
  if (caller.sessionId) out.sessionId = caller.sessionId;
  return out;
}

/** History is a record, never a gate: a failed write must not fail the start or stop it describes. */
function safely(what, fn) {
  try { return fn(); } catch (err) { console.error(`[browserApi] ${what} failed:`, err.message); return null; }
}

// One history sampler per config file for the life of this process (it reads each open session's
// tabs about every 30 s). Another process may run its own: both write the same answer.
const samplers = new Map();
function startHistorySampler(configPath, deps, o = {}) {
  const key = path.resolve(configPath);
  if (samplers.has(key)) return samplers.get(key);
  const stop = history.startSampler(configPath, deps, o);
  samplers.set(key, stop);
  return stop;
}
const ensureSampler = (configPath, ctx) => { if (ctx.sampler !== false) startHistorySampler(configPath, ctx.deps); };

/** The claim that counts for a profile right now: a running browser's own claim, or a launch under way. */
function claimFor(configPath, st) {
  if (st.state === 'up') return liveClaim(configPath, st);
  if (st.state === 'down') return readClaims(configPath)[lower(st.name)] || null;
  return null;
}

const leaseView = (l) => (l ? { by: l.by, session: l.short, since: l.since, ...(l.starting ? { starting: true } : {}) } : null);

const STOP_IN_USE = 'Leave it running: another session is using it. Only if the user agrees you should stop it, call stop_browser again with takeover:true.';

function inUse(profileName, l, extra = {}) {
  return new ApiError('IN_USE', lease.inUseSentence(profileName, l), { leasedTo: leaseView(l), ...extra });
}

/**
 * Claim a STOPPED profile before launching it, atomically, so two sessions asking for the same
 * profile in the same moment cannot both launch it. Returns the lease that beat us, or null.
 */
function reserve(configPath, name, caller, live, takeover) {
  let conflict = null;
  try {
    configFile.updateJson(claimsPathFor(configPath), (file) => {
      if (!file.profiles || typeof file.profiles !== 'object') file.profiles = {};
      const l = lease.leaseOf(file.profiles[lower(name)], 'down', live);
      if (l && lease.decide(l, caller.sessionId, takeover) === 'refused') { conflict = l; return; }
      file.profiles[lower(name)] = { ...caller, pid: null, starting: true };
    }, emptyClaims);
  } catch (err) {
    console.error('[browserApi] Failed to reserve profile:', err.message);
  }
  return conflict;
}

/** Undo reserve() after a failed launch, if the reservation is still ours. */
function release(configPath, name, caller) {
  try {
    configFile.updateJson(claimsPathFor(configPath), (file) => {
      const c = file.profiles && file.profiles[lower(name)];
      if (c && c.starting && c.sessionId === caller.sessionId) delete file.profiles[lower(name)];
    }, emptyClaims);
  } catch (err) {
    console.error('[browserApi] Failed to release reservation:', err.message);
  }
}

/** Start one named profile for `caller`, enforcing the lease. Returns the result fields; throws ApiError / RunError. */
async function startNamed(configPath, profile, caller, args, ctx) {
  const name = profile.name;
  const takeover = args.takeover === true;
  const sessioned = !!caller.sessionId;
  const live = sessioned ? lease.liveSessionIds(configPath) : new Set();
  let held = null; // a lease of another session this call overrides
  let reserved = false;
  if (sessioned) {
    const st0 = await run.profileStatus(configPath, profile, ctx.deps);
    const l = lease.leaseOf(claimFor(configPath, st0), st0.state, live);
    const verdict = lease.decide(l, caller.sessionId, takeover);
    if (verdict === 'refused') throw inUse(name, l);
    if (verdict === 'takeover') held = l;
    if (st0.state === 'down') {
      const conflict = reserve(configPath, name, caller, live, takeover);
      if (conflict) throw inUse(name, conflict);
      reserved = true;
    }
  }

  let r;
  try {
    r = await run.startProfile(configPath, name, runOpts(ctx), ctx.deps);
  } catch (err) {
    if (reserved) release(configPath, name, caller);
    throw err;
  }

  let claim = r.already ? liveClaim(configPath, r) : null;
  // A running browser whose owning session is gone passes to the session that asks for it now.
  const ownerGone = !!(claim && sessioned && claim.sessionId && lease.cleanId(claim.sessionId) !== lease.cleanId(caller.sessionId)
    && !live.has(lease.cleanId(claim.sessionId)));
  if (!claim || held || ownerGone) {
    claim = { ...caller, pid: r.pid ?? null };
    writeClaim(configPath, r.name, claim);
  }

  safely('history', () => {
    if (!r.already) {
      history.openSession(configPath, { profile: r.name, port: r.port, browser: r.browser, mode: r.mode, startedBy: startedByOf(caller), tabs: r.tabs });
    } else if (!history.openEntryFor(configPath, r.name)) {
      // Up before anything was recording (started outside, or before this feature): start the record now.
      history.openSession(configPath, {
        profile: r.name, port: r.port, browser: r.browser, mode: r.mode, tabs: r.tabs,
        startedBy: { kind: claim.surface === 'desktop' ? 'human' : 'claude', surface: claim.surface, sessionId: claim.sessionId, label: claim.by, at: claim.at },
      });
    }
  });
  ensureSampler(configPath, ctx);

  const out = { ...view(r, claim), already: !!r.already };
  if (r.offscreen) out.offscreen = r.offscreen;
  if (held) {
    out.takeoverNote = `Took "${r.name}" over from ${held.by}${held.short && !String(held.by).includes(held.short) ? ` (session ${held.short})` : ''}. They may still be using it: leave tabs you did not open alone, and tell the user.`;
  } else if (claim.by !== caller.by) {
    out.claimNote = `Claimed by "${claim.by}" (${ago(claim.at)}). Not blocked: you may use it, but leave tabs you did not open alone.`;
  }
  return out;
}

const isAnyRequest = (args, stored) => {
  const n = typeof args.name === 'string' ? args.name.trim() : '';
  if (!n) return args.free === true;
  return lower(n) === 'any' && !stored.some((p) => lower(p.name) === 'any');
};

/** start_browser with name "any": the profile this session already holds, else a free one. */
async function startAny(configPath, args, caller, ctx) {
  const stored = profiles.listProfiles(configPath);
  if (!stored.length) {
    throw new ApiError('NO_FREE_PROFILE', 'there are no browser profiles yet', { action: 'Ask the user to add a profile in the PortPilot Browsers tab.' });
  }
  const { rows } = await run.allStatus(configPath, stored, ctx.deps);
  const live = lease.liveSessionIds(configPath);
  const me = lease.cleanId(caller.sessionId);
  const info = rows.map((st) => {
    const claim = claimFor(configPath, st);
    const l = lease.leaseOf(claim, st.state, live);
    return { name: st.name, state: st.state, mine: !!(l && me && l.sessionId === me && st.state === 'up'), free: lease.isFree(st, claim, l) };
  });
  let first = null;
  for (const c of lease.pickOrder(info)) {
    try {
      const out = await startNamed(configPath, profiles.getProfile(configPath, c.name), caller, { ...args, takeover: false }, ctx);
      return { ...out, picked: true };
    } catch (err) {
      first = first || err; // another session won this one, or it would not start: try the next
    }
  }
  if (first && first.code !== 'IN_USE') throw first;
  throw new ApiError('NO_FREE_PROFILE', `all ${rows.length} browser profile${rows.length === 1 ? ' is' : 's are'} in use, held by another program, or running with an owner that cannot be identified`);
}

// ---- Tools -------------------------------------------------------------------

const HISTORY_DEFAULT = 10;
const HISTORY_MAX = 50;

const TOOLS = {
  async list_browser_profiles(configPath, args, ctx) {
    const stored = profiles.listProfiles(configPath);
    const { rows, warnings } = await run.allStatus(configPath, stored, ctx.deps);
    const live = lease.liveSessionIds(configPath);
    const me = lease.cleanId(args.sessionId);
    const out = rows.map((st) => {
      const claim = claimFor(configPath, st);
      const l = lease.leaseOf(claim, st.state, live);
      const row = view(st, st.state === 'up' ? claim : null);
      row.free = lease.isFree(st, claim, l);
      row.leasedTo = leaseView(l);
      if (l && me && l.sessionId === me) row.mine = true;
      const p = stored.find((x) => x.name === st.name) || {};
      if (p.url) row.url = p.url;
      if (p.note) row.note = p.note;
      if (st.tabs && st.tabs.length) row.tabs = st.tabs.slice(0, 5).map((t) => ({ title: t.title, url: t.url }));
      return row;
    });
    return { success: true, profiles: out, warnings: warnings.map((w) => w.sentence) };
  },

  async list_browsers(configPath, args, ctx) {
    return { success: true, browsers: ctx.deps.detect().map((b) => ({ id: b.id, label: b.label })) };
  },

  async start_browser(configPath, args, ctx) {
    const stored = profiles.listProfiles(configPath);
    const caller = callerOf(args, ctx);
    if (isAnyRequest(args, stored)) return { success: true, ...(await startAny(configPath, args, caller, ctx)) };
    const name = nameOf(args);
    const profile = profiles.getProfile(configPath, name); // NOT_FOUND before anything runs
    return { success: true, ...(await startNamed(configPath, profile, caller, args, ctx)) };
  },

  async stop_browser(configPath, args, ctx) {
    const name = nameOf(args);
    const profile = profiles.getProfile(configPath, name);
    const caller = callerOf(args, ctx);
    const st0 = await run.profileStatus(configPath, profile, ctx.deps);
    const before = liveClaim(configPath, st0);
    let held = null;
    if (caller.sessionId) {
      const l = lease.leaseOf(claimFor(configPath, st0), st0.state, lease.liveSessionIds(configPath));
      const verdict = lease.decide(l, caller.sessionId, args.takeover === true);
      if (verdict === 'refused') throw inUse(profile.name, l, { action: STOP_IN_USE });
      if (verdict === 'takeover') held = l;
    }
    const r = await run.stopProfile(configPath, name, runOpts(ctx), ctx.deps);
    // Drop the claim only if it still belongs to the browser just stopped: a caller who started a
    // new one in the meantime keeps theirs.
    const stored = readClaims(configPath)[lower(profile.name)];
    if (stored && (st0.state === 'down' || stored.pid == null || stored.pid === st0.pid)) writeClaim(configPath, profile.name, null);
    safely('history', () => history.closeSession(configPath, profile.name, {
      endedBy: r.already ? { kind: 'external', reason: 'unknown' } : startedByOf(caller),
      tabs: st0.state === 'up' ? st0.tabs : [],
    }));
    const out = { ...view(r, null), already: !!r.already };
    if (held) {
      out.takeoverNote = `Stopped "${profile.name}", which ${held.by} was using. Tell the user.`;
    } else if (before && before.by !== caller.by) {
      out.claimNote = `Was claimed by "${before.by}" (${ago(before.at)}). Stopped anyway: claims are advisory.`;
    }
    return { success: true, ...out };
  },

  async set_browser_mode(configPath, args, ctx) {
    const name = nameOf(args);
    if (typeof args.mode !== 'string') {
      throw new ApiError('BAD_ARGS', `mode is required: one of ${profiles.MODES.join(', ')}`);
    }
    profiles.getProfile(configPath, name);
    const p = profiles.updateProfile(configPath, name, { mode: args.mode });
    const st = await run.profileStatus(configPath, p, ctx.deps);
    const out = { ...view(st, liveClaim(configPath, st)) };
    if (st.state === 'up') {
      out.note = 'The running browser keeps its old mode. Call stop_browser, then start_browser, to apply it.';
    }
    return { success: true, ...out };
  },

  async browser_history(configPath, args) {
    let limit = HISTORY_DEFAULT;
    if (args.limit != null) {
      limit = Number(args.limit);
      if (!Number.isInteger(limit) || limit < 1) throw new ApiError('BAD_ARGS', `limit must be a whole number from 1 to ${HISTORY_MAX}`);
      limit = Math.min(limit, HISTORY_MAX);
    }
    const since = history.parseSince(args.since);
    if (since === null) throw new ApiError('BAD_ARGS', 'since must look like 30m, 24h, 7d, or be a date such as 2026-10-13');
    if (args.profile != null && typeof args.profile !== 'string') throw new ApiError('BAD_ARGS', 'profile must be a profile name');
    const { total, entries } = history.listSessions(configPath, { profile: args.profile ? args.profile.trim() : undefined, since, limit });
    return {
      success: true,
      total,
      count: entries.length,
      sessions: entries.map((e) => ({
        id: e.id, profile: e.profile, port: e.port, browser: e.browser, mode: e.mode,
        running: !e.stoppedAt, startedBy: e.startedBy, startedAt: e.startedAt, stoppedAt: e.stoppedAt, endedBy: e.endedBy,
        tabs: (e.tabs || []).map((t) => ({ title: t.title, url: t.url })),
      })),
    };
  },
};

const TOOL_NAMES = Object.keys(TOOLS);

const REOPEN_MAX_TABS = 20;

/**
 * Open a past session again: start its profile (the same start_browser path, so every safety rule
 * and the lease apply) and open its http(s) tabs through the profile's own debug port. Not one of the
 * tools: only the desktop app offers it. Tabs already open are skipped, at most REOPEN_MAX_TABS are
 * opened, and a URL that is not http or https is refused.
 * Resolves like call(): { success: true, ..., opened, failed, skipped, hidden } or { success: false, code, error, action }.
 * @param {string} historyId  an entry id from browser_history
 */
async function reopen(configPath, historyId, ctx = {}) {
  try {
    const entry = history.getSession(configPath, String(historyId || ''));
    if (!entry) throw new ApiError('NOT_FOUND', 'that history entry no longer exists');
    const profile = profiles.getProfile(configPath, entry.profile); // NOT_FOUND if the profile was removed
    const full = { surface: 'desktop', ...ctx, deps: ctx.deps || run.defaultDeps() };
    const started = await TOOLS.start_browser(configPath, { name: profile.name, agent: ctx.agent, sessionId: ctx.sessionId }, full);
    const wanted = [];
    for (const t of entry.tabs || []) {
      let u;
      try { u = new URL(t.url); } catch { continue; }
      if (u.protocol === 'http:' || u.protocol === 'https:') wanted.push(u.href);
      if (wanted.length >= REOPEN_MAX_TABS) break;
    }
    const open = new Set((await full.deps.pageTabs(profile.port)).map((t) => history.redactUrl(t.url)).filter(Boolean));
    let opened = 0;
    let failed = 0;
    for (const url of wanted) {
      if (open.has(history.redactUrl(url))) continue;
      if (await full.deps.openTab(profile.port, url)) opened += 1; else failed += 1;
    }
    return {
      ...started, opened, failed, skipped: wanted.length - opened - failed,
      hidden: wanted.filter((u) => u.includes('***')).length,
    };
  } catch (err) {
    return failure(err, configPath);
  }
}


/**
 * Run one tool. Resolves with the result object, always: errors come back as
 * { success: false, code, error, action }.
 * @param {string} configPath  the portpilot-config.json
 * @param {string} tool        one of TOOL_NAMES
 * @param {object} [args]      the tool's arguments (name, mode, agent, sessionId)
 * @param {object} [ctx]       { surface: 'mcp' | 'http' | 'cli', deps?, pollMs? }
 */
async function call(configPath, tool, args, ctx = {}) {
  try {
    if (!Object.prototype.hasOwnProperty.call(TOOLS, tool)) {
      throw new ApiError('UNKNOWN_TOOL', `there is no browser tool named "${tool}"`);
    }
    const full = { surface: 'mcp', ...ctx, deps: ctx.deps || run.defaultDeps() };
    return await TOOLS[tool](configPath, args && typeof args === 'object' ? args : {}, full);
  } catch (err) {
    return failure(err, configPath);
  }
}

module.exports = { TOOL_NAMES, call, reopen, startHistorySampler, claimsPathFor, cdpUrlFor };
