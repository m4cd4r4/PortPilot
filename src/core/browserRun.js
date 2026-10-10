/**
 * Start, stop and status for browser profiles (plan row 26, slice 1).
 *
 * A profile is "up" when a browser launched with this profile's user-data-dir
 * holds its port and answers CDP. A port held by anything else is "blocked":
 * the profile reports a warning and is never started over it, and nothing is
 * ever killed except a browser this profile's own user-data-dir identifies.
 *
 * Side effects (spawn, port inspection, kill, CDP, clock) go through `deps` so
 * tests run with a fake spawner and a fake CDP endpoint. Zero dependencies.
 */
const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');
const cdp = require('./browserCdp');
const { detectBrowsers, BROWSERS } = require('./browserDetect');
const { getProfile, userDataDirFor, MODES } = require('./browserProfiles');
const { describeConflict } = require('./conflict');

const OFFSCREEN_LEFT = -2400;
const START_TIMEOUT_MS = 10000;
const GRACE_MS = 6000;
const KILL_MS = 5000;

class RunError extends Error {
  constructor(code, message, extra = {}) { super(message); this.name = 'RunError'; this.code = code; Object.assign(this, extra); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const run = (file, args) => new Promise((resolve) => {
  execFile(file, args, { encoding: 'utf8', timeout: 5000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
    (err, stdout) => resolve(err ? null : stdout));
});

// ---- Who holds a port --------------------------------------------------------
// The pid comes from the LISTENING socket, never from a process-name match.

/**
 * Pid of the TCP listener on `port` in `netstat -ano` output (IPv4 and IPv6 rows both appear).
 * A listener is a row whose foreign address is the all-zero wildcard, not the word LISTENING,
 * which Windows translates (ABHOEREN on German systems).
 */
function parseNetstat(out, port) {
  for (const line of String(out || '').split(/\r?\n/)) {
    const m = line.match(/^\s*TCP\s+(\S+):(\d+)\s+(\S+):(\d+)\s+(?:\S+\s+)?(\d+)\s*$/i);
    if (m && Number(m[2]) === port && Number(m[4]) === 0 && /^(0\.0\.0\.0|\[::\]|\*)$/.test(m[3])) return Number(m[5]);
  }
  return null;
}

async function listenerPid(port) {
  if (process.platform === 'win32') return parseNetstat(await run('netstat', ['-ano']), port);
  const lsof = await run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fp']);
  const p = (lsof || '').match(/^p(\d+)/m);
  if (p) return Number(p[1]);
  const ss = await run('ss', ['-ltnpH', `sport = :${port}`]);
  const s = (ss || '').match(/pid=(\d+)/);
  return s ? Number(s[1]) : null;
}

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

/** { pid, processName, commandLine } of whatever listens on `port`, or null. */
async function inspectPort(port) {
  const pid = await listenerPid(port);
  if (pid == null) return null;
  return { pid, ...(await describePid(pid)) };
}

function killPid(pid) {
  if (process.platform === 'win32') return run('taskkill', ['/PID', String(pid), '/T', '/F']);
  try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
  return Promise.resolve();
}

const defaultDeps = () => ({
  spawn, inspectPort, kill: killPid, sleep, detect: () => detectBrowsers(),
  version: cdp.version, pageTabs: cdp.pageTabs, closeBrowser: cdp.closeBrowser, park: cdp.parkOffscreen,
});

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
    if (/^\/?"?(\s+(-|https?:|file:|about:)|\s*$)/.test(tail)) return true;
  }
  return false;
}

// ---- Status and the reservation warning --------------------------------------

function reservationWarning(profile, holder) {
  const h = holder || {};
  const { sentence } = describeConflict({ port: profile.port, holder: h, app: { name: profile.name } });
  return {
    kind: 'browser-port-held',
    profile: profile.name,
    port: profile.port,
    holder: { pid: h.pid ?? null, processName: h.processName || null },
    sentence: `${sentence}; browser profile "${profile.name}" reserves it`,
  };
}

/**
 * Where a profile stands. state: 'down' | 'up' | 'blocked'.
 *   up       our browser holds the port (owner 'profile'), or CDP answers and the holder
 *            cannot be identified (owner 'unverified': never stopped by PID)
 *   blocked  another process holds the port: `warning` names it, nothing is touched
 */
async function profileStatus(configPath, profile, d = defaultDeps()) {
  const dir = userDataDirFor(configPath, profile);
  const base = { name: profile.name, port: profile.port, browser: profile.browser, mode: profile.mode };
  const holder = await d.inspectPort(profile.port);
  const v = await d.version(profile.port);
  const up = async (owner) => ({
    ...base, state: 'up', owner, pid: holder ? holder.pid : null,
    browserVersion: v ? v.Browser || null : null, tabs: v ? await d.pageTabs(profile.port) : [],
  });
  if (holder && holdsDir(holder, dir)) return up('profile');
  if (holder && holder.commandLine) {
    return { ...base, state: 'blocked', pid: holder.pid, tabs: [], warning: reservationWarning(profile, holder) };
  }
  if (v) return up('unverified');
  if (holder) return { ...base, state: 'blocked', pid: holder.pid, tabs: [], warning: reservationWarning(profile, holder) };
  return { ...base, state: 'down', pid: null, tabs: [] };
}

/** Status of every profile, plus a flat list of reservation warnings. */
async function allStatus(configPath, profiles, d = defaultDeps()) {
  const rows = [];
  for (const p of profiles) rows.push(await profileStatus(configPath, p, d));
  return { rows, warnings: rows.filter((r) => r.warning).map((r) => r.warning) };
}

// ---- Start -------------------------------------------------------------------

/** Launch arguments for a profile. Pure; the mode flags are the only per-mode difference. */
function buildArgs(profile, mode, dir, { offscreenLeft = OFFSCREEN_LEFT } = {}) {
  const args = [
    `--remote-debugging-port=${profile.port}`,
    `--user-data-dir=${dir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-crash-restore-bubble',
  ];
  if (profile.browser === 'brave') args.push('--disable-features=BraveRewards,BraveWallet');
  if (mode === 'headless') args.push('--headless=new');
  if (mode === 'offscreen') args.push(`--window-position=${offscreenLeft},0`);
  args.push('--', profile.url || 'about:blank'); // "--": the URL is never read as a switch
  return args;
}

// A browser stopped by PID or crash leaves exit_type "Crashed", so the next launch would restore
// the old tabs next to the start URL. Automation profiles gain nothing from restore: delete the
// session files while the browser is down (measured on Brave; Preferences edits do not stick).
function clearSessions(dir) {
  const sessions = path.join(dir, 'Default', 'Sessions');
  let names = [];
  try { names = fs.readdirSync(sessions); } catch { return; }
  for (const f of names) {
    try { fs.rmSync(path.join(sessions, f), { force: true }); } catch { /* held open */ }
  }
}

/**
 * Start a profile. Resolves with its status plus { already, offscreen? }.
 * Rejects with RunError: PORT_HELD (holder named, never killed), BROWSER_NOT_FOUND,
 * LAUNCH_FAILED, START_TIMEOUT.
 * @param {object} [o] { mode, timeoutMs, pollMs }
 */
async function startProfile(configPath, name, o = {}, d = defaultDeps()) {
  const profile = getProfile(configPath, name);
  const mode = o.mode || profile.mode;
  if (!MODES.includes(mode)) throw new RunError('BAD_MODE', `mode must be one of: ${MODES.join(', ')}`);

  const before = await profileStatus(configPath, profile, d);
  if (before.state === 'up' && before.owner === 'profile') return { ...before, already: true };
  if (before.state === 'up') {
    throw new RunError('NOT_VERIFIED', `:${profile.port} answers CDP but its owner cannot be identified, so it is not treated as profile "${profile.name}". Close it or pick another port.`);
  }
  if (before.state === 'blocked') {
    throw new RunError('PORT_HELD', `${before.warning.sentence}. Not started; nothing was killed.`,
      { holder: before.warning.holder, warning: before.warning });
  }

  const exe = d.detect().find((b) => b.id === profile.browser);
  if (!exe) {
    const label = (BROWSERS.find((b) => b.id === profile.browser) || {}).label || profile.browser;
    const have = d.detect().map((b) => b.id).join(', ') || 'none';
    throw new RunError('BROWSER_NOT_FOUND', `${label} is not installed (installed: ${have}). Change the profile's browser.`);
  }

  const dir = userDataDirFor(configPath, profile);
  fs.mkdirSync(dir, { recursive: true });
  clearSessions(dir);

  let spawnError = null;
  const child = d.spawn(exe.path, buildArgs(profile, mode, dir), {
    detached: true, stdio: 'ignore', windowsHide: mode === 'headless',
  });
  if (child && child.on) child.on('error', (err) => { spawnError = err; });
  if (child && child.unref) child.unref();

  const timeoutMs = o.timeoutMs || START_TIMEOUT_MS;
  const pollMs = o.pollMs || 250;
  let v = null;
  for (let waited = 0; !v && !spawnError && waited < timeoutMs; waited += pollMs) {
    await d.sleep(pollMs);
    v = await d.version(profile.port);
  }
  if (spawnError) throw new RunError('LAUNCH_FAILED', `could not launch ${exe.path}: ${spawnError.message}`);
  if (!v) {
    // This code spawned the child, so ending it is safe; left alone it would hold the folder locked.
    if (child && child.pid) await d.kill(child.pid);
    throw new RunError('START_TIMEOUT', `${profile.name}: nothing answered CDP on :${profile.port} within ${timeoutMs} ms. ` +
      'If this user-data-dir is already open in another browser window, that window took the launch; close it and retry.');
  }

  // Something else may have taken the port while the browser was starting: report that, not success.
  // 'unverified' is accepted here only because the port was free before this launch.
  const after = await profileStatus(configPath, profile, d);
  if (after.state !== 'up') {
    throw new RunError('PORT_HELD', `${after.warning ? after.warning.sentence : `:${profile.port} is not held by this profile`}. The launch did not take the port.`,
      after.warning ? { holder: after.warning.holder, warning: after.warning } : {});
  }
  const out = { ...after, already: false };
  if (mode === 'offscreen') out.offscreen = await d.park(profile.port, OFFSCREEN_LEFT);
  return out;
}

// ---- Stop --------------------------------------------------------------------

async function waitDown(profile, d, ms, pollMs) {
  for (let waited = 0; waited < ms; waited += pollMs) {
    if (!(await d.version(profile.port)) && !(await d.inspectPort(profile.port))) return true;
    await d.sleep(pollMs);
  }
  return false;
}

/**
 * Stop a profile's browser: ask it to quit over CDP first (a clean shutdown keeps logins and
 * session state sound), then end the verified PID. Only a browser whose command line carries this
 * profile's user-data-dir is ever stopped. Rejects NOT_OURS (port held by something else),
 * NOT_VERIFIED (cannot identify the holder) or STOP_FAILED.
 * @param {object} [o] { pollMs, graceMs, killMs }
 */
async function stopProfile(configPath, name, o = {}, d = defaultDeps()) {
  const profile = getProfile(configPath, name);
  const st = await profileStatus(configPath, profile, d);
  if (st.state === 'down') return { ...st, already: true, stoppedBy: null };
  if (st.state === 'blocked') {
    throw new RunError('NOT_OURS', `${st.warning.sentence}. Not stopping a process this profile did not start.`,
      { holder: st.warning.holder, warning: st.warning });
  }
  if (st.owner !== 'profile') {
    throw new RunError('NOT_VERIFIED', `:${profile.port} answers CDP but its owner cannot be identified, so it is not stopped. Close it by hand.`);
  }

  const pollMs = o.pollMs || 250;
  await d.closeBrowser(profile.port);
  if (await waitDown(profile, d, o.graceMs ?? GRACE_MS, pollMs)) {
    return { ...(await profileStatus(configPath, profile, d)), already: false, stoppedBy: 'cdp' };
  }
  // The grace period can be long enough for the pid to be reused: re-check the listener is still
  // this profile's browser, with the same pid, immediately before ending it.
  const now = await d.inspectPort(profile.port);
  if (now && now.pid === st.pid && holdsDir(now, userDataDirFor(configPath, profile))) await d.kill(st.pid);
  if (await waitDown(profile, d, o.killMs ?? KILL_MS, pollMs)) {
    return { ...(await profileStatus(configPath, profile, d)), already: false, stoppedBy: 'pid' };
  }
  throw new RunError('STOP_FAILED', `${profile.name} (PID ${st.pid}) is still up on :${profile.port}. Close it by hand.`);
}

module.exports = {
  RunError, OFFSCREEN_LEFT, defaultDeps, inspectPort, parseNetstat, holdsDir, reservationWarning,
  profileStatus, allStatus, buildArgs, startProfile, stopProfile,
};
