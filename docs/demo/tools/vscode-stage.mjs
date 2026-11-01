// Stages a fake PortPilot machine for the VS Code extension, from the fictional demo apps the
// desktop mockups use (PP_STAGE_SEED=real switches to demo-seed.js), so the extension can be
// photographed without touching real data:
//
//   node vscode-stage.mjs serve  <work>   write config + history, shim netstat/tasklist/powershell,
//                                         run the fake debug-port servers, stay alive until stopped
//   node vscode-stage.mjs launch <work>   open a throwaway Extension Development Host on it
//   node vscode-stage.mjs crash  <work>   stamp 550-au as crashed (the extension toasts it)
//
// The extension reads <APPDATA>/portpilot/*, runs `netstat`/`tasklist`/`powershell` through the
// shell, and probes each browser profile's debug port over HTTP. The host is launched with
// APPDATA pointed at <work>/appdata and a PATH whose first entry holds .cmd stand-ins for those
// three tools, so nothing real is listed. Debug ports 9232, 9233 and 9237 are the only real sockets.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const [cmd, workArg] = process.argv.slice(2);
if (!cmd || !workArg) { console.error('usage: vscode-stage.mjs serve|launch|crash <work>'); process.exit(2); }
const W = path.resolve(workArg);
const CONFIG_DIR = path.join(W, 'appdata', 'portpilot');
const SHIM = path.join(W, 'shim');
const CDP_PORT = 9345; // the EDH window's own remote-debugging port, used to photograph it
const STRIPE_PORT = 9237; // stands in for the seed's :9231 so a real Brave on his pool is never probed

const profileDir = (name) => path.join(W, 'profiles', name);
const write = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data); };

// The six fictional apps the desktop mockups use (docs/demo/fictional/shots.js), with a real
// 480x270 capture of each demo page as its thumbnail. Marlowe Studio stays stopped.
const FICTIONAL = [
  { site: 'shop', name: 'Fernlane Goods', group: 'work', port: 3101, up: 41 * 60 },
  { site: 'blog', name: 'Quill & Ink', group: 'personal', port: 3102, up: 2 * 3600 + 14 * 60 },
  { site: 'dashboard', name: 'Tidewatch', group: 'work', port: 3103, up: 18 * 60 },
  { site: 'docs', name: 'Lumen Docs', group: 'work', port: 3104, up: 52 * 60 },
  { site: 'chat', name: 'Chatterbox', group: 'personal', port: 3105, up: 5 * 3600 + 22 * 60 },
  { site: 'portfolio', name: 'Marlowe Studio', group: 'personal', port: 3106, up: 0 },
];

async function captureThumbs() {
  const { createRequire } = await import('node:module');
  let chromium;
  for (const base of [REPO, 'I:/Scratch/PortPilot-2026']) {
    try { ({ chromium } = createRequire(path.join(base, 'package.json'))('playwright')); break; } catch { /* try the next checkout */ }
  }
  if (!chromium) throw new Error('playwright not found; run npm install in the repo (or the main checkout)');
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe' });
  const out = {};
  try {
    // 1280x720 at 0.75 scale is 960x540, sharper than the 480x270 the desktop stores and still under the thumb cap.
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 0.75 });
    for (const f of FICTIONAL) {
      await page.goto(pathToFileURL(path.join(HERE, '..', 'fictional', 'sites', f.site, 'index.html')).href);
      await page.waitForTimeout(400);
      const buf = await page.screenshot({ type: 'jpeg', quality: 80 });
      out[f.site] = `data:image/jpeg;base64,${buf.toString('base64')}`;
    }
  } finally { await browser.close(); }
  return out;
}

