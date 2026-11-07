/**
 * Which processes are a browser profile's browser, and what a browser leaves on its folder
 * (findings F21, F22, F45, F64-F82).
 *
 * A browser's debug port can go quiet seconds before its main process exits, and Brave's crash
 * reporter (--type=crashpad-handler) can keep the profile folder open a minute or more. Stop waits
 * for the main process; Start checks nothing holds the folder first.
 *
 * Nothing is ever ended unless the identity check passes: the pid still runs, its name is a
 * browser's, its command line names exactly this profile's --user-data-dir, and its start time
 * (createdAt) is the one seen when it was identified. The kill itself re-checks pid + createdAt in
 * the same OS call (browserProcessQuery.killVerified), and ends only the browser's own processes,
 * never a tree. A query that fails is UNKNOWN: it is never read as "exited" and never leads to a kill.
 *
 * Side effects go through `d` (browserRun's deps: processInfo, dirHolders, killVerified, sleep) so
 * tests use a fake process table.
 */
const q = require('./browserProcessQuery');

// How long a browser's main process may outlive its quiet debug port, or hold the folder before a
// Start, before it is ended.
const EXIT_MS = 5000;
const KILL_MS = 5000;

const norm = (s) => String(s).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
const BROWSER_PROCESS_RE = q.BROWSER_NAME_RE;

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

// Main processes this PortPilot process launched or stopped, per profile folder: pid -> createdAt
// In memory and per process: the desktop app and each MCP server keep their own, so a browser
// started by another of them is one this process "cannot confirm" (F63, F68). A pid whose start
// time could not be read is never recorded: a pid alone cannot tell our browser from a reuse (F77).
const ours = new Map();
function remember(dir, pid, createdAt) {
  if (!Number.isInteger(pid) || pid <= 0 || !createdAt) return;
  const k = norm(dir);
  if (!ours.has(k)) ours.set(k, new Map());
  ours.get(k).set(pid, createdAt);
}
const recorded = (dir, pid) => (ours.get(norm(dir)) || new Map()).get(pid);
/** True when `p` is a process we recorded: same pid and the same start time, both known. */
function isOurs(dir, p) {
  const at = recorded(dir, p.pid);
  return !!(at && p.createdAt && at === p.createdAt);
}
const startMs = (at) => (at ? Date.parse(at) : NaN);
// Once a pid is seen gone it is forgotten, so a later process with the same pid never inherits "ours".
const forget = (dir, pid) => { if (ours.get(norm(dir))) ours.get(norm(dir)).delete(pid); };
const isHelper = (p) => /--type=/i.test(String(p.commandLine || ''));

/**
 * The identity check: the process info when `pid` is still this profile's browser (and, if
 * `createdAt` is given, the same process instance), null when it is not (gone, or the pid now names
 * something else), UNKNOWN when the query failed.
 */
async function identify(pid, dir, d, createdAt = null) {
  const info = await d.processInfo(pid);
  if (info && info.unknown) return q.UNKNOWN;
  if (!info || !info.processName || !holdsDir(info, dir)) return null;
  if (createdAt && info.createdAt && info.createdAt !== createdAt) return null;
  return info;
}

// Waits run on the wall clock, not a sum of poll intervals: one Windows process query can take a second.

/** { state: 'gone' } | { state: 'alive', info } | { state: 'unknown' } after waiting up to `ms`. */
async function waitExit(pid, dir, d, ms, pollMs, createdAt) {
  for (const end = Date.now() + ms; ;) {
    const r = await identify(pid, dir, d, createdAt);
    if (r === null) return { state: 'gone' };
    const last = r.unknown ? { state: 'unknown' } : { state: 'alive', info: r };
    if (Date.now() >= end) return last;
    await d.sleep(pollMs);
  }
}

/**
 * After the debug port goes quiet: wait for the browser's main process to exit, and end it (and its
 * own helpers) if it is still there after `exitMs`. Resolves { pid, how, ms } with how one of
 *   exited         it went by itself (or its pid now names another process: never killed)
 *   killed         it outlived the wait and passed the identity check, so it was ended
 *   mismatch       the last check before the kill refused it (another process now): not killed
 *   still-running  it survived the kill too
 *   unknown        the process could not be queried: nothing was killed and nothing is claimed
 */
