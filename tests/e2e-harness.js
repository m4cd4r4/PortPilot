/**
 * Shared setup for the real-Electron desktop checks (tests/*.e2e.js).
 *
 * Everything runs against a THROWAWAY world: APPDATA and --user-data-dir point at a temp
 * dir, the MCP server gets a free port, every app/browser port comes from the OS, and
 * nothing here kills a process it did not start. Never touches the real PortPilot config
 * or ports 9222-9240.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const freePort = () => new Promise((resolve) => {
  const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});

/** n distinct free ports (the OS can hand the same one twice under a race). */
async function freePorts(n) {
  const got = new Set();
  while (got.size < n) got.add(await freePort());
  return [...got];
}

async function until(fn, ms = 20000, what = 'condition') {
  const end = Date.now() + ms;
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch { /* retry */ }
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(250);
  }
}

/** A tiny dev server: answers a titled page on --port (or $PORT). */
const SERVER = "const a = process.argv.indexOf('--port');\n"
  + "const port = a > -1 ? Number(process.argv[a + 1]) : Number(process.env.PORT);\n"
  + "require('http').createServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end('<title>Shop demo</title><body style=\"background:#1d4ed8;color:#fff;font:48px sans-serif\"><h1>Shop demo</h1></body>'); }).listen(port, '127.0.0.1');\n";

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim();

/** A temp world: config dir, config path, and a writer for the config. */
function makeWorld(prefix) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const configDir = path.join(tmp, 'portpilot');
  fs.mkdirSync(configDir, { recursive: true });
  const configPath = path.join(configDir, 'portpilot-config.json');
  return {
    tmp, configDir, configPath,
    writeConfig: (cfg) => fs.writeFileSync(configPath, JSON.stringify({ settings: {}, groups: [], apps: [], ...cfg })),
    mkdir: (name) => { const d = path.join(tmp, name); fs.mkdirSync(d, { recursive: true }); return d; },
  };
}

/** Launch the app under Playwright against the throwaway world; returns { app, win }. */
async function launch(world, { width = 1440, height = 900 } = {}) {
  process.env.APPDATA = world.tmp; // HOME/USERPROFILE stay real: Chromium crashes at launch without a profile dir
  const { _electron: electron } = require('playwright');
  const [mcpPort] = await freePorts(1);
  const app = await electron.launch({
    executablePath: require('electron'),
    // Electron resolves userData from the OS, not APPDATA, so point it at the throwaway dir explicitly.
    args: [root, `--user-data-dir=${world.configDir}`],
    cwd: root,
    // A shell started from VS Code carries ELECTRON_RUN_AS_NODE; an empty value does not clear it.
    env: {
      ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(ELECTRON_|VSCODE_)/.test(k))),
      PORTPILOT_MCP_PORT: String(mcpPort),
    },
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await win.setViewportSize({ width, height });
  const userData = await app.evaluate(({ app: a }) => a.getPath('userData'));
  assert.strictEqual(path.resolve(userData), path.resolve(world.configDir), 'app is using the throwaway dir, not the real config');
  return { app, win };
}

/** Close the app, but never wait on it for long. */
async function closeApp(app) {
  await Promise.race([app.close().catch(() => {}), sleep(8000)]);
}

/** A node process holding a port, started by the test (so killing it is the test's own business). */
function holdPort(port) {
  const child = spawn(process.execPath, ['-e', `require('http').createServer((q,r)=>r.end('held')).listen(${port},'127.0.0.1')`], { stdio: 'ignore', windowsHide: true });
  return child;
}

/** Ask a browser the test started to quit, over its own debug port. True if one answered. */
async function closeBrowserOn(port) {
  try {
    const v = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    const ws = new WebSocket(v.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    ws.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
    await sleep(1500);
    return true;
  } catch { return false; }
}

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

/** Pass/fail line per check, so one run reports every failure instead of the first. */
function checker() {
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push({ name, ok: !!ok });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
  };
  const finish = () => {
    const bad = results.filter((r) => !r.ok);
    console.log(`\n${results.length - bad.length} passed, ${bad.length} failed`);
    return bad.length === 0;
  };
  return { check, finish };
}

module.exports = {
  assert, fs, os, path, root, sleep, freePort, freePorts, until, SERVER, git,
  makeWorld, launch, closeApp, holdPort, closeBrowserOn, alive, checker,
};