async function loadFictionalSeed() {
  const shots = await captureThumbs();
  const now = Date.now();
  const ago = (sec) => new Date(now - sec * 1000).toISOString();
  const slug = (n) => n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const apps = FICTIONAL.map((f) => ({
    id: `app_${f.site}`, name: f.name, command: `npm run dev -- --port ${f.port}`, cwd: `C:/dev/${slug(f.name)}`, preferredPort: f.port, group: f.group,
    fallbackRange: null, env: {}, autoStart: false, isFavorite: false, description: null, startupDelay: null, parentId: null, branch: null,
    worktreePath: null, colorSource: null, color: '#7dcfff', healthPath: null, reservePort: false, createdAt: now, updatedAt: now,
  }));
  const groups = [{ id: 'work', name: 'Work', color: '#7aa2f7', expanded: true }, { id: 'personal', name: 'Personal', color: '#9ece6a', expanded: true }];
  const live = FICTIONAL.filter((f) => f.up);
  const pidOf = (f) => 4100 + FICTIONAL.indexOf(f) * 37;
  const runtime = Object.fromEntries(live.map((f) => [`app_${f.site}`, { startedBy: { kind: 'human', surface: 'desktop', at: ago(f.up) }, pid: pidOf(f), port: f.port }]));
  const ports = live.map((f) => ({ port: f.port, pid: pidOf(f), processName: 'node.exe', commandLine: 'node next dev', address: '127.0.0.1', appId: `app_${f.site}` }));
  const runs = FICTIONAL.map((f, i) => ({
    id: `r_fic${i + 1}`, appId: `app_${f.site}`, appName: f.name, cwd: `C:/dev/${slug(f.name)}`, command: `npm run dev -- --port ${f.port}`, port: f.port,
    repoRoot: `C:/dev/${slug(f.name)}`, relCwd: '', url: `http://localhost:${f.port}/`, startedBy: { kind: 'human', surface: 'desktop', at: ago(f.up || 3 * 3600) },
    startedAt: ago(f.up || 3 * 3600), stoppedAt: f.up ? null : ago(2 * 3600), endedBy: f.up ? null : 'stop', exitCode: null, pinned: false,
    git: { branch: 'main', sha: `${(0xa1b2c3 + i * 0x111111).toString(16)}0d4e5f`.slice(0, 12), subject: 'chore: tidy', dirty: false, files: [], snapshot: null, skipped: null },
    page: { title: f.name, thumb: `thumbs/r_fic${i + 1}.jpg` },
  }));
  const thumbs = Object.fromEntries(FICTIONAL.map((f, i) => [`r_fic${i + 1}`, shots[f.site]]));
  const tab = (title, url) => ({ id: 't0', title, url });
  const browsers = [
    { name: 'Work', port: 9232, mode: 'headed', state: 'up', purpose: 'Client dashboards and admin', sites: ['tidewatch.example'], tabs: [tab('Tidewatch', 'https://tidewatch.example/')] },
    { name: 'Research', port: 9233, mode: 'headed', state: 'up', purpose: 'Docs, papers and reading lists', sites: ['lumen.example'], tabs: [tab('Lumen Docs', 'https://lumen.example/')] },
    { name: 'Social', port: 9234, mode: 'headed', state: 'down', purpose: 'Community and chat', sites: ['chatterbox.example'], url: 'https://chatterbox.example' },
  ];
  return { apps, groups, runtime, runs, thumbs, ports, browsers };
}

async function loadSeed() {
  return process.env.PP_STAGE_SEED === 'real' ? loadRealSeed() : loadFictionalSeed();
}

async function loadRealSeed() {
  const sandbox = { window: {}, setTimeout, Promise, Date, Math, Object, Array, JSON, URLSearchParams, console };
  vm.runInNewContext(fs.readFileSync(path.join(HERE, '..', 'demo-seed.js'), 'utf8'), sandbox);
  const pp = sandbox.window.portpilot;
  const apps = (await pp.config.getApps()).apps;
  const groups = (await pp.config.getGroups()).groups;
  const proc = await pp.process.list();
  const runs = (await pp.history.list()).runs;
  const thumbs = (await pp.history.thumbs(runs.map((r) => r.id))).thumbs;
  const ports = (await pp.ports.scan()).ports;
  const browsers = (await pp.browsers.list()).profiles;
  return { apps, groups, runtime: proc.runtime, runs, thumbs, ports, browsers };
}

