/**
 * Offscreen thumbnails for the History view.
 *
 * Watches history/runs.json. For each open run with no page.thumb it polls the
 * run's port (healthCheck.probe) for up to 60 s and, on the first healthy
 * response, renders the page in a hidden offscreen window, stores a 480 px wide
 * JPEG under history/thumbs/ and patches page.thumb and page.title on the run.
 *
 * Captures are serial, never leave a window open, and never navigate off
 * localhost / 127.0.0.1.
 */
const fs = require('fs');
const path = require('path');
const { probe } = require('./healthCheck');
const runHistory = require('../core/runHistory');

const POLL_MS = 2000;
const WINDOW_MS = 60000;
const HARD_TIMEOUT_MS = 15000;
const SETTLE_MS = 1500;
const THUMB_WIDTH = 480;
const RUN_ID_RE = /^r_[A-Za-z0-9_]+$/;

/** True for http(s) URLs on localhost, 127.0.0.1 or ::1 only. */
function isLoopbackUrl(url) {
  try {
    const u = new URL(url);
    return (u.protocol === 'http:' || u.protocol === 'https:')
      && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  } catch { return false; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Render http://127.0.0.1:<port>/ and resolve { jpeg, title }. Always destroys the window. */
function capturePage(port) {
  const { BrowserWindow } = require('electron');
  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 800,
      webPreferences: {
        offscreen: true,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        partition: 'portpilot-thumbs',
        backgroundThrottling: false,
      },
    });
    const wc = win.webContents;
    let settled = false;
    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { if (!win.isDestroyed()) win.destroy(); } catch { /* already closed */ }
      if (err) reject(err); else resolve(value);
    };
    const timer = setTimeout(() => finish(new Error('capture timed out')), HARD_TIMEOUT_MS);

    wc.setAudioMuted(true);
    wc.session.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    wc.session.on('will-download', (event) => event.preventDefault());
    const guard = (event, url) => { if (!isLoopbackUrl(url)) event.preventDefault(); };
    wc.on('will-navigate', guard);
    wc.on('will-redirect', guard);
    wc.on('did-fail-load', (_e, code, desc, _url, isMainFrame) => {
      if (isMainFrame && code !== -3) finish(new Error(`load failed: ${desc}`));
    });
    wc.once('did-finish-load', async () => {
      try {
        await sleep(SETTLE_MS);
        if (settled) return;
        const title = await wc.executeJavaScript('document.title');
        const image = await wc.capturePage();
        if (image.isEmpty()) return finish(new Error('empty capture'));
        finish(null, { jpeg: image.resize({ width: THUMB_WIDTH }).toJPEG(70), title });
      } catch (err) { finish(err); }
    });
    const target = `http://127.0.0.1:${port}/`;
    // The port comes from runs.json; "3000@evil.com" would parse as host evil.com.
    if (!Number.isInteger(Number(port)) || Number(port) < 1 || Number(port) > 65535 || !isLoopbackUrl(target)) {
      finish(new Error('refusing a non-loopback capture target'));
      return;
    }
    win.loadURL(target).catch((err) => finish(err));
  });
}

/**
 * Start watching. Returns stop(). `capture` is injectable for tests.
 */
function startThumbnailWatcher(configPath, { capture = capturePage, check = probe } = {}) {
  const runsFile = runHistory.runsPathFor(configPath);
  const dir = runHistory.historyDirFor(configPath);
  const waiting = new Map(); // runId -> first seen (ms)
  const done = new Set();    // captured, failed or timed out: never retry
  let lastMtime = 0;
  let busy = false;
  let stopped = false;

  function refresh() {
    let mtime = 0;
    try { mtime = fs.statSync(runsFile).mtimeMs; } catch { return; }
    if (mtime === lastMtime) return;
    lastMtime = mtime;
    const open = new Set();
    for (const run of runHistory.readRuns(configPath)) {
      if (run.stoppedAt || !run.port || !RUN_ID_RE.test(run.id)) continue;
      if (run.page && run.page.thumb) continue;
      open.add(run.id);
      if (!waiting.has(run.id) && !done.has(run.id)) waiting.set(run.id, Date.now());
    }
    for (const id of [...waiting.keys()]) if (!open.has(id)) waiting.delete(id);
  }

  async function attempt(id) {
    const run = runHistory.readRuns(configPath).find((r) => r.id === id);
    if (!run || run.stoppedAt) { waiting.delete(id); return; }
    if (Date.now() - waiting.get(id) > WINDOW_MS) { waiting.delete(id); done.add(id); return; }
    if (await check(run.port) !== 'healthy') return;
    waiting.delete(id);
    done.add(id);
    try {
      const { jpeg, title } = await capture(run.port);
      const rel = `thumbs/${id}.jpg`;
      fs.mkdirSync(path.join(dir, 'thumbs'), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), jpeg);
      runHistory.setThumb(configPath, id, rel, title);
      // The run was pruned while the capture ran: do not strand the file.
      const kept = runHistory.readRuns(configPath).find((r) => r.id === id);
      if (!kept || !kept.page || kept.page.thumb !== rel) {
        try { fs.unlinkSync(path.join(dir, rel)); } catch { /* already gone */ }
      }
    } catch (err) {
      console.error(`[thumbnails] ${id}: ${err.message}`);
    }
  }

  async function tick() {
    if (busy || stopped) return;
    busy = true;
    try {
      refresh();
      for (const id of [...waiting.keys()]) {
        if (stopped) break;
        await attempt(id);
      }
    } catch (err) {
      console.error('[thumbnails] tick failed:', err.message);
    } finally { busy = false; }
  }

  const timer = setInterval(tick, POLL_MS);
  if (timer.unref) timer.unref();
  tick();
  return () => { stopped = true; clearInterval(timer); };
}

module.exports = { startThumbnailWatcher, isLoopbackUrl, capturePage };
