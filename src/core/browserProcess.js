/**
 * Which processes are a browser profile's browser, and what a browser leaves on its folder
 * (findings F21, F22, F45).
 *
 * A browser's debug port can go quiet seconds before its main process exits, and Brave's crash
 * reporter (--type=crashpad-handler) can keep the profile folder open a minute or more. Stop waits
 * for the main process; Start checks nothing holds the folder first. Nothing is ever ended unless
 * the identity check passes right before: the pid still runs, its name is a browser's, and its
 * command line names exactly this profile's --user-data-dir. A reused pid fails it.
 *
 * Process queries are Windows (CIM) or ps (macOS and Linux). Side effects go through `d`
 * (browserRun's deps: processInfo, dirHolders, kill, sleep) so tests use a fake process table.
 */
const path = require('path');
const { execFile } = require('child_process');

// How long a browser's main process may outlive its quiet debug port, or hold the folder before a
// Start, before it is ended.
const EXIT_MS = 5000;
const KILL_MS = 5000;

const run = (file, args) => new Promise((resolve) => {
  execFile(file, args, { encoding: 'utf8', timeout: 5000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
    (err, stdout) => resolve(err ? null : stdout));
});

async function describePid(pid) {
  if (process.platform === 'win32') {
    const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}" | Select-Object Name,CommandLine | ConvertTo-Json -Compress`]);
    try {
      const j = JSON.parse(out);
      return { processName: j.Name || null, commandLine: j.CommandLine || null };
    } catch { return { processName: null, commandLine: null }; }
  }
  const args = await run('ps', ['-ww', '-o', 'args=', '-p', String(pid)]);
  const comm = await run('ps', ['-o', 'comm=', '-p', String(pid)]);
  return { processName: comm ? path.basename(comm.trim()) : null, commandLine: args ? args.trim() : null };
}

/** { pid, processName, commandLine } of a running process, or null when there is no such process. */
async function processInfo(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  const info = await describePid(pid);
  return info.processName || info.commandLine ? { pid, ...info } : null;
}

/** Lines of `ps -A -ww -o pid=,ppid=,args=` as { pid, ppid, processName, commandLine }. Pure. */
function parsePsTable(out) {
  const rows = [];
  for (const line of String(out || '').split(/\r?\n/)) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);
    if (!m) continue;
    const exe = m[3].trim().split(/\s+/)[0];
    rows.push({ pid: Number(m[1]), ppid: Number(m[2]), processName: path.basename(exe), commandLine: m[3].trim() });
  }
  return rows;
}

/**
 * Every process whose command line contains `dir` (a substring pre-filter: callers confirm each one
 * with holdsDir), as [{ pid, ppid, processName, commandLine }]. [] when the query fails.
 */
async function dirHolders(dir) {
  const key = String(dir).replace(/\//g, path.sep === '\\' ? '\\' : '/').toLowerCase();
  if (process.platform === 'win32') {
    const lit = key.replace(/'/g, "''");
    const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `@(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.ToLower().Contains('${lit}') } | Select-Object ProcessId,ParentProcessId,Name,CommandLine) | ConvertTo-Json -Compress`]);
    try {
      const j = JSON.parse(out);
      return (Array.isArray(j) ? j : [j]).filter(Boolean)
        .map((p) => ({ pid: p.ProcessId, ppid: p.ParentProcessId, processName: p.Name || null, commandLine: p.CommandLine || null }));
    } catch { return []; }
  }
  return parsePsTable(await run('ps', ['-A', '-ww', '-o', 'pid=,ppid=,args='])).filter((p) => p.commandLine.toLowerCase().includes(key));
}

const norm = (s) => String(s).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
const BROWSER_PROCESS_RE = /chrome|chromium|msedge|brave|opera|vivaldi|browser/i;

/**
 * True when the holder is a browser launched with exactly this profile's user-data-dir.
 * The flag's value is compared whole, not searched for: "/p/shop" must not match a browser
 * started for "/p/shop-a". Unquoted command lines (ps output) carry the start URL after the
 * path, so the value may be followed by whitespace and then another flag or URL, nothing else.
 */