async function stage() {
  const s = await loadSeed();
  const appById = new Map(s.apps.map((a) => [a.id, a]));
  const now = Date.now();

  // No crash yet: the `crash` command adds one after the window is up, so the toast fires.
  const runtime = JSON.parse(JSON.stringify(s.runtime));
  const browserProfiles = s.browsers.map((p) => ({
    name: p.name, port: p.state === 'blocked' ? STRIPE_PORT : p.port, browser: 'brave', mode: p.mode,
    url: p.url || '', note: '', purpose: p.purpose, sites: p.sites, userDataDir: profileDir(p.name),
  }));
  write(path.join(CONFIG_DIR, 'portpilot-config.json'), JSON.stringify({
    apps: s.apps, groups: s.groups, settings: { theme: 'tokyonight' }, browserProfiles,
  }, null, 2));
  write(path.join(CONFIG_DIR, 'portpilot-runtime.json'), JSON.stringify({ apps: runtime }, null, 2));

  // History: runs.json plus the same page thumbnails the desktop shows.
  const runs = s.runs.map((r) => ({
    ...r,
    startedAt: r.startedAt, stoppedAt: r.stoppedAt,
  }));
  write(path.join(CONFIG_DIR, 'history', 'runs.json'), JSON.stringify({ v: 1, runs }, null, 2));
  for (const [id, uri] of Object.entries(s.thumbs)) {
    write(path.join(CONFIG_DIR, 'history', 'thumbs', `${id}.jpg`), Buffer.from(String(uri).split(',')[1], 'base64'));
  }

  // Stand-ins for the three tools the extension shells out to. The foreign :3600 squatter is left
  // out so cosmos-collective does not read as running on it.
  const listening = s.ports.filter((p) => p.port !== 3600);
  const name = (p) => p.processName;
  const lines = listening.map((p) => `  TCP    ${p.address}:${p.port}           0.0.0.0:0              LISTENING       ${p.pid}`);
  write(path.join(SHIM, 'netstat.txt'), ['', 'Active Connections', '', '  Proto  Local Address          Foreign Address        State           PID', ...lines, ''].join('\r\n'));
  write(path.join(SHIM, 'netstat.cmd'), '@type "%~dp0netstat.txt"\r\n');
  const pids = new Map(listening.map((p) => [p.pid, name(p)]));
  write(path.join(SHIM, 'tasklist.txt'), [...pids].map(([pid, n]) => `"${n}","${pid}","Console","1","40,000 K"`).join('\r\n') + '\r\n');
  write(path.join(SHIM, 'tasklist.cmd'), '@type "%~dp0tasklist.txt"\r\n');
  const cmdLine = (p) => {
    const app = p.appId && appById.get(p.appId);
    if (!app) return p.commandLine || '';
    return p.commandLine.includes('agent') ? `node ${app.cwd}/src/agent/server.js` : `node ${app.cwd}/node_modules/next/dist/bin/next dev`;
  };
  write(path.join(SHIM, 'ps.json'), JSON.stringify(listening.map((p) => ({ ProcessId: p.pid, CommandLine: cmdLine(p) }))));
  write(path.join(SHIM, 'powershell.cmd'), '@type "%~dp0ps.json"\r\n');

  // Editor state: Dark Modern like the existing shots, nothing that opens by itself.
  write(path.join(W, 'ud', 'User', 'settings.json'), JSON.stringify({
    'workbench.startupEditor': 'none', 'workbench.colorTheme': 'Default Dark Modern', 'window.commandCenter': false,
    'telemetry.telemetryLevel': 'off', 'update.mode': 'none', 'extensions.autoUpdate': false, 'extensions.autoCheckUpdates': false,
    'workbench.tips.enabled': false, 'security.workspace.trust.enabled': false, 'chat.commandCenter.enabled': false,
    'workbench.layoutControl.enabled': false, 'editor.minimap.enabled': false, 'window.zoomLevel': 0,
  }, null, 2));
  fs.mkdirSync(path.join(W, 'sample'), { recursive: true });
  return { s, browserProfiles };
}

function listen(port, handler) {
  return new Promise((resolve, reject) => {
    const srv = http.createServer(handler);
    srv.once('error', reject);
    srv.listen(port, '127.0.0.1', () => resolve(srv));
  });
}

