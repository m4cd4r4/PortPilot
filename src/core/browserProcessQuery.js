/**
 * Operating-system process queries for browser profiles: what a pid is, which processes have a
 * profile folder open, and a kill that re-checks the process's identity in the same call.
 *
 * Windows uses CIM through one PowerShell call per query; macOS and Linux use ps. A query that
 * fails, times out or returns something unreadable is UNKNOWN, never "no such process" and never
 * "nothing holds the folder": a slow query must not read as "the browser exited", and nothing is
 * ever killed on UNKNOWN.
 *
 * Identity is (pid, createdAt). A pid can be reused after its process exits; the pair cannot.
 * createdAt is the process's start time as the OS reports it (Windows CreationDate in UTC ISO form,
 * ps lstart elsewhere), compared as an opaque string.
 *
 * Values that come from outside (a profile folder, a start time) never go into PowerShell script
 * text: they travel in environment variables (PP_DIR, PP_AT) and the script reads $env:. Quoting
 * them is not enough: PowerShell also ends a '...' string at U+2018-U+201B (F73).
 */
const path = require('path');
const { execFile } = require('child_process');

const UNKNOWN = Object.freeze({ unknown: true });
// One list for both sides. macOS names: "Google Chrome", "Microsoft Edge", "Brave Browser".
const BROWSER_NAMES = 'chrome|chromium|msedge|microsoft edge|brave|opera|vivaldi|browser';
const BROWSER_NAME_RE = new RegExp(BROWSER_NAMES, 'i');

const QUERY_OPTS = { encoding: 'utf8', timeout: 5000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 };
/** { err, code, stdout } of a command; never throws. */
const runFull = (file, args, env) => new Promise((resolve) => {
  execFile(file, args, { ...QUERY_OPTS, ...(env ? { env: { ...process.env, ...env } } : {}) },
    (err, stdout) => resolve({ err, code: err ? err.code : 0, stdout: stdout || '' }));
});
// UTF-8 out, so a non-ASCII folder or command line is not read back as '?' (F74).
// Any error stops the script and exits 1, so a failed CIM query never prints an empty answer (F75).
const ps1 = (body, env) => runFull('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
  `[Console]::OutputEncoding = [Text.Encoding]::UTF8; $ErrorActionPreference = 'Stop'; try {\n${body}\n} catch { exit 1 }`], env);
