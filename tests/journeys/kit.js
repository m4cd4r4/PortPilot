/**
 * Journey kit: test PortPilot the way a person uses it, over several launches of the same install.
 *
 * A journey keeps ONE throwaway world (config folder, project folders) across launches, plays
 * events that change the world the way a person or another program would (start a server from a
 * terminal, crash, a stranger takes a port, quit and come back), and checks every step from
 * OUTSIDE the app: files on disk, `netstat`, an HTTP answer, the developer's real history.
 * The app's own word (a green row) is never the proof; the screen is checked as well, not instead.
 *
 * Plan and rules: docs/testing/PROJECT-PLAN.md. Every citable run goes in docs/testing/EVIDENCE-LOG.md.
 *
 * Output per run (gitignored): test-results/journeys/<name>-<stamp>/
 *   journey.jsonl  one line per step and check, with times
 *   summary.json   totals, wall time, build
 *   shots/         <checkpoint>-1440.png and -390.png; a journey is not "passing" until a person reads them
 *
 * Env: PORTPILOT_JOURNEY_KEEP=1 keeps the world folder; PORTPILOT_E2E_EXE runs against an installed build.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const h = require('../e2e-harness');

// Captured before any launch: the harness points APPDATA at the throwaway world.
const REAL_APPDATA = process.env.APPDATA || '';
const REAL_RUNS = REAL_APPDATA ? path.join(REAL_APPDATA, 'portpilot', 'history', 'runs.json') : '';

/** A project's dev server: answers a titled page; can crash after N ms with a chosen exit code. */
const SERVER_JS = `const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const port = Number(arg('--port', process.env.PORT));
const title = arg('--title', 'demo');
const crashAfter = Number(arg('--crash-after', 0));
const code = Number(arg('--exit-code', 1));
require('http').createServer((q, r) => {
  console.log(new Date().toISOString() + ' ' + q.method + ' ' + q.url); // logs per request, as dev servers do (F92)
  r.setHeader('content-type', 'text/html');
  r.end('<title>' + title + '</title><body style="background:#1d4ed8;color:#fff;font:48px sans-serif"><h1>' + title + '</h1></body>');
}).listen(port, '127.0.0.1', () => {
  if (crashAfter > 0) setTimeout(() => { console.error(title + ' crashed on purpose'); process.exit(code); }, crashAfter);
});
`;

const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
const readJson = (p, fallback) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } };
const realRuns = () => { const r = readJson(REAL_RUNS, []); return Array.isArray(r) ? r : (r.runs || []); };

/** PIDs listening on a TCP port, read from the OS (a bind probe reads every port as free on Windows). */
function listeners(port) {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('netstat', ['-ano'], { encoding: 'utf8', windowsHide: true });
      const pids = new Set();
      for (const line of out.split(/\r?\n/)) {
        const m = /^\s*TCP\s+(\S+)\s+\S+\s+LISTENING\s+(\d+)/i.exec(line);
        if (m && new RegExp(`:${port}$`).test(m[1])) pids.add(Number(m[2]));
      }
      return [...pids];
    }
    const out = execFileSync('ss', ['-ltnpH', `sport = :${port}`], { encoding: 'utf8' });
    return [...out.matchAll(/pid=(\d+)/g)].map((m) => Number(m[1]));
  } catch { return []; }
}

/** What answers on a port: { status, title } or null. */
async function answers(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2000) });
    const body = await r.text();
    return { status: r.status, title: (/<title>([^<]*)<\/title>/i.exec(body) || [])[1] || '' };
  } catch { return null; }
}

function killTree(pid) {
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    else process.kill(pid, 'SIGKILL');
  } catch { /* already gone */ }
}

/** PIDs whose command line names the world folder: an Electron a failed launch never handed back, its helpers. */
function worldProcesses(dir, exeName = '') {
  if (process.platform !== 'win32') return [];
  try {
    const only = exeName ? ` -and $_.Name -eq '${exeName.replace(/'/g, "''")}'` : '';
    const ps = `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.ToLower().Contains('${dir.toLowerCase().replace(/'/g, "''")}') -and $_.ProcessId -ne ${process.pid} -and $_.ProcessId -ne $PID -and -not $_.CommandLine.Contains('Get-CimInstance')${only} } | ForEach-Object { $_.ProcessId }`;
    return execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { encoding: 'utf8', windowsHide: true }).split(/\s+/).filter(Boolean).map(Number);
  } catch { return []; }
}

/** "name: start of its command line" for a stray, so the record says what outlived the journey. */
function describe(pid) {
  if (process.platform !== 'win32') return '';
  try {
    const ps = `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}"; if ($p) { "$($p.Name): $($p.CommandLine)" }`;
    return `(${execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { encoding: 'utf8', windowsHide: true }).trim().slice(0, 200)})`;
  } catch { return ''; }
}

