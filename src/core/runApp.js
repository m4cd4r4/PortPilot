/**
 * "Start again" for a recorded run: make sure a registered app exists for the
 * run's folder, so any surface (desktop, VS Code) can start it the normal way.
 *
 *   appForRun(configPath, run) -> { ok: true, appId, port } | { ok: false, error }
 *
 * An app already registered for the same folder is reused as it is. Otherwise
 * one is added with the run's name, folder, start command and port. Nothing is
 * started here: the caller starts the app through its own start path, so the
 * run is stamped the same way as any other start.
 *
 * Zero dependencies and no Electron - the VS Code extension loads a copy.
 */
const fs = require('fs');
const path = require('path');
const configFile = require('./configFile');

const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16', '#F97316', '#6366F1'];

// One key per real folder: slash and trailing-slash insensitive, and case
// folded only where the file system is (Windows, macOS).
function cwdKey(p, platform = process.platform) {
  const s = path.normalize(String(p || '')).replace(/\\/g, '/').replace(/\/+$/, '');
  return platform === 'win32' || platform === 'darwin' ? s.toLowerCase() : s;
}

const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

function newAppId() {
  return `app_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

function pickColor(seed) {
  let h = 0;
  for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

/** Why a run cannot be started again, or null. */
function refusalFor(run) {
  if (!run || typeof run !== 'object') return 'That run is no longer in the history.';
  if (!run.cwd || typeof run.cwd !== 'string') return 'This run has no project folder recorded.';
  if (!isDir(run.cwd)) return `The folder ${String(run.cwd).replace(/\\/g, '/')} no longer exists.`;
  if (!String(run.startCommand || run.command || '').trim()) return 'This run has no start command recorded.';
  return null;
}

function appForRun(configPath, run) {
  const why = refusalFor(run);
  if (why) return { ok: false, error: why };
  const command = String(run.startCommand || run.command).trim();
  const wantPort = Number.isInteger(Number(run.port)) && Number(run.port) > 0 ? Number(run.port) : null;
  try {
    const { result } = configFile.updateJson(configPath, (config) => {
      if (!Array.isArray(config.apps)) config.apps = [];
      const key = cwdKey(run.cwd);
      const same = config.apps.find((a) => a && a.cwd && cwdKey(a.cwd) === key);
      if (same) return { appId: same.id, port: Number(same.preferredPort) || wantPort };
      const now = new Date().toISOString();
      const name = String(run.appName || path.basename(run.cwd)).slice(0, 100);
      const app = {
        id: newAppId(),
        name,
        command,
        cwd: run.cwd,
        preferredPort: wantPort,
        fallbackRange: null,
        env: {},
        autoStart: false,
        isFavorite: false,
        group: null,
        description: 'Added by Start again from the run history',
        color: pickColor(run.cwd),
        createdAt: now,
        updatedAt: now,
      };
      config.apps.push(app);
      return { appId: app.id, port: wantPort };
    }, () => ({ apps: [], settings: {}, groups: [] }));
    return { ok: true, appId: result.appId, port: result.port };
  } catch (err) {
    return { ok: false, error: `Could not register the app: ${err.message}` };
  }
}

module.exports = { appForRun, refusalFor, cwdKey };
