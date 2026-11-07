/**
 * What quit does to the apps PortPilot started (product decision 2026-11-07).
 *
 * "Stop PortPilot-started apps on quit" is off unless the person ticked it: quit leaves the servers
 * running, their runs open and their runtime entries in place, so the next launch adopts them.
 * Ticked, quit stops every one still running: the ones this session started and the ones an earlier
 * session started and this one adopted (adoptedApps.js verifies each before it kills anything).
 * Servers started from VS Code, by Claude over MCP or from a terminal are never touched by quit.
 */

/** Only a saved true stops apps on quit; a config that never set it keeps them running. */
function stopsAppsOnQuit(settings) {
  return !!settings && settings.stopAppsOnQuit === true;
}

/**
 * The app part of quit cleanup. Off: returns at once, so quit is not held for it.
 * @returns {Promise<{stopping: boolean}>}
 */
async function stopAppsForQuit(settings, configPath) {
  if (!stopsAppsOnQuit(settings)) return { stopping: false };
  const { cleanupAllProcesses } = require('./processManager');
  // This session's children: killed, stops recorded, crash stamps kept.
  await cleanupAllProcesses(configPath);
  if (!configPath) return { stopping: true };
  // What is left in the runtime file and was started from the desktop came from an earlier session.
  const { readRuntime, recordStop } = require('../core/configFile');
  const { stopAdopted } = require('./adoptedApps');
  const left = Object.entries(readRuntime(configPath).apps)
    .filter(([, e]) => e && !e.crashed && e.startedBy && e.startedBy.surface === 'desktop');
  await Promise.all(left.map(async ([id]) => {
    const r = await stopAdopted(configPath, id).catch((err) => ({ success: false, error: err.message }));
    if (r.success) recordStop(configPath, id);
    else console.error(`[quit] left ${id} running: ${r.error}`);
  }));
  return { stopping: true };
}

module.exports = { stopsAppsOnQuit, stopAppsForQuit };
