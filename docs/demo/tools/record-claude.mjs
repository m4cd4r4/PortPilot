// Usage: node record-claude.mjs [guard|browser]
// Terminal clips of the Claude Code surface. Every line of PortPilot text is the real plugin output: the guard
// verdict comes from guard-core on the demo seed, and the browser result is a real start_browser call to the
// bundled MCP server (real-browser-call.mjs). Only the terminal frame and Claude's own wording are drawn here,
// so these are rendered terminal clips, not captures of the Claude Code app.
// Writes docs/media/claude-guard.webp and docs/media/claude-browser.webp.
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { launch, loadSeed, repo } from './lib.mjs';
import { startRecording, encodeWebp, mediaDir, sleep } from './record-lib.mjs';
import { realBrowserCall } from './real-browser-call.mjs';

const which = process.argv[2] || 'all';
const core = (f) => import(pathToFileURL(path.join(repo, 'plugin', 'hooks', f)).href);

const FRAME = `<!doctype html><meta charset="utf-8"><style>
  body{margin:0;background:#1a1b26;padding:22px}
  .term{width:900px;height:340px;background:#16161e;border:1px solid #2f3549;border-radius:10px;overflow:hidden;font:15px/1.55 Consolas,'Cascadia Mono',monospace;color:#c0caf5}
  .bar{background:#24283b;color:#7a88b8;padding:8px 14px;font-size:13px}
  #b{padding:14px 18px;white-space:pre-wrap}
  .dim{color:#7a88b8}.grn{color:#9ece6a}.you{color:#7aa2f7}.tool{color:#bb9af7}.warn{color:#e0af68}.cyan{color:#7dcfff}
  .cur{display:inline-block;width:8px;height:16px;background:#c0caf5;vertical-align:-2px;animation:bl 1s steps(1) infinite}
  @keyframes bl{50%{opacity:0}}
  #cap{position:fixed;right:34px;bottom:30px;max-width:46%;padding:9px 14px;border-radius:9px;background:rgba(36,40,59,.96);border:1px solid #3b4261;color:#c0caf5;font:600 14px 'Segoe UI',sans-serif;opacity:0;transition:opacity .25s}
  #cap b{color:#7dcfff;font-family:Consolas,monospace;font-weight:600}
</style><div class="term"><div class="bar">TITLE</div><div id="b"></div></div><div id="cap"></div>`;

const wrap = (text, n = 92) => text.replace(new RegExp(`(.{1,${n}})(\\s|$)`, 'g'), '$1\n').trimEnd().split('\n');

async function terminal(browser, title) {
  const page = await browser.newPage({ viewport: { width: 944, height: 386 }, deviceScaleFactor: 1 });
  await page.setContent(FRAME.replace('TITLE', title));
  const api = {
    page,
    line: (cls, text) => page.evaluate(([c, t]) => { const d = document.createElement('div'); d.className = c; d.textContent = t || '\u00a0'; document.getElementById('b').append(d); }, [cls, text]),
    type: (cls, text, ms = 28) => page.evaluate(async ([c, t, ms]) => {
      const d = document.createElement('div'); d.className = c;
      const cur = document.createElement('span'); cur.className = 'cur';
      document.getElementById('b').append(d); d.append(cur);
      for (const ch of t) { cur.before(ch); await new Promise((r) => setTimeout(r, ms)); }
      cur.remove();
    }, [cls, text, ms]),
    cap: (html) => page.evaluate((h) => { const e = document.getElementById('cap'); e.innerHTML = h; e.style.opacity = h ? '1' : '0'; }, html),
  };
  return api;
}

async function save(rec, name) {
  const out = await rec.stop();
  const r = encodeWebp(out, path.join(mediaDir, name), { width: 900, tail: 2200 });
  fs.rmSync(out.dir, { recursive: true, force: true });
  console.log(name, JSON.stringify(r));
}

const browser = await launch();

if (which === 'all' || which === 'guard') {
  const guard = await core('guard-core.mjs');
  const pp = loadSeed();
  const { apps } = await pp.config.getApps();
  const { ports } = await pp.ports.scan();
  const { runtime } = await pp.process.list();
  const config = { apps };
  const rt = { apps: runtime };
  const listeners = new Map(ports.map((p) => [p.port, { pid: p.pid, processName: p.processName }]));
  const command = 'pnpm dev';
  const verdict = guard.decide({ start: guard.parseStart(command), dir: guard.startDir('C:/dev', 'examworthy', { windows: true }), config, runtime: rt, listeners, windows: true });
  if (verdict.action !== 'deny') throw new Error('guard did not deny: ' + JSON.stringify(verdict));

  const t = await terminal(browser, 'claude  ~/dev/examworthy');
  const rec = startRecording(t.page);
  await sleep(700);
  await t.type('you', '> start the dev server');
  await sleep(500);
  await t.line('', '');
  await t.line('tool', `* Bash(${command})`);
  await sleep(900);
  for (const [i, l] of wrap(verdict.reason).entries()) await t.line('warn', (i ? '    ' : '  ! ') + l);
  await t.cap('The guard turns the start away and says which copy to reuse');
  await sleep(2200);
  await t.line('', '');
  await t.type('', 'examworthy-web is already up on :3000, so I will use http://localhost:3000 and not start a second copy.', 14);
  await t.cap('No second server, no port drift, no orphan process');
  await sleep(2000);
  await save(rec, 'claude-guard.webp');
  await t.page.close();
}

if (which === 'all' || which === 'browser') {
  const { started, stopped } = await realBrowserCall();
  if (!started.success || !stopped.success) throw new Error('real browser call failed: ' + JSON.stringify({ started, stopped }));
  const t = await terminal(browser, 'claude  ~/dev/examworthy');
  const rec = startRecording(t.page);
  await sleep(700);
  await t.type('you', '> start the Google Search Console debugging browser so I can reindex some pages');
  await sleep(500);
  await t.line('', '');
  await t.line('tool', `* portpilot - start_browser (MCP)(for: ${JSON.stringify(started.matchedBy.for)})`);
  await t.cap('Claude asks by purpose. PortPilot picks the profile and supplies the port');
  await sleep(1300);
  await t.line('dim', `  matched: ${started.name}  (${started.matchedBy.reason})`);
  await sleep(500);
  await t.line('grn', `  ${started.name}  :${started.port}  ${started.state}  ${started.mode}  ${started.browser}`);
  await t.line('dim', `  cdpUrl: ${started.cdpUrl}`);
  await t.cap('A dedicated debug port: a real, visible Brave you can sign in to, and Claude can drive over CDP');
  await sleep(2600);
  await t.line('', '');
  await t.type('', `The ${started.name} profile is up on :${started.port}, headed, with its own sign-ins. Tell me which URLs to reindex.`, 14);
  await t.cap('Other sessions are told it is in use and steered to a free profile');
  await sleep(2200);
  await save(rec, 'claude-browser.webp');
  await t.page.close();
}

await browser.close();
