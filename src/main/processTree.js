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

module.exports = { descendantsOf, ownedPidsByApp, listProcessPairs };
