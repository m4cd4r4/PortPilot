/**
 * IPC for the History view: list, thumbnails, pin, Re-run.
 * Kept out of ipcHandlers.js (already 960+ lines).
 */
const fs = require('fs');
const path = require('path');

const runHistory = require('../core/runHistory');
const runSweep = require('../core/runSweep');
const { readRuntime } = require('../core/configFile');
const { probe } = require('./healthCheck');

const RUN_ID_RE = /^r_[A-Za-z0-9_]+$/;
const THUMBS_PER_CALL = 60;
const PIN_MESSAGES = {
  'not-found': 'That run is no longer in the history.',
  'pin-limit': `Pin limit reached (${runHistory.MAX_PINS}). Unpin a run first.`,
};

/** Open runs whose app is registered as running AND answering on the run's port. */
async function liveRunIds(configPath, runs) {
  const runtime = readRuntime(configPath).apps || {};
  const open = runs.filter((r) => !r.stoppedAt && r.port && runtime[r.appId]);
  const answers = await Promise.all(open.map((r) => probe(r.port, '/', 1000)));
  return open.filter((_, i) => answers[i] !== 'down').map((r) => r.id);
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

  ipcMain.handle('history:list', async () => {
    try {
      const runs = runHistory.readRuns(configPath());
      return {
        success: true,
        runs,
        live: await liveRunIds(configPath(), runs),
        stats: runSweep.historyStats(configPath()),
      };
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

module.exports = { setupHistoryIpc, liveRunIds, thumbDataUrl };