const cdp = (port, tabs) => listen(port, (req, res) => {
  res.setHeader('content-type', 'application/json');
  if (req.url === '/json/version') return res.end(JSON.stringify({ Browser: 'Chrome/130.0.0.0', 'Protocol-Version': '1.3' }));
  if (req.url === '/json' || req.url === '/json/list') {
    return res.end(JSON.stringify(tabs.map((t, i) => ({ id: `${port}-tab${i}`, type: 'page', title: t.title, url: t.url, webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/${i}` }))));
  }
  res.statusCode = 404; res.end('{}');
});

async function serve() {
  const { s } = await stage();
  const servers = [];
  // The core calls a port "held" unless its listener is a browser process started with that profile's
  // own --user-data-dir, so each fake debug port runs in a copy of node named brave.exe with the flag.
  const bin = path.join(W, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const fakeBrave = path.join(bin, 'brave.exe');
  fs.copyFileSync(process.execPath, fakeBrave);
  const kids = [];
  for (const p of s.browsers) {
    if (p.state !== 'up') continue;
    const tabsFile = path.join(bin, `tabs-${p.port}.json`);
    write(tabsFile, JSON.stringify(p.tabs));
    kids.push(spawn(fakeBrave, [fileURLToPath(import.meta.url), 'cdp', tabsFile, String(p.port), `--user-data-dir=${profileDir(p.name)}`], { stdio: 'ignore', windowsHide: true }));
  }
  process.on('exit', () => kids.forEach((k) => k.kill()));
  // The held port: something answers, but it is not a browser.
  servers.push(await listen(STRIPE_PORT, (req, res) => { res.setHeader('content-type', 'text/plain'); res.statusCode = 404; res.end('not found'); }));
  console.log(`staged in ${W}; fake debug ports up: ${s.browsers.filter((p) => p.state === 'up').map((p) => p.port).concat(STRIPE_PORT).join(', ')}. Ctrl+C to stop.`);
  process.on('SIGINT', () => process.exit(0));
  setInterval(() => {}, 1 << 30);
}

async function fakeBrowser() {
  // argv: cdp <tabsFile> <port> --user-data-dir=...
  const [, , , tabsFile, port] = process.argv;
  await cdp(Number(port), JSON.parse(fs.readFileSync(tabsFile, 'utf8')));
  setInterval(() => {}, 1 << 30);
}

function crash() {
  const file = path.join(CONFIG_DIR, 'portpilot-runtime.json');
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  j.apps.a_metrics = {
    startedBy: { kind: 'claude', surface: 'mcp', sessionId: 'b71c9e04-demo', label: 'pearl lighting', at: new Date(Date.now() - 30 * 60000).toISOString() },
    pid: 4420, port: 3210,
    crashed: {
      exitCode: 1, at: Date.now(), port: 3210,
      startedBy: { kind: 'claude', surface: 'mcp', sessionId: 'b71c9e04-demo', label: 'pearl lighting', at: new Date(Date.now() - 30 * 60000).toISOString() },
      errorTail: 'error when starting dev server:\nError: Port 3210 is already in use',
    },
  };
  fs.writeFileSync(file, JSON.stringify(j, null, 2));
  console.log('stamped 550-au as crashed');
}

function launch() {
  const codeExe = path.join(process.env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe');
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/^(ELECTRON_|VSCODE_)/i.test(k)) continue;
    env[k] = v;
  }
  env.APPDATA = path.join(W, 'appdata');
  env.PATH = `${SHIM};${env.PATH || env.Path}`;
  delete env.Path;
  env.CLAUDE_CONFIG_DIR = path.join(W, 'claude-config');
  const args = [
    `--user-data-dir=${path.join(W, 'ud')}`, `--extensions-dir=${path.join(W, 'ext')}`,
    `--extensionDevelopmentPath=${path.join(REPO, 'vscode-extension')}`,
    `--remote-debugging-port=${CDP_PORT}`, '--new-window', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes',
    path.join(W, 'sample'),
  ];
  const out = fs.openSync(path.join(W, 'edh.log'), 'a');
  const child = spawn(codeExe, args, { env, detached: true, stdio: ['ignore', out, out] });
  child.unref();
  console.log(`launched EDH pid ${child.pid}; photograph it over CDP on ${CDP_PORT}`);
}

if (cmd === 'serve') await serve();
else if (cmd === 'launch') launch();
else if (cmd === 'crash') crash();
else if (cmd === 'cdp') await fakeBrowser();
else { console.error('unknown command'); process.exit(2); }
