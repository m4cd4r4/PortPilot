/**
 * What quit does to the apps PortPilot started (product decision 2026-11-07).
 *
 * "Stop PortPilot-started apps on quit" is off unless the person ticked it: quit leaves the servers
 * running, their runs open and their runtime entries in place, so the next launch adopts them.
 * Ticked, quit stops every one still running: the ones this session started and the ones an earlier
 * session started and this one adopted (adoptedApps.js verifies each before it kills anything),
 * whether started from the window or the web portal it serves (F98).
 * Servers started from VS Code, by Claude over MCP or from a terminal are never touched by quit.
 */

// Quit is held for at most 10 s (main.js QUIT_CLEANUP_MS): one OS read for every adopted app,
// capped well inside that, then each kill waits at most a few seconds for its port (F97).
const SNAPSHOT_TIMEOUT_MS = 4000;
const PORT_FREE_WITHIN_MS = 3000;

/** Only a saved true stops apps on quit; a config that never set it keeps them running. */
function stopsAppsOnQuit(settings) {
  return !!settings && settings.stopAppsOnQuit === true;
}

/**
 * The app part of quit cleanup. Off: returns at once, so quit is not held for it.
 * deps: injectable for tests (cleanupAllProcesses, readRuntime, recordStop, snapshot, stopAdopted).
 * @returns {Promise<{stopping: boolean}>}
 */
async function stopAppsForQuit(settings, configPath, deps = {}) {
  if (!stopsAppsOnQuit(settings)) return { stopping: false };
  const cleanupAllProcesses = deps.cleanupAllProcesses || require('./processManager').cleanupAllProcesses;
  // This session's children: killed, stops recorded, crash stamps kept.
  await cleanupAllProcesses(configPath);
  if (!configPath) return { stopping: true };
  // What is left in the runtime file and was started from the desktop came from an earlier session.
  const cf = require('../core/configFile');
  const adopted = require('./adoptedApps');
  const readRuntime = deps.readRuntime || cf.readRuntime;
  const recordStop = deps.recordStop || cf.recordStop;
  const snapshot = deps.snapshot || adopted.snapshot;
  const stopAdopted = deps.stopAdopted || adopted.stopAdopted;
  const left = Object.entries(readRuntime(configPath).apps || {}).filter(([, e]) => adopted.startedByDesktop(e));
  if (!left.length) return { stopping: true };
  const snap = await snapshot({}, { timeoutMs: SNAPSHOT_TIMEOUT_MS });
  if (!snap) {
    console.error(`[quit] left ${left.map(([id]) => id).join(', ')} running: the process list or port scan could not be read`);
    return { stopping: true };
  }
  await Promise.all(left.map(async ([id]) => {
    const r = await stopAdopted(configPath, id, { snap, freeWithinMs: PORT_FREE_WITHIN_MS })
      .catch((err) => ({ success: false, error: err.message }));
    if (r.success) recordStop(configPath, id);
    else console.error(`[quit] left ${id} running: ${r.error}`);
  }));
  return { stopping: true };
}

module.exports = { stopsAppsOnQuit, stopAppsForQuit, SNAPSHOT_TIMEOUT_MS };