const winDir = (dir) => String(dir).replace(/\//g, '\\').toLowerCase();

// The fields every Windows query reads, CreationDate as a stable UTC string.
const WIN_FIELDS = "ProcessId,ParentProcessId,Name,CommandLine,@{n='Created';e={if ($_.CreationDate) { $_.CreationDate.ToUniversalTime().ToString('o') }}}";
const fromWin = (p) => ({ pid: p.ProcessId, ppid: p.ParentProcessId, processName: p.Name || null, commandLine: p.CommandLine || null, createdAt: p.Created || null });

/**
 * Windows: the processes a CIM pipeline yields, as rows; null when the query failed.
 * `pipeline` is fixed script text; anything variable goes in `env`.
 */
async function winList(pipeline, env) {
  const r = await ps1(`ConvertTo-Json -Compress -Depth 2 -InputObject @(${pipeline} | Select-Object ${WIN_FIELDS})`, env);
  if (r.err) return null;
  try {
    const j = JSON.parse(r.stdout);
    return (Array.isArray(j) ? j : [j]).filter(Boolean).map(fromWin);
  } catch { return null; }
}

/** { processName, commandLine } of a pid; nulls when it cannot be read. Used for port holders. */
async function describePid(pid) {
  const info = await processInfo(pid);
  return info && !info.unknown ? { processName: info.processName, commandLine: info.commandLine } : { processName: null, commandLine: null };
}

/** The executable's name from a ps args line: the part before the first flag or URL, so spaced names survive. */
function exeName(args) {
  const s = String(args || '').trim();
  const cut = s.search(/\s+(?=-|\w+:\/\/)/);
  return path.basename(cut === -1 ? s : s.slice(0, cut)) || null;
}

/**
 * { pid, ppid, processName, commandLine, createdAt } of a running process, null when there is no
 * such process, UNKNOWN when the query itself failed.
 */
async function processInfo(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  if (process.platform === 'win32') {
    const rows = await winList(`Get-CimInstance Win32_Process -Filter "ProcessId=${pid}"`);
    if (rows == null) return UNKNOWN;
    return rows[0] || null;
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

/**
 * Lines of `ps -A -ww -o pid=,ppid=,args=` as { pid, ppid, processName, commandLine }. Pure.
 * createdAt is null here: callers that need it ask processInfo.
 */
function parsePsTable(out) {
  const rows = [];
  for (const line of String(out || '').split(/\r?\n/)) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);
    if (!m) continue;
    rows.push({ pid: Number(m[1]), ppid: Number(m[2]), processName: exeName(m[3]), commandLine: m[3].trim(), createdAt: null });
  }
  return rows;
}

/**
 * Every process whose command line contains `dir` (a substring pre-filter: callers confirm each one
 * with holdsDir), as [{ pid, ppid, processName, commandLine, createdAt }]; null when the query failed.
 */
async function dirHolders(dir) {
  if (process.platform === 'win32') {
    return winList('Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.ToLowerInvariant().Contains($env:PP_DIR) }',
      { PP_DIR: winDir(dir) });
  }
  const r = await runFull('ps', ['-A', '-ww', '-o', 'pid=,ppid=,args=']);
  if (r.err) return null;
  const key = String(dir).toLowerCase();
  return parsePsTable(r.stdout).filter((p) => p.commandLine.toLowerCase().includes(key));
}

/** What a failed or successful process.kill means: only "no such process" is 'gone' (F76). */
const signalResult = (err) => (!err ? 'killed' : err.code === 'ESRCH' ? 'gone' : 'unknown');

/**
 * End one browser process, re-checking in the same call that it is still the process identified
 * earlier: same pid AND same createdAt, a browser's name, its command line naming `dir`, and with
 * `main` (Stop, a timed-out Start) not a helper (--type=). On Windows the check and the kill run in
 * ONE PowerShell call: this narrows the window in which a reused pid could be hit to a few
 * milliseconds; it does not close it.
 * Its child processes are ended too, but only those with the same exe name whose command line
 * names `dir` (the browser's own helpers): anything else it started, such as a PDF viewer opened
 * from a download, is left alone. Never a tree kill.
 * Resolves 'killed' | 'gone' (no such process) | 'mismatch' (the pid is someone else now) | 'unknown'.
 */
async function killVerified({ pid, createdAt, dir, main = false }) {
  if (!Number.isInteger(pid) || pid <= 0 || !createdAt) return 'mismatch';
  if (process.platform === 'win32') {
    const script = [
      `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${pid}"`,
      "if (-not $p) { 'gone'; exit 0 }",
      '$d = $env:PP_DIR',
      "if ($p.CreationDate.ToUniversalTime().ToString('o') -ne $env:PP_AT) { 'mismatch'; exit 0 }",
      `if (-not ($p.Name -match '${BROWSER_NAMES}') -or -not $p.CommandLine -or -not $p.CommandLine.ToLowerInvariant().Contains($d)) { 'mismatch'; exit 0 }`,
      main ? "if ($p.CommandLine -match '--type=') { 'mismatch'; exit 0 }" : '',
      `$kids = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=${pid}" | Where-Object { $_.Name -eq $p.Name -and $_.CommandLine -and $_.CommandLine.ToLowerInvariant().Contains($d) })`,
      `try { Stop-Process -Id ${pid} -Force } catch { if (Get-Process -Id ${pid} -ErrorAction SilentlyContinue) { 'unknown' } else { 'gone' }; exit 0 }`,
      'foreach ($k in $kids) { try { Stop-Process -Id $k.ProcessId -Force } catch { } }',
      "'killed'",
    ].join('\n');
    const r = await ps1(script, { PP_DIR: winDir(dir), PP_AT: String(createdAt) });
    const out = r.stdout.trim().split(/\r?\n/).pop();
    return ['killed', 'gone', 'mismatch'].includes(out) ? out : 'unknown';
  }
  // macOS / Linux: no single-call check-and-kill; check, then SIGTERM the main pid only.
  const info = await processInfo(pid);
  if (info === null) return 'gone';
  if (info.unknown) return 'unknown';
  if (info.createdAt !== createdAt || !BROWSER_NAME_RE.test(info.processName || '')
    || !String(info.commandLine || '').toLowerCase().includes(String(dir).toLowerCase())
    || (main && /--type=/i.test(info.commandLine || ''))) return 'mismatch';
  try { process.kill(pid, 'SIGTERM'); return 'killed'; } catch (err) { return signalResult(err); }
}

module.exports = { UNKNOWN, BROWSER_NAME_RE, describePid, processInfo, parsePsTable, dirHolders, killVerified, winList, signalResult, exeName };
