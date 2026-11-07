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
    // The shell's own child was created with it; a later process that names the dead shell's pid as
    // its parent got a reused pid (F94).
    if (!shell && cur.ppid === shellPid && cur.created <= at + CREATED_AFTER_MS) return { ok: true, pid: cur.pid };
    cur = byPid.get(cur.ppid);
  }
  return no(`the process on its port (${listenerPid}) was not started by it`);
}

/**
 * Could the entry's server still be running, wherever it listens (or before it binds)? True when
 * a live process is the recorded shell, or a direct child of it, created with the start. The
 * server may be compiling, restarting under nodemon, or on a fallback port (F102): none of those
 * is "gone".
 */
function startStillAlive(entry, procs) {
  const at = Date.parse(entry.startedBy && entry.startedBy.at);
  const shellPid = Number(entry.pid);
  if (!Number.isFinite(at) || !Number.isInteger(shellPid) || shellPid < 1) return false;
  const withStart = (p) => Number.isFinite(p.created) && p.created >= at - CREATED_BEFORE_MS && p.created <= at + CREATED_AFTER_MS;
  return (procs || []).some((p) => (p.pid === shellPid || p.ppid === shellPid) && withStart(p));
}

/** The pid listening on `port` from a fresh scan; undefined when the scan failed (an empty list). */
async function scanListener(scanPorts, port) {
  const ports = await scanPorts();
  if (!Array.isArray(ports) || !ports.length) return undefined;
  const hit = ports.find((p) => Number(p.port) === Number(port));
  return (hit && hit.pid) || null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Unix: `kill <pid>` reaches one process, and a server under `sh -c` / npm survives its parent
 * (F96). Signal the whole tree deepest first, SIGTERM, then SIGKILL what is still alive after the
 * grace period. Windows uses taskkill /T (processManager.killProcess) instead.
 */
async function killTreeUnix(rootPid, procs, deps = {}) {
  const { descendantsOf } = require('./processTree');
  const { isOwnPid } = require('../core/selfGuard');
  const signal = deps.signal || ((pid, sig) => process.kill(pid, sig));
  const alive = deps.alive || ((pid) => { try { process.kill(pid, 0); return true; } catch { return false; } });
  const graceMs = deps.graceMs == null ? 3000 : deps.graceMs;
  const pairs = procs.map((p) => [p.pid, p.ppid]);
  const up = new Map(pairs);
  const depth = (pid) => { let d = 0; let cur = pid; while (cur !== rootPid && up.has(cur) && d < MAX_DEPTH) { cur = up.get(cur); d++; } return d; };
  const tree = [...descendantsOf([rootPid], pairs)].filter((pid) => !isOwnPid(pid)).sort((a, b) => depth(b) - depth(a));
  const send = (pid, sig) => { try { signal(pid, sig); } catch { /* already gone */ } };
  for (const pid of tree) send(pid, 'SIGTERM');
  for (let waited = 0; waited < graceMs && tree.some(alive); waited += 100) await sleep(100);
  for (const pid of tree) if (alive(pid)) send(pid, 'SIGKILL');
  return { success: true };
}

/**
 * Stop app `appId` that an earlier session started, after verifyAdopted proves the listener is it.
 * Success only once its port is free. When nothing listens and its shell is gone too, the server
 * died while nobody watched: the entry is dropped, its run closed as 'unknown', and Stop says it
 * was not running (F93). The caller records the stop (as for any Stop).
 * deps (tests, and quit's single snapshot): readRuntime, scanPorts, listProcesses, killProcess,
 * snap ({procs, listenerOf}), platform, signal/alive/graceMs, freeWithinMs.
 * @returns {Promise<{success: boolean, adopted?: boolean, notRunning?: boolean, pid?: number, message?: string, error?: string}>}
 */
async function stopAdopted(configPath, appId, deps = {}) {
  const cf = require('../core/configFile');
  const readRuntime = deps.readRuntime || cf.readRuntime;
  const recordGone = deps.recordGone || cf.recordGone;
  // scanPorts, not checkPort: checkPort reads a failed scan ([]) as "nothing listens" (F103).
  const scanPorts = deps.scanPorts || require('./portScanner').scanPorts;
  const listProcesses = deps.listProcesses || require('./processTree').listProcesses;
  const killProcess = deps.killProcess || require('./processManager').killProcess;
  const platform = deps.platform || require('os').platform();
  const entry = configPath ? readRuntime(configPath).apps[appId] : null;
  if (!entry || !entry.startedBy) return { success: false, error: 'App not found or not running' };
  const port = Number(entry.port);
  if (!Number.isInteger(port) || port < 1) return { success: false, error: 'Not stopped: its start recorded no port' };
  const listenerPid = deps.snap ? deps.snap.listenerOf(port) : await scanListener(scanPorts, port);
  if (listenerPid === undefined) return { success: false, error: 'Not stopped: the port scan could not be read' };
  const procs = deps.snap ? deps.snap.procs : await listProcesses();
  if (!Array.isArray(procs) || !procs.length) return { success: false, error: 'Not stopped: the process list could not be read' };
  if (!listenerPid && !entry.crashed && !startStillAlive(entry, procs)) {
    recordGone(configPath, appId, entry.startedBy.at);
    return { success: true, adopted: true, notRunning: true, message: `${appId} was not running; its record is cleared` };
  }
  const v = verifyAdopted({ entry, listenerPid, procs });
  if (!v.ok) return { success: false, error: `Not stopped: ${v.reason}` };
  const r = platform === 'win32' ? await killProcess(v.pid) : await killTreeUnix(v.pid, procs, deps);
  if (!r || !r.success) return r || { success: false, error: 'Failed to kill process' };
  const freeWithinMs = deps.freeWithinMs == null ? 5000 : deps.freeWithinMs;
  for (let waited = 0; ; waited += 150) {
    const still = await scanListener(scanPorts, port); // undefined (failed scan) is not "free"
    if (still === null || (still !== undefined && still !== listenerPid)) break;
    if (waited >= freeWithinMs) {
      return { success: false, error: still === undefined
        ? `Not confirmed: the port scan failed while waiting for port ${port} to free`
        : `Not stopped: port ${port} is still held by PID ${listenerPid}` };
    }
    await sleep(150);
  }
  return { success: true, adopted: true, pid: v.pid, message: `Stopped the server on port ${port} (PID ${v.pid})` };
}

/** Started from the desktop process: its window, or the web portal it serves in-process (F98). */
const DESKTOP_SURFACES = new Set(['desktop', 'web']);
function startedByDesktop(entry) {
  return !!entry && !entry.crashed && !!entry.startedBy && DESKTOP_SURFACES.has(entry.startedBy.surface);
}

/**
 * One read of the OS for many entries: every process and every listener.
 * @returns {Promise<{procs: Array, listenerOf: (port: number) => number|null} | null>} null when
 *   either read failed (an empty listing is a failed one), so callers do nothing rather than guess.
 */
async function snapshot(deps = {}, { timeoutMs } = {}) {
  const listProcesses = deps.listProcesses || require('./processTree').listProcesses;
  const scanPorts = deps.scanPorts || require('./portScanner').scanPorts;
  const opts = timeoutMs ? { timeoutMs } : undefined; // both reads capped inside quit's budget (F105)
  const [procs, ports] = await Promise.all([listProcesses(opts), scanPorts(opts)]);
  if (!Array.isArray(procs) || !procs.length || !Array.isArray(ports) || !ports.length) return null;
  const byPort = new Map(ports.map((p) => [Number(p.port), p.pid]));
  return { procs, listenerOf: (port) => byPort.get(Number(port)) || null };
}

/**
 * First launch after a quit: a desktop start whose server is gone (nothing on its port, or what is
 * there fails verifyAdopted) loses its runtime entry and its run closes as 'unknown' (F93).
 * Otherwise the entry reads crashed for ever, its History run never ends and the localhost watcher
 * leaves the app's port alone. Only entries stamped before `before` (this launch) are looked at.
 * @returns {Promise<string[]>} the app ids dropped
 */
async function reconcileStale(configPath, { before = Date.now(), deps = {} } = {}) {
  const cf = require('../core/configFile');
  const readRuntime = deps.readRuntime || cf.readRuntime;
  const recordGone = deps.recordGone || cf.recordGone;
  // No recorded port: nothing can show it is gone, so it is never dropped here (F102).
  const hasPort = (e) => Number.isInteger(Number(e.port)) && Number(e.port) > 0;
  const stale = Object.entries(readRuntime(configPath).apps || {})
    .filter(([, e]) => startedByDesktop(e) && hasPort(e) && Date.parse(e.startedBy.at) < before);
  if (!stale.length) return [];
  const snap = await snapshot(deps);
  if (!snap) return [];
  const dropped = [];
  for (const [id, entry] of stale) {
    // Gone only when nothing on its port is it AND neither its shell nor a child of it lives (F102).
    if (verifyAdopted({ entry, listenerPid: snap.listenerOf(entry.port), procs: snap.procs }).ok) continue;
    if (startStillAlive(entry, snap.procs)) continue;
    if (recordGone(configPath, id, entry.startedBy.at)) dropped.push(id);
  }
  return dropped;
}

module.exports = { verifyAdopted, stopAdopted, reconcileStale, snapshot, startedByDesktop };
