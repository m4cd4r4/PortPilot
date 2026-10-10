/**
 * IPC for the Browsers tab: list, start, stop, mode, save, remove, duplicate, extensions.
 * Kept out of ipcHandlers.js (already 960+ lines).
 *
 * Start, stop and mode go through browserApi, the same code the MCP tools and the HTTP routes use,
 * so a desktop start leaves the same advisory claim ("PortPilot desktop") and obeys the same
 * safety rules: nothing here kills or starts a process on its own. Add, edit, remove and
 * duplicate go to the profile store directly (the API has no tool for them on purpose: a model
 * should not be able to create or delete browser profiles).
 *
 * The renderer is untrusted input: it can only send plain fields, never a folder path.
 */
const fs = require('fs');
const profiles = require('../core/browserProfiles');
const run = require('../core/browserRun');
const api = require('../core/browserApi');
const { duplicateProfile } = require('../core/browserDuplicate');
const { listExtensions } = require('../core/browserExtensions');

const SURFACE = 'desktop';
const AGENT = 'PortPilot desktop';
const LIST_TTL_MS = 1500;
const lower = (s) => String(s).trim().toLowerCase();

// Fields the panel may set. Never userDataDir: that would let a compromised renderer point a
// profile at any folder on disk.
const EDITABLE = ['port', 'browser', 'mode', 'url', 'note'];
const pick = (src, keys) => Object.fromEntries(keys.filter((k) => src && src[k] !== undefined).map((k) => [k, src[k]]));

const isPlainName = (v) => typeof v === 'string' && v.trim().length > 0 && v.length <= 200;

