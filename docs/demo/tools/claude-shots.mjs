// Usage: node claude-shots.mjs [outDir]
// The Claude Code surface: status line, guard denial, crash band and a find_run exchange.
// Every line of PortPilot text comes from the real plugin code (guard-core, crash-core) or the
// real bundled MCP server answering a real find_run call over stdio, all on the fictional demo
// seed. Only the terminal frame around it is drawn here, so these are rendered terminal images,
// not captures of the Claude Code app.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { pathToFileURL } from 'url';
import { launch, loadSeed, repo, shotsDir } from './lib.mjs';

const [out = shotsDir] = process.argv.slice(2);
const core = (f) => import(pathToFileURL(path.join(repo, 'plugin', 'hooks', f)).href);
const guard = await core('guard-core.mjs');
const crashCore = await core('crash-core.mjs');

const pp = loadSeed();
const { apps } = await pp.config.getApps();
const { ports } = await pp.ports.scan();
const { runtime } = await pp.process.list();
const SESSION = 'b71c9e04-demo';
// anchor-metrics: started by this Claude session, died with a KeyError.
runtime.a_metrics = {
  startedBy: { kind: 'claude', surface: 'mcp', sessionId: SESSION, at: new Date(Date.now() - 25 * 60000).toISOString() },
  crashed: { at: Date.now() - 4 * 60000, exitCode: 1, port: 9090, errorTail: '  File "main.py", line 42, in <module>\nKeyError: \'TIDE_DB_URL\'' },
  port: 9090,
};
const config = { apps };
const rt = { apps: runtime };
const listeners = new Map(ports.map((p) => [p.port, { pid: p.pid, processName: p.processName }]));

// ---- the real outputs ----
const status = guard.statusLine(config, rt, listeners, Date.now());
const command = 'npm run dev';
const start = guard.parseStart(command);
const dir = guard.startDir('C:/dev/harbor', 'web', { windows: true });
const verdict = guard.decide({ start, dir, config, runtime: rt, listeners, windows: true });
if (verdict.action !== 'deny') throw new Error(`guard did not deny: ${JSON.stringify(verdict)}`);
const [crash] = crashCore.sessionCrashes(config, rt, listeners, SESSION, Date.now());
if (!crash) throw new Error('no session crash found');

// ---- a real find_run over stdio against a temp config seeded from the demo runs ----
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-findrun-'));
const configPath = path.join(tmp, 'portpilot-config.json');
fs.writeFileSync(configPath, JSON.stringify({ apps, groups: [], settings: {} }));
fs.mkdirSync(path.join(tmp, 'history'));
const { runs } = await pp.history.list();
fs.writeFileSync(path.join(tmp, 'history', 'runs.json'), JSON.stringify({ v: 1, runs }));
const args = { query: 'checkout', dirty_only: true };
const result = await callTool(path.join(repo, 'plugin', 'mcp', 'portpilot-mcp.mjs'), configPath, 'find_run', args);
fs.rmSync(tmp, { recursive: true, force: true });
const found = JSON.parse(result.content[0].text);
if (!found.count) throw new Error('find_run returned nothing');

function callTool(server, cfg, name, a) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [server], { env: { ...process.env, PORTPILOT_CONFIG_PATH: cfg }, stdio: ['pipe', 'pipe', 'ignore'] });
    let buf = '';
    const send = (m) => child.stdin.write(JSON.stringify(m) + '\n');
    const timer = setTimeout(() => { child.kill(); reject(new Error('find_run timed out')); }, 15000);
    child.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const msg = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
        if (msg.id === 1) { send({ jsonrpc: '2.0', method: 'notifications/initialized' }); send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: a } }); }
        if (msg.id === 2) { clearTimeout(timer); child.kill(); msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result); }
      }
    });
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'surface-shots', version: '1' } } });
  });
}

// ---- render ----
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const row = (cls, text) => `<div class="${cls}">${esc(text) || '&nbsp;'}</div>`;
const frame = (title, body) => `<!doctype html><meta charset="utf-8"><style>
  body{margin:0;background:#1a1b26;padding:28px}
  .term{width:920px;background:#16161e;border:1px solid #2f3549;border-radius:10px;overflow:hidden;white-space:pre-wrap;font:15px/1.55 Consolas,'Cascadia Mono',monospace;color:#c0caf5}
  .bar{background:#24283b;color:#7a88b8;padding:8px 14px;font-size:13px}
  .body{padding:14px 18px}
  .dim{color:#7a88b8}.red{color:#f7768e;font-weight:700}.grn{color:#9ece6a}.you{color:#7aa2f7}.tool{color:#bb9af7}.warn{color:#e0af68}
  .btn{display:inline-block;border:1px solid #3b4261;border-radius:5px;padding:0 10px;margin-right:8px;color:#c0caf5}
  .btn.p{background:#7aa2f7;border-color:#7aa2f7;color:#16161e;font-weight:700}
  .sep{border-top:1px solid #2f3549;margin:10px 0}
</style><div class="term"><div class="bar">${esc(title)}</div><div class="body">${body}</div></div>`;

const wrap = (text, n = 96) => text.replace(new RegExp(`(.{1,${n}})(\\s|$)`, 'g'), '$1\n').trimEnd().split('\n');
const shots = {
  'claude-statusline': frame('claude  ~/dev/harbor/web', [
    row('dim', '> reuse the server that is already up'), row('', ''), row('dim', '  ...'), row('sep', ''), row('grn', status)].join('')),
  'claude-guard': frame('claude  ~/dev/harbor/web', [
    row('you', `> start the dev server`), row('', ''),
    row('tool', `* Bash(${command})`),
    ...wrap(verdict.reason).map((l, i) => row('warn', (i ? '    ' : '  ! ') + l))].join('')),
  'claude-crash-band': frame('claude  ~/dev/tools/metrics', [
    row('dim', '  ...'), row('sep', ''),
    row('red', crashCore.crashHeadline(crash)), row('dim', '  ' + crashCore.lastLine(crash.errorTail)),
    '<div style="margin-top:6px"><span class="btn p">Fix it</span><span class="btn">Restart</span><span class="btn">Logs</span><span class="btn">Dismiss</span></div>'].join('')),
};
const f = found.runs[0];
shots['claude-find-run'] = frame('claude  ~/dev/harbor/web', [
  row('you', '> bring back the checkout page from this morning'), row('', ''),
  row('tool', `* portpilot - find_run (MCP)(${Object.entries(args).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ')})`),
  row('dim', `  ${found.count} of ${found.total} run${found.total === 1 ? '' : 's'}`),
  row('', `  ${f.appName}  ${f.git.branch} @ ${f.git.sha.slice(0, 7)}  +${f.git.files.length} uncommitted: ${f.git.files.join(', ')}`),
  row('dim', '  rerun.steps:'), ...f.rerun.steps.map((s) => row('grn', `    ${s}`))].join(''));

const browser = await launch();
for (const [name, html] of Object.entries(shots)) {
  const page = await browser.newPage({ viewport: { width: 980, height: 400 }, deviceScaleFactor: 2 });
  await page.setContent(html);
  await (await page.$('.term')).screenshot({ path: path.join(out, `${name}.png`) });
  await page.close();
  console.log(name);
}
await browser.close();
console.log(JSON.stringify({ status, verdict: verdict.reason, crash: crashCore.crashHeadline(crash), steps: f.rerun.steps }, null, 1));
