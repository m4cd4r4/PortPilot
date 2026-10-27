/**
 * IPC for the redesign's Browsers screen: brand art, sign-in health and lease release.
 * Kept out of browserIpc.js, which owns list / start / stop / save / remove.
 *
 *   browser:art:index    name -> { source, at } for every profile that has a picture (cheap)
 *   browser:art:get      names -> data URLs
 *   browser:art:refresh  fetch the site's own picture once (a miss is remembered for a day)
 *   browser:art:choose   the user picks an image file; it is copied into the config folder
 *   browser:art:clear    forget the picture
 *   browser:health       names -> 'in' | 'out' | 'unknown' from the running browser's cookies
 *   browser:signInSetup  name, 'sync' | 'passwords' -> open Brave's own Sync / import page in that profile
 *   browser:release      end the lease on a profile; the browser keeps running
 *
 * The renderer sends a profile NAME only, never a path or URL: every file lives at
 * <configDir>/browser-art/<name>.<ext> and the name must belong to a stored profile.
 */
const fs = require('fs');
const path = require('path');
const profiles = require('../core/browserProfiles');
const run = require('../core/browserRun');
const cdp = require('../core/browserCdp');
const configFile = require('../core/configFile');
const art = require('../core/browserArt');
const health = require('../core/browserHealth');
const { claimsPathFor } = require('../core/browserApi');

const MISS_MS = 24 * 60 * 60 * 1000;
const HEALTH_TTL_MS = 60 * 1000;
const FETCH_MS = 8000;
const MAX_REDIRECTS = 3;
const NAMES_PER_CALL = 60;
const EXTS = ['png', 'jpg', 'webp', 'gif', 'ico'];
const MIME = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', ico: 'image/x-icon' };

const lower = (s) => String(s).trim().toLowerCase();
const isPlainName = (v) => typeof v === 'string' && v.trim().length > 0 && v.length <= 200;
const GENERIC = 'Something went wrong. The details are in the PortPilot log.';
const fail = (code, error) => ({ success: false, code, error });

/**
 * GET a public http(s) URL with a size cap and a timeout. Redirects are followed by hand so every
 * hop is checked again (a public page must not bounce us to localhost). Null on any failure.
 */
async function fetchLimited(url, maxBytes, fetchImpl = fetch) {
  let current = art.publicHttpUrl(url);
  for (let hop = 0; current && hop <= MAX_REDIRECTS; hop++) {
    let res;
    try {
      res = await fetchImpl(current.href, { redirect: 'manual', signal: AbortSignal.timeout(FETCH_MS), headers: { 'user-agent': 'PortPilot' } });
    } catch { return null; }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      let next = null;
      try { next = loc ? art.publicHttpUrl(new URL(loc, current)) : null; } catch { /* bad location */ }
      current = next;
      continue;
    }
    if (!res.ok || !res.body) return null;
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) return null;
    const chunks = [];
    let size = 0;
    try {
      for await (const chunk of res.body) {
        size += chunk.length;
        if (size > maxBytes) return null;
        chunks.push(Buffer.from(chunk));
      }
    } catch { return null; }
    return Buffer.concat(chunks);
  }
  return null;
}

