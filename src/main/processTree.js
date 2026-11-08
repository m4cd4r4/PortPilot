/**
 * Which processes did PortPilot start? exec() records the shell's pid, but the server that
 * binds the port is a child or grandchild (cmd -> npm -> node), so ownership needs the tree.
 */
const { execFile } = require('child_process');
const os = require('os');

/**
 * Roots plus every descendant, from [pid, parentPid] pairs. Pure; safe on cycles.
 * @param {Iterable<number>} roots
 * @param {Array<[number, number]>} pairs
 * @returns {Set<number>}
 */
function descendantsOf(roots, pairs) {
  const children = new Map();
  for (const [pid, ppid] of pairs) {
    if (!children.has(ppid)) children.set(ppid, []);
    children.get(ppid).push(pid);
  }
  const seen = new Set(roots);
  const queue = [...seen];
  while (queue.length) {
    for (const child of children.get(queue.shift()) || []) {
      if (!seen.has(child)) { seen.add(child); queue.push(child); }
    }
  }
  return seen;
}

/** Every [pid, parentPid] pair on the machine; [] when the platform query fails. */
function listProcessPairs() {
  return new Promise((resolve) => {
    const done = (err, stdout) => {
      if (err || !stdout) return resolve([]);
      const pairs = [];
      for (const line of String(stdout).split(/\r?\n/)) {
        const m = line.trim().match(/^(\d+)[\s,]+(\d+)$/);
        if (m) pairs.push([parseInt(m[1], 10), parseInt(m[2], 10)]);
      }
      resolve(pairs);
    };
    const opts = { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 15000, windowsHide: true };
    if (os.platform() === 'win32') {
      execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command',
        'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId)" }'], opts, done);
    } else {
      execFile('ps', ['-A', '-o', 'pid=,ppid='], opts, done);
    }
  });
}

/** Seconds in a ps elapsed time, `[[dd-]hh:]mm:ss`; null when it is not one. */
function elapsedSeconds(etime) {
  const m = /^(?:(?:(\d+)-)?(\d+):)?(\d+):(\d+)$/.exec(String(etime));
  if (!m) return null;
  const [, d, h, mm, ss] = m.map((v) => (v == null ? 0 : Number(v)));
  return ((d * 24 + h) * 60 + mm) * 60 + ss;
}

/**
 * Parse the listing listProcesses reads. Pure. Windows gives epoch ms; elsewhere `ps -o etime`
 * ([[dd-]hh:]mm:ss, the one form BSD/macOS and Linux ps both print; `etimes` is Linux only, F95).
 * A line with no start time (CIM leaves CreationDate empty for some system processes) is kept with
 * created null (F99): it is never verified as ours.
 */
function parseProcessList(stdout, platform, now = Date.now()) {
  const out = [];
  for (const line of String(stdout || '').split(/\r?\n/)) {
    const m = line.trim().match(/^(\d+)\s+(\d+)(?:\s+(\S+))?$/);
    if (!m) continue;
    let created = null;
    if (m[3] != null) {
      if (platform === 'win32') created = /^-?\d+$/.test(m[3]) ? Number(m[3]) : null;
      else { const s = elapsedSeconds(m[3]); created = s == null ? null : now - s * 1000; }
    }
    out.push({ pid: parseInt(m[1], 10), ppid: parseInt(m[2], 10), created });
  }
  return out;
}

/**
 * Every process as { pid, ppid, created } (created = start time, epoch ms; null when unknown).
 * [] when the platform query fails or takes longer than timeoutMs. Windows reads CIM; elsewhere
 * `ps` (whole seconds).
 */
function listProcesses({ timeoutMs = 15000 } = {}) {
  return new Promise((resolve) => {
    const opts = { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: timeoutMs, windowsHide: true };
    const now = Date.now();
    const done = (err, stdout) => {
      if (err || !stdout) return resolve([]);
      resolve(parseProcessList(stdout, os.platform(), now));
    };
    if (os.platform() === 'win32') {
      execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command',
        'Get-CimInstance Win32_Process | ForEach-Object { $c = ""; if ($_.CreationDate) { $c = ([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds() }; "$($_.ProcessId) $($_.ParentProcessId) $c" }'], opts, done);
    } else {
      execFile('ps', ['-A', '-o', 'pid=,ppid=,etime='], opts, done);
    }
  });
}

/**
 * appId -> Set of pids PortPilot owns for that app (the tracked shell pid and its descendants).
 * @param {Array<{id: string, pid: number, running: boolean}>} running from getRunningApps()
 */
async function ownedPidsByApp(running) {
  const live = running.filter(r => r.running && Number.isInteger(r.pid) && r.pid > 0);
  if (!live.length) return {};
  const pairs = await listProcessPairs();
  const owned = {};
  for (const r of live) owned[r.id] = descendantsOf([r.pid], pairs);
  return owned;
}

module.exports = { descendantsOf, ownedPidsByApp, listProcessPairs, listProcesses, parseProcessList };
