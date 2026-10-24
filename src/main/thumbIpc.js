/**
 * IPC for the redesign's Localhost gallery: a cheap thumbnail index (stored page screenshots
 * from run history, newest live captures on top), the pixels by key, and a throttled live capture.
 */
const runHistory = require('../core/runHistory');
const { appThumbs } = require('../core/runView');
const { thumbDataUrl } = require('./historyIpc');
const { probe } = require('./healthCheck');
const { capturePage } = require('./thumbnails');
const { createLiveThumbs } = require('./liveThumbs');

const RUN_ID_RE = /^r_[A-Za-z0-9_]+$/;
const KEYS_PER_CALL = 60;

function setupThumbIpc(ipcMain, configStore, { live = createLiveThumbs({ capture: capturePage }), check = probe } = {}) {
  const configPath = () => configStore.configPath;

  /** appId -> { key, at, live }: a live capture wins over the stored one only when newer. */
  ipcMain.handle('thumbs:index', async () => {
    try {
      const byApp = {};
      for (const [appId, t] of Object.entries(appThumbs(runHistory.readRuns(configPath())))) {
        byApp[appId] = { key: t.id, at: t.at, live: false };
      }
      for (const [appId, t] of Object.entries(live.index())) {
        if (!byApp[appId] || t.at >= byApp[appId].at) byApp[appId] = { key: t.key, at: t.at, live: true };
      }
      return { success: true, byApp };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('thumbs:get', async (_, keys) => {
    try {
      const want = (Array.isArray(keys) ? keys : []).slice(0, KEYS_PER_CALL);
      const runs = new Map(runHistory.readRuns(configPath()).map((r) => [r.id, r]));
      const thumbs = {};
      for (const key of want) {
        const url = RUN_ID_RE.test(key) ? thumbDataUrl(configPath(), runs.get(key)) : live.get(key);
        if (url) thumbs[key] = url;
      }
      return { success: true, thumbs };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('thumbs:capture', async (_, appId, port) => {
    try {
      const p = Number(port);
      if (!Number.isInteger(p) || p < 1 || p > 65535) return { success: false, error: 'Invalid port' };
      if (!configStore.getApp(appId)) return { success: false, error: 'Unknown app' };
      if (await check(p) !== 'healthy') return { success: false, reason: 'down', error: 'Nothing is answering on that port' };
      const res = await live.request(appId, p);
      return res.ok ? { success: true, key: res.key } : { success: false, reason: res.reason, error: res.error };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
}

module.exports = { setupThumbIpc };