function holdsDir(holder, dir) {
  if (!holder || !holder.commandLine) return false;
  if (holder.processName && !BROWSER_PROCESS_RE.test(holder.processName)) return false;
  const line = String(holder.commandLine).replace(/\\/g, '/');
  const want = norm(dir);
  const flag = /--user-data-dir=/gi;
  for (let m = flag.exec(line); m; m = flag.exec(line)) {
    const rest = line.slice(m.index + m[0].length).replace(/^"/, '').toLowerCase();
    if (!rest.startsWith(want)) continue;
    const tail = rest.slice(want.length);
    // Brave's crash reporter (crashpad-handler) carries the value unquoted, then Windows' "/prefetch:N".
    if (/^\/?"?(\s+(-|https?:|file:|about:|\/prefetch:\d)|\s*$)/.test(tail)) return true;
  }
  return false;
}

// ---- Our own browsers ----------------------------------------------------------

// Main-process pids of browsers this PortPilot launched or stopped, per profile folder. Start uses
// them to tell a leftover of our own browser from a browser someone opened on the folder by hand.
// In memory only: after a relaunch every live main process on a folder counts as someone else's.
const ours = new Map();
function remember(dir, pid) {
  if (!Number.isInteger(pid) || pid <= 0) return;
  const k = norm(dir);
  if (!ours.has(k)) ours.set(k, new Set());
  ours.get(k).add(pid);
}
const isOurs = (dir, pid) => !!(ours.get(norm(dir)) && ours.get(norm(dir)).has(pid));
const isHelper = (p) => /--type=/i.test(String(p.commandLine || ''));

/** The identity check before anything is ended. The process info, or null when it fails. */
async function stillOnDir(pid, dir, d) {
  const info = await d.processInfo(pid);
  return info && info.processName && holdsDir(info, dir) ? info : null;
}

// Waits run on the wall clock, not a sum of poll intervals: one Windows process query can take a second.

/** True once `pid` is no longer this profile's browser (exited, or its pid now names something else). */
async function waitExit(pid, dir, d, ms, pollMs) {
  for (const end = Date.now() + ms; ;) {
    if (!(await stillOnDir(pid, dir, d))) return true;
    if (Date.now() >= end) return false;
    await d.sleep(pollMs);
  }
}

/**
 * After the debug port goes quiet: wait for the browser's main process to exit, and end its tree
 * if it is still there after `exitMs`. Resolves { pid, how, ms } with how one of
 *   exited         it went by itself (or its pid now names another process: never killed)
 *   killed         it outlived the wait and passed the identity check, so its tree was ended
 *   still-running  it survived the kill too
 */
async function awaitBrowserExit(pid, dir, d, o, pollMs) {
  const t0 = Date.now();
  const done = (how) => ({ pid, how, ms: Date.now() - t0 });
  if (await waitExit(pid, dir, d, o.exitMs ?? EXIT_MS, pollMs)) return done('exited');
  // waitExit's last look said it is still ours; look once more right before ending it.
  if (!(await stillOnDir(pid, dir, d))) return done('exited');
  await d.kill(pid);
  return done((await waitExit(pid, dir, d, o.killMs ?? KILL_MS, pollMs)) ? 'killed' : 'still-running');
}

/**
 * Before a launch: nothing may hold the profile folder, or the browser already on it takes the
 * launch for itself and Start times out (F45). Waits up to `folderMs` for holders to go; then ends
 * what is left only when it is a leftover of our own:
 *   - a main browser process this PortPilot launched or stopped (its pid is remembered), with its tree
 *   - helper processes (crash reporter and the like) once no main browser is left on the folder
 * Each pid passes the identity check right before it is ended. A main browser on the folder that
 * PortPilot did not launch is never touched.
 * Resolves null when the folder is free, else { strangers } (someone else's browser, nothing
 * killed) or { stuck } (still there after being ended): arrays of { pid, processName }.
 */
async function freeFolder(dir, o, d) {
  const pollMs = o.pollMs || 250;
  const holders = async () => (await d.dirHolders(dir)).filter((p) => p.processName && holdsDir(p, dir));
  const until = async (ms) => {
    let now = await holders();
    for (const end = Date.now() + ms; now.length && Date.now() < end;) {
      await d.sleep(pollMs);
      now = await holders();
    }
    return now;
  };
  const brief = (ps) => ps.map((p) => ({ pid: p.pid, processName: p.processName }));
  const left = await until(o.folderMs ?? EXIT_MS);
  if (!left.length) return null;
  const strangers = left.filter((p) => !isHelper(p) && !isOurs(dir, p.pid));
  if (strangers.length) return { strangers: brief(strangers) };
  // Main processes first: ending one takes its helpers with it.
  for (const p of [...left].sort((a, b) => isHelper(a) - isHelper(b))) {
    if (await stillOnDir(p.pid, dir, d)) await d.kill(p.pid);
  }
  const stuck = await until(o.killMs ?? KILL_MS);
  return stuck.length ? { stuck: brief(stuck) } : null;
}

module.exports = {
  EXIT_MS, describePid, processInfo, parsePsTable, dirHolders, holdsDir, remember, awaitBrowserExit, freeFolder,
};
