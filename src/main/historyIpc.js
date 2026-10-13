/**
 * IPC for the History view: list, thumbnails, pin, Re-run.
 * Kept out of ipcHandlers.js (already 960+ lines).
 */
const fs = require('fs');
const path = require('path');

const runHistory = require('../core/runHistory');
const runSweep = require('../core/runSweep');
const { rowThumbs } = require('../core/runView');
const { readRuntime, recordStart } = require('../core/configFile');
const { makeStartedBy } = require('../core/status');
const { appForRun } = require('../core/runApp');
const { probe } = require('./healthCheck');
const reserver = require('./portReserver');
const { startApp } = require('./processManager');

const RUN_ID_RE = /^r_[A-Za-z0-9_]+$/;
const THUMBS_PER_CALL = 60;
const START_POLLS = 40;      // wait up to 40 x 750 ms = 30 s for the restarted server to answer
const START_POLL_MS = 750;
const PIN_MESSAGES = {
  'not-found': 'That run is no longer in the history.',
  'pin-limit': `Pin limit reached (${runHistory.MAX_PINS}). Unpin a run first.`,
};

/**
 * Open runs answering on the run's port: a registered app that is running, or a detected
 * server (which has no app and no runtime record, only its open run and its port).
 */
async function liveRunIds(configPath, runs) {
  const runtime = readRuntime(configPath).apps || {};
  const open = runs.filter((r) => !r.stoppedAt && r.port && (r.detected || runtime[r.appId]));
  const answers = await Promise.all(open.map((r) => probe(r.port, '/', 1000)));
  return open.filter((_, i) => answers[i] !== 'down').map((r) => r.id);
}

/** Closed runs that can be started again: a recorded start command and a project folder that still exists. */
function startableRunIds(runs) {
  const dirs = new Map();
  const isDir = (p) => {
    if (!dirs.has(p)) { try { dirs.set(p, fs.statSync(p).isDirectory()); } catch { dirs.set(p, false); } }
    return dirs.get(p);
  };
  return runs.filter((r) => r.stoppedAt && r.cwd && r.startCommand && isDir(r.cwd)).map((r) => r.id);
}

function thumbDataUrl(configPath, run) {
  if (!run || !run.page || !run.page.thumb) return null;
  const dir = path.resolve(runHistory.historyDirFor(configPath));
  const file = path.resolve(dir, run.page.thumb);
  if (!file.startsWith(dir + path.sep)) return null;
  try { return `data:image/jpeg;base64,${fs.readFileSync(file).toString('base64')}`; } catch { return null; }
}

function setupHistoryIpc(ipcMain, configStore) {
  const configPath = () => configStore.configPath;
  const rerunning = new Set();
  const restarting = new Set();

  ipcMain.handle('history:list', async () => {
    try {
      const runs = runHistory.readRuns(configPath());
      return {
        success: true,
        runs,
        live: await liveRunIds(configPath(), runs),
        startable: startableRunIds(runs),
        stats: runSweep.historyStats(configPath()),
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Apps rows: which open run's thumbnail each app shows. An open run alone does
  // not prove its server is the one running now (a stop outside PortPilot leaves
  // it open), so the app must also have a runtime record, as in liveRunIds; the
  // renderer then matches the live port. No probes, so it is cheap enough for the
  // 3-second refresh; pixels still come from history:thumbs.
  ipcMain.handle('history:rowThumbs', async () => {
    try {
      const runtime = readRuntime(configPath()).apps || {};
      const byApp = rowThumbs(runHistory.readRuns(configPath()));
      for (const appId of Object.keys(byApp)) if (!runtime[appId]) delete byApp[appId];
      return { success: true, byApp };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('history:thumbs', async (_, ids) => {
    try {
      const want = (Array.isArray(ids) ? ids : []).filter((id) => RUN_ID_RE.test(id)).slice(0, THUMBS_PER_CALL);
      const byId = new Map(runHistory.readRuns(configPath()).map((r) => [r.id, r]));
      const thumbs = {};
      for (const id of want) {
        const url = thumbDataUrl(configPath(), byId.get(id));
        if (url) thumbs[id] = url;
      }
      return { success: true, thumbs };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('history:pin', async (_, runId, pinned) => {
    try {
      if (!RUN_ID_RE.test(runId)) return { success: false, error: PIN_MESSAGES['not-found'] };
      const res = runHistory.pinRun(configPath(), runId, !!pinned);
      return res.ok ? { success: true } : { success: false, error: PIN_MESSAGES[res.reason] || 'Could not pin.' };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // "Start again" on a closed run: register (or reuse) an app for its folder, start it the
  // way the Apps tab does, and answer once the port does. The renderer then opens the URL.
  ipcMain.handle('history:startAgain', async (_, runId) => {
    if (!RUN_ID_RE.test(runId)) return { success: false, error: PIN_MESSAGES['not-found'] };
    if (restarting.has(runId)) return { success: false, error: 'This run is already being started.' };
    restarting.add(runId);
    try {
      const run = runHistory.readRuns(configPath()).find((r) => r.id === runId);
      if (!run) return { success: false, error: PIN_MESSAGES['not-found'] };
      const reg = appForRun(configPath(), run);
      if (!reg.ok) return { success: false, error: reg.error };
      configStore.config = configStore.load(); // see the new app at once, not after the file watcher's debounce
      const app = configStore.getApp(reg.appId);
      if (!app) return { success: false, error: 'The app could not be registered.' };
      const port = Number(app.preferredPort) || Number(reg.port) || null;
      if (port && await probe(port, '/', 1000) !== 'down') {
        return { success: false, error: `Something is already answering on :${port}.` };
      }
      await reserver.release(app.id);
      const started = await startApp(app);
      if (!started || !started.success) return { success: false, error: (started && started.error) || 'The app did not start.' };
      recordStart(configPath(), app.id, makeStartedBy({ kind: 'human', surface: 'desktop' }), { pid: started.pid, port });
      let up = false;
      for (let i = 0; port && i < START_POLLS && !up; i++) {
        await new Promise((r) => setTimeout(r, START_POLL_MS));
        up = await probe(port, '/', 1000) !== 'down';
      }
      return { success: true, appId: app.id, port, url: port ? `http://localhost:${port}/` : null, up };
    } catch (err) {
      return { success: false, error: err.message };
    } finally {
      restarting.delete(runId);
    }
  });

  ipcMain.handle('history:rerun', async (event, runId) => {
    if (!RUN_ID_RE.test(runId)) return { success: false, code: 'not-found', error: PIN_MESSAGES['not-found'] };
    if (rerunning.has(runId)) return { success: false, code: 'busy', error: 'This run is already being re-run.' };
    const run = runHistory.readRuns(configPath()).find((r) => r.id === runId);
    if (!run) return { success: false, code: 'not-found', error: PIN_MESSAGES['not-found'] };
    rerunning.add(runId);
    try {
      const { rerunVersion } = require('./rerun');
      return await rerunVersion(run, {
        configStore,
        configPath: configPath(),
        onProgress: (p) => { try { event.sender.send('history-progress', p); } catch { /* window closed */ } },
      });
    } finally {
      rerunning.delete(runId);
    }
  });
}

module.exports = { setupHistoryIpc, liveRunIds, startableRunIds, thumbDataUrl };