// Codes the panel may show as they are. Anything else (a Node errno such as EPERM, say) becomes INTERNAL.
const KNOWN_CODES = new Set([
  'BAD_ARGS', 'BAD_BROWSER', 'BAD_DIR', 'BAD_MODE', 'BAD_NAME', 'BAD_POOL', 'BAD_PORT', 'BAD_URL', 'BROWSER_NOT_FOUND',
  'BUSY', 'COPY_FAILED', 'DUPLICATE_DIR', 'DUPLICATE_NAME', 'DUPLICATE_PORT', 'LAUNCH_FAILED', 'NOT_FOUND', 'NOT_OURS', 'NOT_VERIFIED',
  'PORT_HELD', 'PROFILE_RUNNING', 'SOURCE_RUNNING', 'START_TIMEOUT', 'STOP_FAILED',
]);
const GENERIC = 'Something went wrong. The details are in the PortPilot log.';
// A drive path (C:\x or C:/x), a UNC path, or a posix path that does not start inside a word.
const PATH_RE = /(?:[A-Za-z]:[\\/]|\\\\)[^\s'"`<>|]*|(?<![\w:./-])\/(?:[\w.~@+-]+\/)*[\w.~@+-]+/g;
const scrub = (text) => String(text).replace(PATH_RE, '[path]').replace(/\s+/g, ' ').trim();

/**
 * What the panel gets from a failed call. The API words its errors for a model, and a raw message can
 * carry absolute paths (the launch error names the browser's exe, a Node error the file), so codes
 * outside KNOWN_CODES collapse to INTERNAL and every message is path-scrubbed.
 */
function clean(r) {
  if (!r || r.success !== false) return r;
  if (!KNOWN_CODES.has(r.code)) {
    console.error('[browserIpc]', r.code, r.error);
    return { success: false, code: 'INTERNAL', error: GENERIC };
  }
  const out = { ...r, error: r.code === 'LAUNCH_FAILED' ? 'The browser could not be launched. Check that it starts normally on its own.' : scrub(r.error) };
  delete out.action;
  delete out.known;
  return out;
}

/** An error for the panel: our own errors say what is wrong; a raw Node error carries paths, so it does not. */
function failure(err) {
  const ours = err && (err.name === 'ProfileError' || err.name === 'RunError');
  if (!ours) {
    console.error('[browserIpc]', err);
    return { success: false, code: 'INTERNAL', error: GENERIC };
  }
  return clean({ success: false, code: err.code, error: err.message, ...(err.holder ? { holder: err.holder } : {}) });
}

function setupBrowserIpc(ipcMain, configStore, injected = {}) {
  const configPath = () => configStore.configPath;
  const ctx = () => ({ surface: SURFACE, ...(injected.runDeps ? { deps: injected.runDeps } : {}), ...(injected.pollMs ? { pollMs: injected.pollMs } : {}) });
  const runDeps = () => injected.runDeps || run.defaultDeps();
  const ttl = injected.listTtlMs ?? LIST_TTL_MS;
  const busy = new Set();
  let cache = null; // { gen, doneAt, promise }
  let gen = 0;

  /** After any action the next list starts a fresh sweep, even if one is still in flight. */
  const invalidate = () => { gen += 1; cache = null; };

  /** A browserApi call with its failure cleaned for the renderer. */
  const call = async (tool, args) => clean(await api.call(configPath(), tool, args, ctx()));

  /** Hold the profile names for the length of one action: a double click must not start twice. */
  async function exclusive(names, fn) {
    const keys = names.map(lower);
    if (keys.some((k) => busy.has(k))) {
      return { success: false, code: 'BUSY', error: 'Already working on this profile.' };
    }
    keys.forEach((k) => busy.add(k));
    try { return await fn(); } finally { keys.forEach((k) => busy.delete(k)); invalidate(); }
  }

  const guarded = (fn) => async (event, ...args) => {
    try { return await fn(...args); } catch (err) { return failure(err); }
  };

  /**
   * One status sweep at a time: callers during a sweep share it, and its answer is reused for ttl ms
   * counted from when it FINISHED (a slow sweep must not look stale the moment it lands). A mutation
   * bumps `gen`, so a sweep that began before it is never handed to a later caller.
   */
  function listOnce() {
    if (cache && cache.gen === gen && (cache.doneAt === null || Date.now() - cache.doneAt < ttl)) return cache.promise;
    const entry = { gen, doneAt: null, promise: null };
    entry.promise = (async () => {
      try {
        const [list, browsers] = await Promise.all([call('list_browser_profiles', {}), call('list_browsers', {})]);
        if (!list.success) return list;
        return { success: true, profiles: list.profiles, warnings: list.warnings, browsers: browsers.success ? browsers.browsers : [] };
      } finally {
        entry.doneAt = Date.now();
      }
    })();
    cache = entry;
    entry.promise.then((r) => { if (!r.success && cache === entry) cache = null; }, () => { if (cache === entry) cache = null; });
    return entry.promise;
  }

  ipcMain.handle('browser:list', guarded(() => listOnce()));

  ipcMain.handle('browser:start', guarded((name) => {
    if (!isPlainName(name)) return { success: false, code: 'BAD_ARGS', error: 'name is required.' };
    return exclusive([name], () => call('start_browser', { name, agent: AGENT }));
  }));

  ipcMain.handle('browser:stop', guarded((name) => {
    if (!isPlainName(name)) return { success: false, code: 'BAD_ARGS', error: 'name is required.' };
    return exclusive([name], () => call('stop_browser', { name, agent: AGENT }));
  }));

  ipcMain.handle('browser:setMode', guarded((name, mode) => {
    if (!isPlainName(name) || typeof mode !== 'string') return { success: false, code: 'BAD_ARGS', error: 'name and mode are required.' };
    return exclusive([name], () => call('set_browser_mode', { name, mode, agent: AGENT }));
  }));

  /** Add (original null) or edit (original = the profile's current name; the name itself never changes). */
  ipcMain.handle('browser:save', guarded((original, fields) => {
    if (original != null && !isPlainName(original)) return { success: false, code: 'BAD_ARGS', error: 'original must be a profile name.' };
    const f = fields && typeof fields === 'object' ? fields : {};
    const names = original ? [original] : [typeof f.name === 'string' ? f.name : ''];
    return exclusive(names, async () => {
      if (!original) {
        // A folder left by a removed profile of this name is adopted, sign-ins and all: say so.
        const reusedFolder = fs.existsSync(profiles.userDataDirFor(configPath(), { name: f.name }));
        const profile = profiles.addProfile(configPath(), { ...pick(f, EDITABLE), name: f.name });
        return { success: true, profile, reusedFolder };
      }
      const current = profiles.getProfile(configPath(), original);
      const changes = pick(f, EDITABLE);
      const movesIt = ('port' in changes && Number(changes.port) !== current.port)
        || ('browser' in changes && String(changes.browser).toLowerCase() !== current.browser);
      if (movesIt) {
        const st = await run.profileStatus(configPath(), current, runDeps());
        // Only our own running browser blocks the edit: a foreign process on the port ('blocked') is
        // exactly when the user needs to move the profile to another port.
        if (st.state === 'up') {
          return { success: false, code: 'PROFILE_RUNNING', error: `"${current.name}" is running. Stop it before changing its port or browser, or PortPilot would lose track of it.` };
        }
      }
      return { success: true, profile: profiles.updateProfile(configPath(), original, changes) };
    });
  }));

  /** Removes the profile from PortPilot. Its folder, and the sign-ins in it, stay on disk. */
  ipcMain.handle('browser:remove', guarded((name) => {
    if (!isPlainName(name)) return { success: false, code: 'BAD_ARGS', error: 'name is required.' };
    return exclusive([name], async () => {
      const p = profiles.getProfile(configPath(), name);
      const st = await run.profileStatus(configPath(), p, runDeps());
      if (st.state === 'up') {
        return { success: false, code: 'PROFILE_RUNNING', error: `"${p.name}" is running. Stop it before removing it.` };
      }
      const r = profiles.removeProfile(configPath(), name, { purge: false });
      return { success: true, removed: r.removed, folderKept: true };
    });
  }));

  ipcMain.handle('browser:duplicate', guarded((from, fields) => {
    const f = fields && typeof fields === 'object' ? fields : {};
    if (!isPlainName(from) || typeof f.name !== 'string') return { success: false, code: 'BAD_ARGS', error: 'from and name are required.' };
    return exclusive([from, f.name], async () => {
      const r = await duplicateProfile(configPath(), from, { name: f.name, port: f.port, note: f.note }, runDeps());
      return { success: true, profile: r.profile, copied: r.copied, leftOut: r.leftOut };
    });
  }));

  ipcMain.handle('browser:extensions', guarded((name) => {
    if (!isPlainName(name)) return { success: false, code: 'BAD_ARGS', error: 'name is required.' };
    const p = profiles.getProfile(configPath(), name);
    return { success: true, extensions: listExtensions(profiles.userDataDirFor(configPath(), p)) };
  }));
}

module.exports = { setupBrowserIpc };
