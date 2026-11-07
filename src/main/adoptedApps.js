/**
 * Stop a server PortPilot started in an earlier session (F42).
 *
 * Quit can leave PortPilot-started servers running (quitApps.js); the next launch adopts them from
 * the runtime sidecar ({ startedBy, pid, port } per app, pid = the shell exec() spawned). This
 * session never spawned them, so processManager has no child for them and Stop used to answer
 * "App not found or not running" while the card read Running.
 *
 * Nothing is killed unless every link holds, read fresh from the OS:
 *  - the app's runtime entry says PortPilot started it, with a shell pid and a port;
 *  - something listens on that port;
 *  - the listener's parent chain climbs to the recorded shell pid;
 *  - every process on that chain was created after the recorded start (less a few seconds), so a
 *    parent pid Windows recorded for a process older than our shell never counts;
 *  - if a process holds the shell pid now, it was created within moments of the recorded start:
 *    a pid handed to another process since is never taken for ours.
 * The shell usually dies with the quit (measured in the restarts journey) while its server lives
 * on with the dead shell as its parent pid. Killed: the shell's tree when the shell is alive, else
 * the tree of the oldest live process on the chain. Either is the server and only what it started.
 */

// The stamp is written after the start resolves (~500 ms after the shell spawns).
const CREATED_BEFORE_MS = 10000;
const CREATED_AFTER_MS = 5000;
const MAX_DEPTH = 32;

/**
 * Is the process listening on the entry's port the server the entry's shell started? Pure.
 * @param {{entry: object, listenerPid: number, procs: Array<{pid: number, ppid: number, created: number|null}>}} o
 * @returns {{ok: true, pid: number} | {ok: false, reason: string}} pid: the process whose tree to kill
 */
function verifyAdopted({ entry, listenerPid, procs }) {
  const no = (reason) => ({ ok: false, reason });
  if (!entry || !entry.startedBy || entry.crashed) return no('PortPilot has no record of starting it');
  const shellPid = Number(entry.pid);
  if (!Number.isInteger(shellPid) || shellPid < 1) return no('its start recorded no process id');
  if (!Number.isInteger(listenerPid) || listenerPid < 1) return no('nothing listens on its port');
  const at = Date.parse(entry.startedBy.at);
  if (!Number.isFinite(at)) return no('its start recorded no time');
  const byPid = new Map((procs || []).map((p) => [p.pid, p]));
  const shell = byPid.get(shellPid);
  if (shell && (!Number.isFinite(shell.created) || shell.created < at - CREATED_BEFORE_MS || shell.created > at + CREATED_AFTER_MS)) {
    return no(`process ${shellPid} is not the one it was started under`);
  }
  const floor = shell ? shell.created : at - CREATED_BEFORE_MS;
  let cur = byPid.get(listenerPid);
  for (let depth = 0; cur && depth < MAX_DEPTH; depth++) {
    if (cur.pid === shellPid) return { ok: true, pid: shellPid };
    if (!Number.isFinite(cur.created) || cur.created < floor) break;
    if (!shell && cur.ppid === shellPid) return { ok: true, pid: cur.pid };
    cur = byPid.get(cur.ppid);
  }
  return no(`the process on its port (${listenerPid}) was not started by it`);
}

/**
 * Stop app `appId` that an earlier session started, after verifyAdopted proves the listener is it.
 * The caller records the stop (as for any Stop). Dependencies are injectable for tests.
 * @returns {Promise<{success: boolean, adopted?: boolean, pid?: number, message?: string, error?: string}>}
 */
async function stopAdopted(configPath, appId, deps = {}) {
  const readRuntime = deps.readRuntime || require('../core/configFile').readRuntime;
  const checkPort = deps.checkPort || require('./portScanner').checkPort;
  const listProcesses = deps.listProcesses || require('./processTree').listProcesses;
  const killProcess = deps.killProcess || require('./processManager').killProcess;
  const entry = configPath ? readRuntime(configPath).apps[appId] : null;
  if (!entry || !entry.startedBy) return { success: false, error: 'App not found or not running' };
  const port = Number(entry.port);
  if (!Number.isInteger(port) || port < 1) return { success: false, error: 'Not stopped: its start recorded no port' };
  const info = await checkPort(port);
  const v = verifyAdopted({ entry, listenerPid: info && info.pid, procs: await listProcesses() });
  if (!v.ok) return { success: false, error: `Not stopped: ${v.reason}` };
  const r = await killProcess(v.pid);
  if (!r || !r.success) return r || { success: false, error: 'Failed to kill process' };
  return { success: true, adopted: true, pid: v.pid, message: `Stopped the server on port ${port} (PID ${v.pid})` };
}

module.exports = { verifyAdopted, stopAdopted };
