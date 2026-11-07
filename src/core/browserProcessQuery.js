/**
 * Operating-system process queries for browser profiles: what a pid is, which processes have a
 * profile folder open, and a kill that re-checks the process's identity in the same call.
 *
 * Windows uses CIM through one PowerShell call per query; macOS and Linux use ps. A query that
 * fails, times out or returns something unreadable is UNKNOWN, never "no such process": a slow
 * query must not read as "the browser exited", and nothing is ever killed on UNKNOWN.
 *
 * Identity is (pid, createdAt). A pid can be reused after its process exits; the pair cannot.
 * createdAt is the process's start time as the OS reports it (Windows CreationDate in UTC ISO form,
 * ps lstart elsewhere), compared as an opaque string.
 */
const path = require('path');
const { execFile } = require('child_process');

const UNKNOWN = Object.freeze({ unknown: true });
const BROWSER_NAME_PS = 'chrome|chromium|msedge|brave|opera|vivaldi|browser';

const QUERY_OPTS = { encoding: 'utf8', timeout: 5000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 };
/** { err, code, stdout } of a command; never throws. */
const runFull = (file, args) => new Promise((resolve) => {
  execFile(file, args, QUERY_OPTS, (err, stdout) => resolve({ err, code: err ? err.code : 0, stdout: stdout || '' }));
});
const ps1 = (script) => runFull('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);
const lit = (s) => String(s).replace(/'/g, "''");
const winDir = (dir) => String(dir).replace(/\//g, '\\').toLowerCase();

// The fields every Windows query reads, CreationDate as a stable UTC string.
const WIN_FIELDS = "ProcessId,ParentProcessId,Name,CommandLine,@{n='Created';e={$_.CreationDate.ToUniversalTime().ToString('o')}}";
const fromWin = (p) => ({ pid: p.ProcessId, ppid: p.ParentProcessId, processName: p.Name || null, commandLine: p.CommandLine || null, createdAt: p.Created || null });

/** { processName, commandLine } of a pid; nulls when it cannot be read. Used for port holders. */
async function describePid(pid) {
  const info = await processInfo(pid);
  return info && !info.unknown ? { processName: info.processName, commandLine: info.commandLine } : { processName: null, commandLine: null };
}

/**
 * { pid, ppid, processName, commandLine, createdAt } of a running process, null when there is no
 * such process, UNKNOWN when the query itself failed.
 */
async function processInfo(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  if (process.platform === 'win32') {
    const r = await ps1(`Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" | Select-Object ${WIN_FIELDS} | ConvertTo-Json -Compress`);
    if (r.err) return UNKNOWN;
    if (!r.stdout.trim()) return null;
    try { return fromWin(JSON.parse(r.stdout)); } catch { return UNKNOWN; }
  }
  // ps exits 1 with no output when the pid does not exist.
  const head = await runFull('ps', ['-o', 'ppid=,lstart=', '-p', String(pid)]);
  if (head.err) return head.code === 1 && !head.stdout.trim() ? null : UNKNOWN;
  const args = await runFull('ps', ['-ww', '-o', 'args=', '-p', String(pid)]);
  const comm = await runFull('ps', ['-o', 'comm=', '-p', String(pid)]);
  if (args.err || comm.err) return args.code === 1 ? null : UNKNOWN;
  const m = head.stdout.trim().match(/^(\d+)\s+(.+)$/);
  return {
    pid, ppid: m ? Number(m[1]) : null, createdAt: m ? m[2].trim() : null,
    processName: path.basename(comm.stdout.trim()) || null, commandLine: args.stdout.trim() || null,
  };
}

/** Lines of `ps -A -ww -o pid=,ppid=,args=` as { pid, ppid, processName, commandLine }. Pure. */
function parsePsTable(out) {
  const rows = [];
  for (const line of String(out || '').split(/\r?\n/)) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);
    if (!m) continue;
    const exe = m[3].trim().split(/\s+/)[0];
    rows.push({ pid: Number(m[1]), ppid: Number(m[2]), processName: path.basename(exe), commandLine: m[3].trim(), createdAt: null });
  }
  return rows;
}

/**
 * Every process whose command line contains `dir` (a substring pre-filter: callers confirm each one
 * with holdsDir), as [{ pid, ppid, processName, commandLine, createdAt }]; null when the query failed.
 */
async function dirHolders(dir) {
  if (process.platform === 'win32') {
    const r = await ps1(`ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.ToLower().Contains('${lit(winDir(dir))}') } | Select-Object ${WIN_FIELDS})`);
    if (r.err) return null;
    try {
      const j = JSON.parse(r.stdout);
      return (Array.isArray(j) ? j : [j]).filter(Boolean).map(fromWin);
    } catch { return null; }
  }
  const r = await runFull('ps', ['-A', '-ww', '-o', 'pid=,ppid=,args=']);
  if (r.err) return null;
  const key = String(dir).toLowerCase();
  return parsePsTable(r.stdout).filter((p) => p.commandLine.toLowerCase().includes(key));
}

/**
 * End one browser process, re-checking in the same call that it is still the process identified
 * earlier: same pid AND same createdAt, a browser's name, its command line naming `dir`. On Windows
 * the check and the kill run in ONE PowerShell call, so a pid reused in between cannot be hit.
 * Its child processes are ended too, but only those with the same exe name whose command line
 * names `dir` (the browser's own helpers): anything else it started, such as a PDF viewer opened
 * from a download, is left alone. Never a tree kill.
 * Resolves 'killed' | 'gone' (no such process) | 'mismatch' (the pid is someone else now) | 'unknown'.
 */
async function killVerified({ pid, createdAt, dir }) {
  if (!Number.isInteger(pid) || pid <= 0 || !createdAt) return 'mismatch';
  if (process.platform === 'win32') {
    const script = [
      "$ErrorActionPreference = 'Stop'",
      'try {',
      `  $p = Get-CimInstance Win32_Process -Filter "ProcessId=${pid}"`,
      "  if (-not $p) { 'gone'; exit 0 }",
      `  $d = '${lit(winDir(dir))}'`,
      `  if ($p.CreationDate.ToUniversalTime().ToString('o') -ne '${lit(createdAt)}') { 'mismatch'; exit 0 }`,
      `  if (-not ($p.Name -match '${BROWSER_NAME_PS}') -or -not $p.CommandLine -or -not $p.CommandLine.ToLower().Contains($d)) { 'mismatch'; exit 0 }`,
      `  $kids = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=${pid}" | Where-Object { $_.Name -eq $p.Name -and $_.CommandLine -and $_.CommandLine.ToLower().Contains($d) })`,
      `  try { Stop-Process -Id ${pid} -Force } catch { if (Get-Process -Id ${pid} -ErrorAction SilentlyContinue) { 'unknown' } else { 'gone' }; exit 0 }`,
      '  foreach ($k in $kids) { try { Stop-Process -Id $k.ProcessId -Force } catch { } }',
      "  'killed'",
      "} catch { 'unknown' }",
    ].join('\n');
    const r = await ps1(script);
    const out = r.stdout.trim().split(/\r?\n/).pop();
    return ['killed', 'gone', 'mismatch'].includes(out) ? out : 'unknown';
  }
  // macOS / Linux: no single-call check-and-kill; check, then SIGTERM the main pid only.
  const info = await processInfo(pid);
  if (info === null) return 'gone';
  if (info.unknown) return 'unknown';
  if (info.createdAt !== createdAt || !new RegExp(BROWSER_NAME_PS, 'i').test(info.processName || '')
    || !String(info.commandLine || '').toLowerCase().includes(String(dir).toLowerCase())) return 'mismatch';
  try { process.kill(pid, 'SIGTERM'); return 'killed'; } catch { return 'gone'; }
}

module.exports = { UNKNOWN, describePid, processInfo, parsePsTable, dirHolders, killVerified };
