/**
 * The browser-profile tools (plan row 26, slice 2): one set of five tools that the MCP server and
 * the web agent both expose, so a model asks for a profile by NAME and PortPilot supplies the port
 * and the CDP URL. A caller never chooses a port.
 *
 *   list_browser_profiles  list_browsers  start_browser  stop_browser  set_browser_mode
 *
 * Every call resolves, never rejects. Success is `{ success: true, ... }`; failure is
 * `{ success: false, code, error, action }`: `error` is one plain sentence (it names the process
 * holding a blocked port) and `action` is the one thing the caller should do next. The slice 1
 * safety rules stay in browserRun.js: nothing here kills or starts anything on its own.
 *
 * Claim marker (advisory): who started or holds a profile lives in portpilot-browser-claims.json
 * beside the config, never in the config itself. It is shown in status and never blocks a start
 * or stop. A claim is shown only while the browser it was made for is still the one running
 * (same pid), so a crash or an outside restart cannot leave a stale name behind.
 *
 * Side effects go through ctx.deps (browserRun's `deps`), so tests use the slice 1 fake spawner.
 * Zero dependencies.
 */
const path = require('path');
const configFile = require('./configFile');
const profiles = require('./browserProfiles');
const run = require('./browserRun');

const CLAIMS_FILE = 'portpilot-browser-claims.json';
const emptyClaims = () => ({ profiles: {} });
const lower = (s) => String(s).toLowerCase();

class ApiError extends Error {
  constructor(code, message) { super(message); this.name = 'ApiError'; this.code = code; }
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

function ago(iso) {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (!Number.isFinite(s)) return 'earlier';
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

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
  UNKNOWN_TOOL: 'Use one of: list_browser_profiles, list_browsers, start_browser, stop_browser, set_browser_mode.',
};

function failure(err, configPath) {
  const code = typeof err.code === 'string' && /^[A-Z_]+$/.test(err.code) ? err.code : 'INTERNAL';
  const out = {
    success: false,
    code,
    error: String(err.message || err).replace(/\s+/g, ' ').trim(),
    action: NEXT[code] || 'Report this error to the user.',
  };
  if (err.holder) out.holder = err.holder;
  if (code === 'NOT_FOUND') {
    try { out.known = profiles.listProfiles(configPath).map((p) => p.name); } catch { /* the list is a courtesy */ }
  }
  return out;
}

const nameOf = (args) => {
  if (typeof args.name !== 'string' || !args.name.trim()) {
    throw new ApiError('BAD_ARGS', 'name is required: the profile name, as returned by list_browser_profiles');
  }
  return args.name.trim();
};

const runOpts = (ctx) => (ctx.pollMs ? { pollMs: ctx.pollMs } : {});

// ---- Tools -------------------------------------------------------------------

const TOOLS = {
  async list_browser_profiles(configPath, args, ctx) {
    const stored = profiles.listProfiles(configPath);
    const { rows, warnings } = await run.allStatus(configPath, stored, ctx.deps);
    const out = rows.map((st) => {
      const row = view(st, liveClaim(configPath, st));
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
    const name = nameOf(args);
    profiles.getProfile(configPath, name); // NOT_FOUND before anything runs
    const caller = callerOf(args, ctx);
    const r = await run.startProfile(configPath, name, runOpts(ctx), ctx.deps);

    let claim = r.already ? liveClaim(configPath, r) : null;
    if (!claim) {
      claim = { ...caller, pid: r.pid ?? null };
      writeClaim(configPath, r.name, claim);
    }
    const out = { ...view(r, claim), already: !!r.already };
    if (r.offscreen) out.offscreen = r.offscreen;
    if (claim.by !== caller.by) {
      out.claimNote = `Claimed by "${claim.by}" (${ago(claim.at)}). Not blocked: you may use it, but leave tabs you did not open alone.`;
    }
    return { success: true, ...out };
  },

  async stop_browser(configPath, args, ctx) {
    const name = nameOf(args);
    const profile = profiles.getProfile(configPath, name);
    const caller = callerOf(args, ctx);
    const st0 = await run.profileStatus(configPath, profile, ctx.deps);
    const before = liveClaim(configPath, st0);
    const r = await run.stopProfile(configPath, name, runOpts(ctx), ctx.deps);
    // Drop the claim only if it still belongs to the browser just stopped: a caller who started a
    // new one in the meantime keeps theirs.
    const stored = readClaims(configPath)[lower(profile.name)];
    if (stored && (st0.state === 'down' || stored.pid == null || stored.pid === st0.pid)) writeClaim(configPath, profile.name, null);
    const out = { ...view(r, null), already: !!r.already };
    if (before && before.by !== caller.by) {
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
};

const TOOL_NAMES = Object.keys(TOOLS);

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

module.exports = { TOOL_NAMES, call, claimsPathFor, cdpUrlFor };