function setupBrowserExtraIpc(ipcMain, configStore, injected = {}) {
  const configPath = () => configStore.configPath;
  const artDir = () => path.join(path.dirname(configPath()), 'browser-art');
  const fetchImpl = injected.fetch || fetch;
  const runDeps = () => injected.runDeps || run.defaultDeps();
  const cookiesOf = injected.cookies || ((port) => cdp.withBrowserSession(port, (send) => send('Storage.getCookies')).then((r) => (r && r.cookies) || null));
  const openSetup = injected.openSetup || cdp.openSetupPage;
  const pickFile = injected.pickFile || (async () => {
    const { dialog, BrowserWindow } = require('electron');
    const r = await dialog.showOpenDialog(BrowserWindow.getFocusedWindow(), {
      title: 'Choose a picture for this profile',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'ico'] }],
    });
    return r.canceled || !r.filePaths.length ? null : r.filePaths[0];
  });
  const healthCache = new Map(); // lower name -> { at, state }

  const guarded = (fn) => async (event, ...args) => {
    try { return await fn(...args); } catch (err) {
      if (err && err.name === 'ProfileError') return fail(err.code, err.message);
      console.error('[browserExtraIpc]', err);
      return fail('INTERNAL', GENERIC);
    }
  };

  const stored = (name) => profiles.getProfile(configPath(), name); // throws NOT_FOUND for a stranger

  const base = (name) => path.join(artDir(), lower(stored(name).name));
  const metaPath = (name) => `${base(name)}.json`;
  const readMeta = (name) => {
    try { return JSON.parse(fs.readFileSync(metaPath(name), 'utf8')); } catch { return null; }
  };
  const imageFile = (name) => {
    const meta = readMeta(name);
    if (!meta || !EXTS.includes(meta.ext)) return null;
    const file = `${base(name)}.${meta.ext}`;
    return fs.existsSync(file) ? { file, meta } : null;
  };
  /** Drop every picture file of a profile (all extensions) and its meta. */
  function wipe(name) {
    for (const ext of [...EXTS, 'json']) {
      try { fs.unlinkSync(`${base(name)}.${ext}`); } catch { /* not there */ }
    }
  }
  function store(name, buf, type, meta) {
    fs.mkdirSync(artDir(), { recursive: true });
    wipe(name);
    fs.writeFileSync(`${base(name)}.${type.ext}`, buf);
    fs.writeFileSync(metaPath(name), JSON.stringify({ ...meta, ext: type.ext, at: Date.now() }));
  }

  ipcMain.handle('browser:art:index', guarded(() => {
    const byName = {};
    for (const p of profiles.listProfiles(configPath())) {
      if (!p || typeof p.name !== 'string') continue;
      try {
        const have = imageFile(p.name);
        if (have) byName[p.name] = { source: have.meta.source || 'auto', at: have.meta.at || 0 };
      } catch { /* an unsafe stored name is skipped */ }
    }
    return { success: true, byName };
  }));

  ipcMain.handle('browser:art:get', guarded((names) => {
    const arts = {};
    for (const name of (Array.isArray(names) ? names : []).slice(0, NAMES_PER_CALL)) {
      if (!isPlainName(name)) continue;
      try {
        const have = imageFile(name);
        if (have) arts[name] = `data:${MIME[have.meta.ext]};base64,${fs.readFileSync(have.file).toString('base64')}`;
      } catch { /* unknown profile */ }
    }
    return { success: true, arts };
  }));

  ipcMain.handle('browser:art:refresh', guarded(async (name, force) => {
    if (!isPlainName(name)) return fail('BAD_ARGS', 'name is required.');
    const p = stored(name);
    const meta = readMeta(name);
    if (meta && meta.source === 'manual') return { success: true, found: true, kept: 'manual' };
    if (!force && meta && meta.miss && Date.now() - meta.at < MISS_MS) return { success: true, found: false };
    const page = art.pageUrlFor(p);
    if (!page) return { success: true, found: false, reason: 'no-public-site' };
    const html = await fetchLimited(page, art.PAGE_MAX_BYTES, fetchImpl);
    const candidates = html ? art.artCandidates(html.toString('utf8'), page) : art.artCandidates('', page);
    for (const c of candidates.slice(0, 6)) {
      const buf = await fetchLimited(c.url, art.IMAGE_MAX_BYTES, fetchImpl);
      const type = buf && art.sniffImage(buf);
      if (type) {
        store(name, buf, type, { source: 'auto', kind: c.kind });
        return { success: true, found: true, kind: c.kind };
      }
    }
    fs.mkdirSync(artDir(), { recursive: true });
    if (!meta || !imageFile(name)) fs.writeFileSync(metaPath(name), JSON.stringify({ source: 'auto', miss: true, at: Date.now() }));
    return { success: true, found: false };
  }));

  ipcMain.handle('browser:art:choose', guarded(async (name) => {
    if (!isPlainName(name)) return fail('BAD_ARGS', 'name is required.');
    stored(name);
    const picked = await pickFile();
    if (!picked) return { success: true, cancelled: true };
    const stat = fs.statSync(picked);
    if (!stat.isFile() || stat.size > art.IMAGE_MAX_BYTES) return fail('BAD_IMAGE', 'Pick an image under 2 MB.');
    const buf = fs.readFileSync(picked);
    const type = art.sniffImage(buf);
    if (!type) return fail('BAD_IMAGE', 'That file is not a PNG, JPEG, WebP, GIF or ICO picture.');
    store(name, buf, type, { source: 'manual' });
    return { success: true };
  }));

  ipcMain.handle('browser:art:clear', guarded((name) => {
    if (!isPlainName(name)) return fail('BAD_ARGS', 'name is required.');
    wipe(name);
    return { success: true };
  }));

  ipcMain.handle('browser:health', guarded(async (names) => {
    const out = {};
    for (const name of (Array.isArray(names) ? names : []).slice(0, NAMES_PER_CALL)) {
      if (!isPlainName(name)) continue;
      let p;
      try { p = stored(name); } catch { continue; }
      const key = lower(p.name);
      const hit = healthCache.get(key);
      if (hit && Date.now() - hit.at < HEALTH_TTL_MS) { out[p.name] = hit.state; continue; }
      let state = 'unknown';
      try {
        const st = await run.profileStatus(configPath(), p, runDeps());
        if (st.state === 'up') {
          const cookies = await cookiesOf(p.port);
          state = cookies ? health.signInState(cookies, health.hostsFor(p)) : 'unknown';
        }
      } catch (err) {
        console.error('[browserExtraIpc] health', err.message);
      }
      // A stopped browser is not cached: starting it should show its state at once.
      if (state !== 'unknown') healthCache.set(key, { at: Date.now(), state }); else healthCache.delete(key);
      out[p.name] = state;
    }
    return { success: true, health: out };
  }));

  /**
   * Open Brave's Sync or password-import page inside a running profile, so the person can sign in
   * there themselves. Never reads another browser's saved logins.
   */
  ipcMain.handle('browser:signInSetup', guarded(async (name, which) => {
    if (!isPlainName(name) || !Object.prototype.hasOwnProperty.call(cdp.SETUP_PAGES, which)) return fail('BAD_ARGS', 'name and a known page are required.');
    const p = stored(name);
    if (p.browser && p.browser !== 'brave') return fail('UNSUPPORTED', 'Sign-in setup works for Brave profiles only.');
    const st = await run.profileStatus(configPath(), p, runDeps());
    if (st.state !== 'up') return fail('NOT_RUNNING', 'Start the profile first.');
    const opened = await openSetup(p.port, which);
    return opened ? { success: true } : fail('OPEN_FAILED', 'The browser did not open the page.');
  }));

  /** Ends the lease only: the claim stays as a record of who started the browser, minus its session. */
  ipcMain.handle('browser:release', guarded((name) => {
    if (!isPlainName(name)) return fail('BAD_ARGS', 'name is required.');
    const p = stored(name);
    let released = false;
    configFile.updateJson(claimsPathFor(configPath()), (file) => {
      const c = file.profiles && file.profiles[lower(p.name)];
      if (c && c.sessionId) { c.sessionId = null; released = true; }
    }, () => ({ profiles: {} }));
    return { success: true, released };
  }));
}

module.exports = { setupBrowserExtraIpc, fetchLimited };
