// Stages a fake PortPilot machine for the VS Code extension, from the same demo seed the
// desktop screenshots use, so the extension can be photographed without touching real data:
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
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const [cmd, workArg] = process.argv.slice(2);
if (!cmd || !workArg) { console.error('usage: vscode-stage.mjs serve|launch|crash <work>'); process.exit(2); }
const W = path.resolve(workArg);
const CONFIG_DIR = path.join(W, 'appdata', 'portpilot');
const SHIM = path.join(W, 'shim');
const CDP_PORT = 9345; // the EDH window's own remote-debugging port, used to photograph it
const STRIPE_PORT = 9237; // stands in for the seed's :9231 so a real Brave on his pool is never probed

const write = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data); };

async function loadSeed() {
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
    url: p.url || '', note: '', purpose: p.purpose, sites: p.sites,
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

async function serve() {
  const { s } = await stage();
  const servers = [];
  const cdp = (port, tabs) => listen(port, (req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/json/version') return res.end(JSON.stringify({ Browser: 'Chrome/130.0.0.0', 'Protocol-Version': '1.3' }));
    if (req.url === '/json' || req.url === '/json/list') {
      return res.end(JSON.stringify(tabs.map((t, i) => ({ id: `${port}-tab${i}`, type: 'page', title: t.title, url: t.url, webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/${i}` }))));
    }
    res.statusCode = 404; res.end('{}');
  });
  for (const p of s.browsers) {
    if (p.state === 'up') servers.push(await cdp(p.port, p.tabs));
  }
  // The held port: something answers, but it is not a browser.
  servers.push(await listen(STRIPE_PORT, (req, res) => { res.setHeader('content-type', 'text/plain'); res.statusCode = 404; res.end('not found'); }));
  console.log(`staged in ${W}; fake debug ports up: ${servers.map((x) => x.address().port).join(', ')}. Ctrl+C to stop.`);
  process.on('SIGINT', () => process.exit(0));
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
else { console.error('unknown command'); process.exit(2); }