/** A comparable folder key: real path, forward slashes, lower case (runs.json stores I:/x, os.tmpdir() may be 8.3 and backslashed). */
function dirKey(p) {
  let r = String(p || '');
  try { r = fs.realpathSync.native(r); } catch { /* gone or not a path */ }
  return r.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function gitHead() {
  try { return h.git(h.root, 'rev-parse', '--short', 'HEAD'); } catch { return 'unknown'; }
}

/**
 * Start a journey. ports: how many free ports to reserve for its servers.
 * Returns the journey object; call j.run(steps) then nothing else (it exits the process).
 */
async function journey(name, { ports: nPorts = 4, detectIntervalMs = 1000 } = {}) {
  const t0 = Date.now();
  const out = path.join(h.root, 'test-results', 'journeys', `${name}-${stamp()}`);
  fs.mkdirSync(path.join(out, 'shots'), { recursive: true });
  const logPath = path.join(out, 'journey.jsonl');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `pp-journey-${name}-`));
  const configDir = path.join(tmp, 'portpilot');
  fs.mkdirSync(configDir, { recursive: true });
  const tmpKey = dirKey(tmp);
  const appExe = path.basename(process.env.PORTPILOT_E2E_EXE || require('electron'));
  const ports = await h.freePorts(nPorts);
  // Positive control: "port free" checks mean nothing if listeners() cannot see a port we know is held
  // (a netstat in another language, a failed spawn).
  const probe = h.holdPort(ports[0]);
  const seen = await (async () => { for (let i = 0; i < 40; i++) { if (listeners(ports[0]).includes(probe.pid)) return true; await h.sleep(100); } return false; })();
  probe.kill();
  for (let i = 0; i < 40 && listeners(ports[0]).length; i++) await h.sleep(100);
  if (!seen) throw new Error(`listeners() cannot see a port held by this test (:${ports[0]}); every "port free" check would pass vacuously`);
  // The watcher looks at the journey's ports only (never the developer's servers), and fast.
  process.env.PORTPILOT_DETECT_ONLY_PORTS = ports.join(',');
  process.env.PORTPILOT_DETECT_INTERVAL_MS = String(detectIntervalMs);

  const results = [];
  const children = new Set();
  let current = null; // { app, win }
  let stepName = '';
  let launches = 0;
  const leakBefore = realRuns().length;

  const log = (rec) => fs.appendFileSync(logPath, `${JSON.stringify({ t: new Date().toISOString(), ms: Date.now() - t0, ...rec })}\n`);
  log({ kind: 'start', journey: name, build: process.env.PORTPILOT_E2E_EXE || `source ${gitHead()}`, world: tmp, ports });

  const j = {
    name, out, tmp, configDir, ports, children,
    get app() { return current && current.app; },
    get win() { return current && current.win; },

    // ---- records ----------------------------------------------------------
    check(what, ok, detail = '') {
      results.push({ step: stepName, name: what, ok: !!ok });
      log({ kind: 'check', step: stepName, name: what, ok: !!ok, detail: String(detail).slice(0, 500) });
      console.log(`  ${ok ? 'PASS' : 'FAIL'} ${what}${detail ? ` - ${detail}` : ''}`);
      return !!ok;
    },
    note(text) { log({ kind: 'note', step: stepName, text }); console.log(`  note: ${text}`); },
    /** Poll until fn returns truthy; returns the value, or null on timeout (never throws). */
    async waitFor(fn, ms = 20000) {
      const end = Date.now() + ms;
      for (;;) {
        try { const v = await fn(); if (v) return v; } catch { /* retry */ }
        if (Date.now() > end) return null;
        await h.sleep(250);
      }
    },

    // ---- the app's life ---------------------------------------------------
    async launch({ width = 1440, height = 900 } = {}) {
      if (current) throw new Error('already running; quit first');
      current = await h.launch({ tmp, configDir }, { width, height });
      launches++;
      current.errors = [];
      current.win.on('pageerror', (e) => current && current.errors.push(e.message));
      log({ kind: 'event', step: stepName, event: 'launch', n: launches, pid: current.app.process().pid });
      await j.waitFor(() => current.win.evaluate(() => !!document.querySelector('.topbar, .sidebar')), 20000);
      return current;
    },
    /** Quit: clean (app.quit, as from the tray) or hard (the process is killed). Returns the page errors seen. */
    async quit({ hard = false } = {}) {
      if (!current) return [];
      const { app, errors } = current;
      const pid = app.process().pid;
      // Hard = the whole process tree dies at once, as in a crash or Task Manager (SIGKILL on Windows ends only the main process).
      if (hard) killTree(pid);
      else await app.evaluate(({ app: a }) => a.quit()).catch(() => {});
      let gone = await j.waitFor(() => !h.alive(pid), 15000);
      if (!gone) { await h.closeApp(app); killTree(pid); gone = await j.waitFor(() => !h.alive(pid), 5000); }
      // The main process can exit a moment before its helpers (the network utility): a quit is over when they are gone too.
      const t1 = Date.now();
      const helpersGone = !!(await j.waitFor(() => worldProcesses(tmp, appExe).length === 0, 10000));
      log({ kind: 'event', step: stepName, event: hard ? 'kill' : 'quit', pid, exited: !!gone, helpersGone, helpersMs: Date.now() - t1 });
      current = null;
      return errors;
    },
    async relaunch(opts) { await j.quit(opts); return j.launch(); },

    // ---- events from outside the app --------------------------------------
    /** A project folder with package.json and server.js. */
    project(dirName) {
      const dir = path.join(tmp, dirName);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'server.js'), SERVER_JS);
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: dirName, private: true, scripts: { dev: 'node server.js' } }, null, 2));
      return dir;
    },
    /** The command a person would register for a project's server (marked so an installed PortPilot ignores it). */
    command(port, { title, crashAfterMs = 0, exitCode = 1 } = {}) {
      return `node server.js --portpilot-test --port ${port} --title ${title}${crashAfterMs ? ` --crash-after ${crashAfterMs} --exit-code ${exitCode}` : ''}`;
    },
    /** A dev server started from a terminal, not PortPilot: absolute script path, its own cwd. */
    startServer(dirName, port, opts = {}) {
      const dir = j.project(dirName);
      const args = [path.join(dir, 'server.js'), '--portpilot-test', '--port', String(port), '--title', opts.title || dirName];
      const child = spawn(process.execPath, args, { cwd: dir, stdio: 'ignore', windowsHide: true });
      children.add(child);
      child.on('exit', () => children.delete(child));
      log({ kind: 'event', step: stepName, event: 'startServer', dir: dirName, port, pid: child.pid });
      return { child, dir, port, stop: () => j.stopChild(child) };
    },
    /** A stranger process takes a port. */
    holdPort(port) {
      const child = h.holdPort(port);
      children.add(child);
      child.on('exit', () => children.delete(child));
      log({ kind: 'event', step: stepName, event: 'holdPort', port, pid: child.pid });
      return { child, port, stop: () => j.stopChild(child) };
    },
    /**
     * Time passes while PortPilot is down: every run, browser session and crash stamp moves `days`
     * into the past (there is no fake clock in the app). Returns how many records moved.
     */
    ageHistory(days) {
      if (current) throw new Error('ageHistory runs between launches; quit first');
      const ms = days * 24 * 3600 * 1000;
      const back = (iso) => (iso ? new Date(Date.parse(iso) - ms).toISOString() : iso);
      let moved = 0;
      for (const file of ['runs.json', 'browser-runs.json']) {
        const p = path.join(configDir, 'history', file);
        const data = readJson(p, null);
        if (!data) continue;
        const list = Array.isArray(data) ? data : (data.runs || []);
        for (const r of list) { for (const k of ['startedAt', 'stoppedAt', 'sampledAt']) if (r[k]) r[k] = back(r[k]); moved++; }
        fs.writeFileSync(p, JSON.stringify(data));
      }
      const rtPath = path.join(configDir, 'portpilot-runtime.json');
      const rt = readJson(rtPath, null);
      if (rt && rt.apps) {
        for (const a of Object.values(rt.apps)) if (a && a.crashed && Number.isFinite(a.crashed.at)) { a.crashed.at -= ms; moved++; }
        fs.writeFileSync(rtPath, JSON.stringify(rt, null, 2));
      }
      log({ kind: 'event', step: stepName, event: 'ageHistory', days, moved });
      return moved;
    },
    async stopChild(child) {
      if (!child || child.exitCode !== null) return;
      child.kill();
      await j.waitFor(() => child.exitCode !== null || child.signalCode !== null, 5000);
      log({ kind: 'event', step: stepName, event: 'stopChild', pid: child.pid });
    },

    // ---- outside checks ---------------------------------------------------
    config: () => readJson(path.join(configDir, 'portpilot-config.json'), null),
    /** The runtime sidecar: who started each app, and the crash stamp a dead one leaves. */
    runtime: () => readJson(path.join(configDir, 'portpilot-runtime.json'), { apps: {} }).apps || {},
    /** The visible alerts bell's count, '' when it shows none (the sidebar and the narrow top bar each carry one). */
    bellCount: () => current.win.locator('.bell-count:visible').first().textContent({ timeout: 500 }).catch(() => ''),
    runs: () => { const r = readJson(path.join(configDir, 'history', 'runs.json'), []); return Array.isArray(r) ? r : (r.runs || []); },
    listeners,
    answers,
    /** Waits for the port to have no listener; true if it went quiet. */
    portFree: async (port, ms = 10000) => !!(await j.waitFor(() => listeners(port).length === 0, ms)),

    // ---- the screen -------------------------------------------------------
    async tab(label) {
      const w = current.win;
      // Under More (Scenes, History) the tab is a menu item.
      const direct = w.locator(`role=tab[name="${label}"]`);
      if (await direct.count()) await direct.click();
      else {
        await w.click('role=button[name="More"]').catch(() => {});
        await w.click(`role=menuitem[name="${label}"]`).catch(() => w.click(`text="${label}"`));
      }
    },
    card: (id) => current.win.locator(`.card[data-app="${id}"]`),
    stateOf: (id) => current.win.locator(`.card[data-app="${id}"]`).getAttribute('data-state').catch(() => null),
    /** Screenshots at 1440 and 390, then back to 1440. */
    async shot(checkpoint) {
      const w = current.win;
      for (const width of [1440, 390]) {
        await w.setViewportSize({ width, height: width === 390 ? 844 : 900 });
        await w.waitForTimeout(300);
        const file = path.join(out, 'shots', `${checkpoint}-${width}.png`);
        await w.screenshot({ path: file });
      }
      await w.setViewportSize({ width: 1440, height: 900 });
      log({ kind: 'shot', step: stepName, checkpoint });
    },
    /** Blur whatever has focus: real keystrokes from the desktop can reach a focused test window. */
    blur: () => current.win.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur()),

    // ---- running it -------------------------------------------------------
    /**
     * Run the steps in order. A failed check is recorded and the journey goes on; a step that throws
     * (a timeout, a missing element) stops the journey, since the world is then in an unknown state.
     */
    async run(steps) {
      let aborted = null;
      for (const [label, fn] of steps) {
        stepName = label;
        const s0 = Date.now();
        console.log(`\nstep: ${label}`);
        log({ kind: 'step', step: label });
        try { await fn(j); } catch (e) {
          aborted = { step: label, error: e.message };
          j.check(`step completes: ${label}`, false, e.message);
          break;
        } finally { log({ kind: 'step-end', step: label, durationMs: Date.now() - s0 }); }
      }
      stepName = 'teardown';
      const errors = await j.quit().catch(() => []);
      if (errors.length) j.check('no page errors in the last session', false, errors.join(' | '));
      for (const c of [...children]) await j.stopChild(c);
      // Stragglers: an Electron a failed launch never handed back, or a server PortPilot started that
      // outlived a quit. The world folder and the ports belong to this journey alone. A journey port still
      // held right after quit is a stray at once. Electron's helpers (a renderer) can outlive the main
      // process by ~10 s on a busy machine, so world processes get up to 20 s, timed and recorded.
      const portHolders = ports.flatMap((p) => listeners(p));
      const w0 = Date.now();
      const worldClear = await j.waitFor(() => worldProcesses(tmp).length === 0, 20000);
      j.note(worldClear ? `world clear after ${((Date.now() - w0) / 1000).toFixed(1)} s` : 'world not clear after 20 s');
      const strays = [...new Set([...portHolders, ...worldProcesses(tmp)])];
      if (strays.length) {
        j.check('nothing outlives the journey', false, `killed ${strays.map((p) => `${p} ${describe(p)}`).join(', ')}`);
        strays.forEach(killTree);
      }

      // Leakage: the developer's real history gains nothing from this journey. Other runs may appear
      // (a real PortPilot keeps recording the developer's own servers); only ours count.
      const since = new Date(t0).toISOString();
      const ours = realRuns().filter((r) => r && r.startedAt >= since && (ports.includes(Number(r.port)) || (r.cwd && `${dirKey(r.cwd)}/`.startsWith(`${tmpKey}/`))));
      j.check('the real PortPilot history gained no runs from this journey', ours.length === 0, `${ours.length} of ours; real total ${leakBefore} -> ${realRuns().length}`);

      const failed = results.filter((r) => !r.ok);
      const summary = {
        journey: name, build: process.env.PORTPILOT_E2E_EXE || `source ${gitHead()}`, startedAt: new Date(t0).toISOString(),
        wallMs: Date.now() - t0, launches, checks: results.length, passed: results.length - failed.length, failed: failed.length,
        aborted, failures: failed, out,
      };
      fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2));
      log({ kind: 'end', ...summary, failures: undefined });
      console.log(`\n${summary.passed}/${summary.checks} checks passed${aborted ? `, stopped at "${aborted.step}"` : ''}; wall ${(summary.wallMs / 1000).toFixed(1)} s`);
      console.log(`record: ${out}`);
      if (!process.env.PORTPILOT_JOURNEY_KEEP) { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* a server may still hold a file */ } }
      process.exit(failed.length ? 1 : 0);
    },
  };
  return j;
}

module.exports = { journey, listeners, answers, worldProcesses, SERVER_JS, REAL_RUNS };
