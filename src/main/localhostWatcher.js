/**
 * Auto-tracks every localhost dev server on this machine, whoever started it.
 *
 * Every 10 s: scan the listening ports, drop the ones a registered app owns,
 * keep the ones localhostDetect.classify calls a developer's server, and require
 * an HTTP answer on two scans in a row before opening a run (a server that is
 * still starting, or a port that flickers, never makes one). A run closes when
 * its port has been gone for two scans. Runs live in history/runs.json, so the
 * thumbnail watcher and the History tab treat them like any other run.
 *
 * On the first scan, open detected runs left by a previous session are adopted
 * if their server is still up and closed (endedBy 'unknown') if not.
 *
 * Setting `autoTrackLocalhost` (default on). Nothing here navigates or fetches
 * anything but 127.0.0.1 / ::1, and a failure never reaches the app.
 * Scan, probe, history and clock are injectable for tests.
 */
const fs = require('fs');
const path = require('path');

const detect = require('../core/localhostDetect');
const runHistory = require('../core/runHistory');

const INTERVAL_MS = 10000;
const CONFIRM_SCANS = 2; // answers in a row before a run opens
const ABSENT_SCANS = 2;  // scans without the port before a run closes

const startedBy = () => ({ kind: 'detected', surface: 'desktop', at: new Date().toISOString() });

/**
 * The folder's own start command (package manager by lockfile, scripts.dev else
 * scripts.start), read through projectScanner. Null unless the folder is itself
 * the project and the script exists, so "Start again" never runs a guess.
 */
async function startCommandFor(cwd) {
  try {
    const found = await require('./projectScanner').detectProject(cwd);
    if (!found || path.resolve(found.path).toLowerCase() !== path.resolve(cwd).toLowerCase()) return null;
    if (found.type !== 'Node.js') return found.command || null;
    const script = /^(?:\S+ run |yarn )(\S+)/.exec(found.command || '');
    const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
    return script && pkg.scripts && pkg.scripts[script[1]] ? found.command : null;
  } catch { return null; }
}

/** The loopback host to ask: ::1 for a server bound only there, else 127.0.0.1. */
const hostFor = (info) => (detect.hostOf(info.address) === '::1' ? '::1' : '127.0.0.1');

/**
 * @param {object} o
 * @param {string}   o.configPath
 * @param {Function} o.getSettings       () => settings
 * @param {Function} o.getApps           () => registered apps
 * @param {Function} o.scan              () => Promise<portInfo[]>
 * @param {Function} o.registeredPorts   (ports, apps) => Promise<Set<number>> ports a registered app owns
 * @param {Function} o.probe             (port, path, timeoutMs, host) => Promise<'healthy'|'unhealthy'|'down'>
 * @param {number[]|Function} [o.ownPorts]  ports PortPilot serves on (or a function returning them)
 * @param {number[]} [o.onlyPorts]       test seam: look at these ports and no others
 */