async function awaitBrowserExit(pid, dir, d, o, pollMs) {
  const t0 = Date.now();
  const done = (how) => {
    if (how === 'exited' || how === 'killed') forget(dir, pid);
    return { pid, how, ms: Date.now() - t0 };
  };
  const first = await waitExit(pid, dir, d, o.exitMs ?? EXIT_MS, pollMs, recorded(dir, pid));
  if (first.state !== 'alive') return done(first.state === 'gone' ? 'exited' : 'unknown');
  const r = await d.killVerified({ pid, createdAt: first.info.createdAt, dir, main: true });
  if (r === 'gone') return done('exited');
  if (r === 'mismatch') { forget(dir, pid); return done('mismatch'); }
  if (r !== 'killed') return done('unknown');
  const after = await waitExit(pid, dir, d, o.killMs ?? KILL_MS, pollMs, first.info.createdAt);
  return done({ gone: 'killed', alive: 'still-running' }[after.state] || 'unknown');
}

/**
 * Before a launch: nothing may hold the profile folder, or the browser already on it takes the
 * launch for itself and Start times out (F45). Waits up to `folderMs` for holders to go; then ends
 * what is left only when every one of them is a leftover of our own:
 *   - a main browser process this PortPilot process recorded (same pid and start time)
 *   - a helper (crash reporter and the like) whose parent is gone, or is one of ours. By the owner's
 *     decision (F84) an orphan helper is ended whoever launched its browser, a hand-launched one
 *     included: with its browser closed it only holds the folder.
 * A main we did not record, a helper whose parent is alive and not ours, or a parent that cannot be
 * queried makes the whole folder someone else's: nothing is killed.
 * Resolves null when the folder is free (or cannot be queried: the launch goes ahead as before),
 * else { strangers } (nothing killed) or { stuck, killed } (still there; killed: how many kills
 * were accepted): arrays of { pid, processName }.
 */
async function freeFolder(dir, o, d) {
  const pollMs = o.pollMs || 250;
  const holders = async () => {
    const all = await d.dirHolders(dir);
    return all == null ? null : all.filter((p) => p.processName && holdsDir(p, dir));
  };
  const until = async (ms) => {
    let now = await holders();
    for (const end = Date.now() + ms; (now == null || now.length) && Date.now() < end;) {
      await d.sleep(pollMs);
      now = await holders();
    }
    return now;
  };
  const brief = (ps) => ps.map((p) => ({ pid: p.pid, processName: p.processName }));
  const left = await until(o.folderMs ?? EXIT_MS);
  if (!left || !left.length) return null;

  // ps rows carry no start time (macOS, Linux): read it per process, or the holder cannot be ours.
  for (const p of left) {
    if (p.createdAt) continue;
    const pi = await d.processInfo(p.pid);
    if (pi && !pi.unknown && pi.createdAt) p.createdAt = pi.createdAt;
  }
  // Whose is each holder? A helper follows its parent; a parent outside the list is asked directly.
  // A "parent" that started after its child is a later process on a reused pid: the child is an
  // orphan (F78).
  const verdict = new Map();
  const judge = async (p, depth = 0) => {
    if (verdict.has(p.pid)) return verdict.get(p.pid);
    let v;
    if (!isHelper(p)) v = isOurs(dir, p) ? 'ours' : 'stranger';
    else {
      const inList = left.find((x) => x.pid === p.ppid);
      const parent = inList || await d.processInfo(p.ppid);
      if (!parent) v = 'orphan';
      else if (parent.unknown) v = 'stranger';
      else if (startMs(parent.createdAt) > startMs(p.createdAt)) v = 'orphan';
      else if (inList && depth < 8) v = await judge(inList, depth + 1);
      else v = isOurs(dir, parent) ? 'ours' : 'stranger';
    }
    verdict.set(p.pid, v);
    return v;
  };
  for (const p of left) await judge(p);
  const strangers = left.filter((p) => verdict.get(p.pid) === 'stranger');
  if (strangers.length) return { strangers: brief(strangers) };

  // Main processes first: killVerified ends a main's own helpers with it.
  let killed = 0;
  for (const p of [...left].sort((a, b) => isHelper(a) - isHelper(b))) {
    const now = await identify(p.pid, dir, d, p.createdAt);
    if (now && !now.unknown && await d.killVerified({ pid: p.pid, createdAt: now.createdAt, dir, main: false }) === 'killed') killed++;
  }
  const stuck = await until(o.killMs ?? KILL_MS);
  if (stuck == null) return { stuck: brief(left), killed };
  for (const p of left) if (!stuck.some((s) => s.pid === p.pid)) forget(dir, p.pid);
  return stuck.length ? { stuck: brief(stuck), killed } : null;
}

module.exports = {
  EXIT_MS, holdsDir, remember, forget, identify, awaitBrowserExit, freeFolder,
  describePid: q.describePid, processInfo: q.processInfo, dirHolders: q.dirHolders, parsePsTable: q.parsePsTable, killVerified: q.killVerified,
};