function createLocalhostWatcher(o) {
  const history = o.history || runHistory;
  const log = o.log || ((...a) => console.error('[localhostWatcher]', ...a));
  const startFor = o.startCommandFor || startCommandFor;
  const open = new Map();     // appId -> { runId, port, absent }
  const pending = new Map();  // port -> { id, count }
  let reconciled = false;
  let busy = false;

  const closeAll = (endedBy) => {
    for (const [id, entry] of open) {
      try { history.closeRun(o.configPath, id, { endedBy }); } catch (err) { log(`close ${entry.runId}:`, err.message); }
    }
    open.clear();
    pending.clear();
  };

  // Candidates this scan: dev servers no registered app owns, each with its project and id.
  async function candidates(ports) {
    const owned = await o.registeredPorts(ports, o.getApps());
    const only = o.onlyPorts && o.onlyPorts.length ? new Set(o.onlyPorts) : null;
    const ownPorts = typeof o.ownPorts === 'function' ? o.ownPorts() : o.ownPorts;
    const out = [];
    for (const info of ports) {
      if (owned.has(info.port) || (only && !only.has(info.port))) continue;
      if (!detect.classify(info, { ownPorts }).dev) continue;
      const proj = detect.deriveProject(info.commandLine);
      out.push({ info, proj, id: detect.detectedAppId(proj.cwd, proj.name, info.port) });
    }
    return out;
  }

  // First scan after launch: adopt what is still up, close what is not.
  function reconcile(present) {
    const ids = new Set(present.map((c) => c.id));
    for (const run of history.readRuns(o.configPath)) {
      if (!run.detected || run.stoppedAt || open.has(run.appId)) continue;
      if (ids.has(run.appId)) open.set(run.appId, { runId: run.id, port: run.port, absent: 0 });
      else history.closeRun(o.configPath, run.appId, { endedBy: 'unknown' });
    }
    reconciled = true;
  }

  async function confirm(c) {
    const answer = await o.probe(c.info.port, '/', 2000, hostFor(c.info));
    const seen = pending.get(c.info.port);
    if (answer === 'down') { pending.delete(c.info.port); return false; }
    const count = seen && seen.id === c.id ? seen.count + 1 : 1;
    pending.set(c.info.port, { id: c.id, count });
    return count >= CONFIRM_SCANS;
  }

  async function openFor(c) {
    const startCommand = c.proj.cwd ? await startFor(c.proj.cwd) : null;
    const meta = { name: c.proj.name, cwd: c.proj.cwd, command: startCommand || c.info.commandLine || null, startCommand };
    const { id: runId } = history.openRun(o.configPath, c.id, startedBy(), { port: c.info.port, meta });
    open.set(c.id, { runId, port: c.info.port, absent: 0 });
    pending.delete(c.info.port);
  }

  async function tick() {
    if (busy) return;
    busy = true;
    try {
      if ((o.getSettings() || {}).autoTrackLocalhost === false) {
        if (open.size) closeAll('stop');
        reconciled = false;
        return;
      }
      const ports = await o.scan();
      // A machine always listens on something; an empty scan is a failed scan, and
      // reading it as "every server stopped" would close every run.
      if (!Array.isArray(ports) || !ports.length) return;
      const found = await candidates(ports);
      if (!reconciled) reconcile(found);

      const present = new Set(found.map((c) => c.id));
      for (const [id, entry] of [...open]) {
        if (present.has(id)) { entry.absent = 0; continue; }
        if (++entry.absent < ABSENT_SCANS) continue;
        history.closeRun(o.configPath, id, { endedBy: 'stop' });
        open.delete(id);
      }
      // Forget a port that stopped answering, or went to another project.
      for (const [port, seen] of pending) if (!found.some((c) => c.info.port === port && c.id === seen.id)) pending.delete(port);

      for (const c of found) {
        if (open.has(c.id)) continue;
        try {
          if (await confirm(c)) await openFor(c);
        } catch (err) { log(`port ${c.info.port}:`, err.message); }
      }
    } catch (err) {
      log('tick failed:', err.message);
    } finally { busy = false; }
  }

  let timer = null;
  return {
    tick,
    start() {
      if (timer) return;
      timer = setInterval(tick, o.intervalMs || INTERVAL_MS);
      if (timer.unref) timer.unref();
      tick();
    },
    stop() { if (timer) clearInterval(timer); timer = null; },
    /** For tests: what is open and what is waiting for its second answer. */
    state: () => ({ open: Object.fromEntries(open), pending: Object.fromEntries(pending) }),
  };
}

/** The watcher wired to the real scanner, matcher and probe. */
function startLocalhostWatcher(configStore, extra = {}) {
  const { scanPorts } = require('./portScanner');
  const { matchPortsWithOwnership } = require('./ipcHandlers');
  const { probe } = require('./healthCheck');
  const watcher = createLocalhostWatcher({
    configPath: configStore.configPath,
    getSettings: () => configStore.getSettings(),
    getApps: () => configStore.getApps(),
    scan: scanPorts,
    registeredPorts: async (ports, apps) => {
      // The same matching the Apps tab uses, so "owned by a registered app" means one thing.
      const { matches, unknownConflicts } = await matchPortsWithOwnership(ports, apps);
      return new Set([...Object.values(matches).map((m) => m.port), ...unknownConflicts.map((c) => c.port)]);
    },
    probe,
    ...extra,
  });
  watcher.start();
  return watcher;
}

module.exports = { createLocalhostWatcher, startLocalhostWatcher, startCommandFor, INTERVAL_MS, CONFIRM_SCANS, ABSENT_SCANS };
