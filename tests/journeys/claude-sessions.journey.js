/**
 * Journey B: two Claude sessions share one PortPilot.
 * Run: npm run build:ui && node tests/journeys/claude-sessions.journey.js   (skips without Brave)
 *
 * Two sessions are simulated the way the plugin makes them real: a heartbeat file each in the
 * world's sessions/ folder, and MCP calls over the desktop's own MCP HTTP endpoint (the port the
 * harness hands it in PORTPILOT_MCP_PORT). Session A asks for a browser by the site it is for and
 * gets the profile whose start URL fits -> session B asks for the same profile by a word in its note
 * and is refused with IN_USE -> A goes quiet (stale heartbeat) and B gets the same running browser
 * -> B starts an app (runs.json stamps it "claude <B>") -> B stops the browser and Browsers history
 * reads "started by claude <A>".
 *
 * Proof is read from outside: Brave's own /json and /json/version on the profile's debug port, the
 * process holding that port (brave.exe, the world's profile folder), the claims file, sessions/,
 * history/runs.json, history/browser-runs.json, the app's own HTTP answer, and the rendered screen.
 * An MCP reply saying "started" is never the proof. Brave runs headless with throwaway profiles in
 * the journey's world, on ports from the OS: never the developer's profiles or 9222-9241.
 */
const { journey, listeners } = require('./kit');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { execFileSync } = require('child_process');
const h = require('../e2e-harness');

const BRAVE = 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe';
// Captured before any launch: the harness points APPDATA at the throwaway world.
const REAL_DIR = process.env.APPDATA ? path.join(process.env.APPDATA, 'portpilot') : '';

// Two sessions, as the plugin names them (UUIDs); the short tag is the first four alphanumerics.
const A = 'a7e1c0de-1111-4a00-9000-000000000001';
const B = 'b42f9e0d-2222-4b00-9000-000000000002';
const short = (id) => id.replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toLowerCase();

const readJson = (p, fallback) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } };

/**
 * One POST on a fresh connection. With fetch (kept-alive sockets) 3 of 6 runs died on ECONNRESET
 * while the MCP server stayed up, each after a few idle seconds: most likely a socket reused as the
 * server's 5 s keep-alive timer closed it. None since each request has its own connection.
 */
function post(port, headers, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/mcp', method: 'POST', agent: false, headers: { ...headers, 'content-length': Buffer.byteLength(body) }, timeout: 90000 }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { text += d; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on('timeout', () => req.destroy(new Error('no answer in 90 s')));
    req.on('error', reject);
    req.end(body);
  });
}

/** One MCP client over Streamable HTTP, as Claude Code is one: its own MCP session. */
async function mcpClient(port) {
  let sid = null;
  let id = 0;
  async function rpc(method, params, notify = false) {
    const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
    if (sid) headers['mcp-session-id'] = sid;
    const body = notify ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id: ++id, method, params };
    const r = await post(port, headers, JSON.stringify(body))
      .catch((e) => { throw new Error(`MCP ${method} ${params && params.name ? params.name : ''} on :${port}: ${e.message}; listeners now ${listeners(port).join('/') || 'none'}`); });
    sid = r.headers['mcp-session-id'] || sid;
    const text = r.text;
    if (notify) return null;
    if (r.status < 200 || r.status > 299) throw new Error(`MCP ${method}: HTTP ${r.status} ${text.slice(0, 200)}`);
    const msgs = /text\/event-stream/.test(r.headers['content-type'] || '')
      ? text.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => JSON.parse(l.slice(5)))
      : [JSON.parse(text)];
    const msg = msgs.find((m) => m.id === body.id);
    if (!msg) throw new Error(`MCP ${method}: no answer in ${text.slice(0, 200)}`);
    if (msg.error) throw new Error(`MCP ${method}: ${msg.error.message}`);
    return msg.result;
  }
  const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-code', version: 'journey' } });
  await rpc('notifications/initialized', {}, true);
  return {
    init,
    get sid() { return sid; },
    list: async () => (await rpc('tools/list', {})).tools.map((t) => t.name),
    async tool(name, args) {
      const res = await rpc('tools/call', { name, arguments: args });
      const text = (res.content && res.content[0] && res.content[0].text) || '';
      let parsed = text;
      try { parsed = JSON.parse(text); } catch { /* plain text answer */ }
      return { isError: !!res.isError, body: parsed };
    },
  };
}

/** What Brave says about itself on a debug port: { version, pages } or null. */
async function brave(port) {
  try {
    const version = await (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(2000) })).json();
    const pages = (await (await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(2000) })).json()).filter((t) => t.type === 'page');
    return { version, pages };
  } catch { return null; }
}

/** The OS's own record of a process: { exe, cmd } or null. */
function processInfo(pid) {
  try {
    const ps = `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}"; if ($p) { $p.ExecutablePath; '|||'; $p.CommandLine }`;
    const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { encoding: 'utf8', windowsHide: true });
    if (!out.trim()) return null;
    const [exe, cmd] = out.split('|||').map((s) => s.trim());
    return { exe, cmd };
  } catch { return null; }
}

/**
 * PIDs of brave.exe processes opened on a profile folder. Brave's crash reporter (crashpad-handler)
 * is left out unless asked for: it can stay on the folder a minute or more after the browser has gone.
 */
function braveOn(dir, { crashpad = false } = {}) {
  try {
    const key = dir.toLowerCase().replace(/'/g, "''");
    const skip = crashpad ? '' : " -and -not $_.CommandLine.Contains('--type=crashpad-handler')";
    const ps = `Get-CimInstance Win32_Process -Filter "Name='brave.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.ToLower().Contains('${key}')${skip} } | ForEach-Object { $_.ProcessId }`;
    return execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { encoding: 'utf8', windowsHide: true }).split(/\s+/).filter(Boolean).map(Number);
  } catch { return []; }
}

/** The developer's real ports: their MCP server and their browser profiles. Never the journey's. */
const devPort = (p) => !(p > 0) || p === 8788 || (p >= 9222 && p <= 9241);

/** PIDs of Brave main (browser) processes on a profile folder: no --type= helper. */
function braveMain(dir) {
  try {
    const key = dir.toLowerCase().replace(/'/g, "''");
    const ps = `Get-CimInstance Win32_Process -Filter "Name='brave.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.ToLower().Contains('${key}') -and -not $_.CommandLine.Contains('--type=') } | ForEach-Object { $_.ProcessId }`;
    return execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { encoding: 'utf8', windowsHide: true }).split(/\s+/).filter(Boolean).map(Number);
  } catch { return []; }
}

/** "pid name" of every process whose command line names the world folder. */
function worldProcs(dir) {
  try {
    const key = dir.toLowerCase().replace(/'/g, "''");
    const ps = `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.ToLower().Contains('${key}') -and -not $_.CommandLine.Contains('Get-CimInstance') } | ForEach-Object { "$($_.ProcessId) $($_.Name)" }`;
    return execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { encoding: 'utf8', windowsHide: true }).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  } catch { return []; }
}

(async () => {
  if (!fs.existsSync(path.join(h.root, 'src', 'ui-dist', 'index.html'))) throw new Error('src/ui-dist is missing; run "npm run build:ui" first');
  if (!fs.existsSync(BRAVE)) { console.log('SKIP claude-sessions journey: Brave is not installed'); process.exit(0); }
  // The watcher at its shipped interval (10 s). At the kit's 1 s it confirms the app's port (2 scans)
  // before start_app has stamped it (the MCP server stamps only once the port answers, ~2 s), and
  // records a second, "detected" run: a race the shipped interval cannot reach.
  // Debug ports and the shop's site come from the OS too, kept off the watcher's list (they are not
  // dev servers). Drawn and guarded before the world exists; the kit's own ports are guarded once it hands them over.
  const extra = await h.freePorts(3);
  if (extra.some(devPort)) throw new Error(`the OS handed out a port the developer uses (${extra.join(', ')}); run again`);
  const j = await journey('claude-sessions', { ports: 2, detectIntervalMs: 10000 });
  const [apiPort, webPort] = j.ports;
  const all = [...j.ports, ...extra];
  if (all.some(devPort) || new Set(all).size !== all.length) {
    try { fs.rmSync(j.tmp, { recursive: true, force: true }); } catch { /* nothing started in it yet */ }
    throw new Error(`a journey port is the developer's or is repeated (${all.join(', ')}); run again`);
  }
  const [shopDebug, blogDebug, sitePort] = extra;

  // The shop's admin site, so the profile's start page is a real page Brave can name.
  const site = http.createServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end(`<title>Orders</title><h1>Orders ${q.url}</h1>`); });
  await new Promise((r) => site.listen(sitePort, '127.0.0.1', r));
  const shopUrl = `http://127.0.0.1:${sitePort}/admin/orders`;

  // The world a person set up before the sessions arrive: two apps (api is started by a Claude session, web by the person), two browser profiles.
  const apiDir = j.project('api');
  const webDir = j.project('web');
  const cfgPath = path.join(j.configDir, 'portpilot-config.json');
  fs.writeFileSync(cfgPath, JSON.stringify({
    groups: [], settings: {},
    apps: [{ id: 'app_journey_api', name: 'api', cwd: apiDir, command: j.command(apiPort, { title: 'Api' }), preferredPort: apiPort, group: null, isFavorite: false, createdAt: new Date().toISOString() },
      { id: 'app_journey_web', name: 'web', cwd: webDir, command: j.command(webPort, { title: 'Web' }), preferredPort: webPort, group: null, isFavorite: false, createdAt: new Date().toISOString() }],
    browserProfiles: [
      { name: 'shop-admin', port: shopDebug, browser: 'brave', mode: 'headless', url: shopUrl, note: 'orders and refunds' },
      { name: 'blog-editor', port: blogDebug, browser: 'brave', mode: 'headless', url: 'about:blank', note: 'drafts and comments' },
    ],
  }, null, 2));
  const shopDir = path.join(j.configDir, 'browser-profiles', 'shop-admin');
  const claimsPath = path.join(j.configDir, 'portpilot-browser-claims.json');
  const claims = () => (readJson(claimsPath, {}).profiles || {});
  const bruns = () => (readJson(path.join(j.configDir, 'history', 'browser-runs.json'), {}).runs || []);

  // Heartbeats: the plugin rewrites sessions/<id>.json every 15 s while a session lives.
  const sessionsDir = path.join(j.configDir, 'sessions');
  fs.mkdirSync(sessionsDir, { recursive: true });
  const beating = new Set([A, B]);
  const beat = (id, at = Date.now()) => fs.writeFileSync(path.join(sessionsDir, `${id}.json`), JSON.stringify({ sessionId: id, cwd: apiDir, at }));
  const ticker = setInterval(() => { for (const id of beating) beat(id); }, 10000);
  ticker.unref();
  for (const id of beating) beat(id);

  // Real data the journey must never touch.
  const realBrowserRuns = () => (readJson(path.join(REAL_DIR, 'history', 'browser-runs.json'), {}).runs || []);
  const realBefore = realBrowserRuns().length;

  let mcpPort = 0;
  let a = null;
  let b = null;
  let braveA = null; // { pid, ws } of the browser session A started
  const t0 = new Date().toISOString();

  await j.run([
    ['PortPilot opens; two Claude sessions connect over MCP', async () => {
      await j.launch();
      // The app's stderr carries the MCP server's (stdio inherit): kept in the record for diagnosis.
      const errLog = path.join(j.out, 'app-stderr.log');
      j.app.process().stderr.on('data', (d) => fs.appendFileSync(errLog, `${new Date().toISOString()} ${d}`));
      mcpPort = Number(await j.app.evaluate(() => process.env.PORTPILOT_MCP_PORT));
      // Never talk MCP to the developer's real PortPilot: stop here, before any connection.
      if (devPort(mcpPort)) throw new Error(`the desktop's MCP port is not the journey's own (:${mcpPort}); refusing to connect`);
      j.check('the desktop was handed its own MCP port, not the real one', true, `:${mcpPort}`);
      a = await j.waitFor(() => mcpClient(mcpPort), 30000);
      b = a && await mcpClient(mcpPort);
      j.check('something listens on that port', j.listeners(mcpPort).length > 0, `:${mcpPort} pid ${j.listeners(mcpPort).join('/')}`);
      const mcpPid = j.listeners(mcpPort)[0];
      const pi = processInfo(mcpPid);
      j.note(`MCP server pid ${mcpPid}: ${pi && pi.cmd}`);
      j.check('two MCP sessions, each with its own id', a && b && a.sid && b.sid && a.sid !== b.sid);
      const tools = await a.list();
      j.check('the browser and app tools are offered', ['start_browser', 'stop_browser', 'start_app', 'stop_app', 'browser_history'].every((t) => tools.includes(t)), tools.length);
      const beats = fs.readdirSync(sessionsDir);
      j.check('sessions/ holds a heartbeat per session', beats.length === 2 && [A, B].every((id) => beats.includes(`${id}.json`)), beats.join(', '));
      j.check('no browser is up on either profile port', j.listeners(shopDebug).length === 0 && j.listeners(blogDebug).length === 0);
      const listed = await a.tool('list_browser_profiles', { sessionId: A });
      const rows = (listed.body.profiles || []).map((p) => `${p.name}:${p.state}:${p.free}`);
      j.check('both profiles read stopped and free', rows.join() === 'shop-admin:down:true,blog-editor:down:true', rows.join());
      await j.tab('Browsers');
      await j.waitFor(() => j.win.locator('.bcard[data-profile="shop-admin"]').count(), 10000);
      await j.shot('01-two-sessions');
    }],

    ['session A asks for a browser for the shop admin, by its URL', async () => {
      const r = await a.tool('start_browser', { for: `http://127.0.0.1:${sitePort}/admin/refunds?id=7`, sessionId: A });
      j.note(`start_browser said: ${JSON.stringify({ isError: r.isError, name: r.body.name, matchedBy: r.body.matchedBy, code: r.body.code })}`);
      j.check('PortPilot picked the profile whose start URL is on that site', !r.isError && r.body.name === 'shop-admin' && /start URL/.test(r.body.matchedBy?.reason || ''), r.body.matchedBy?.reason || r.body.error);
      const got = await j.waitFor(() => brave(shopDebug), 30000);
      j.check('Brave answers on the profile\'s debug port', got && got.version.webSocketDebuggerUrl, got && got.version.Browser);
      const pids = j.listeners(shopDebug);
      const info = pids.length === 1 ? processInfo(pids[0]) : null;
      j.check('the port is held by brave.exe', info && /brave\.exe$/i.test(info.exe), info && info.exe);
      j.check('opened on the profile folder inside the world', info && info.cmd.toLowerCase().includes(shopDir.toLowerCase()) && info.cmd.includes(`--remote-debugging-port=${shopDebug}`), info && info.cmd.slice(0, 300));
      const page = got && await j.waitFor(async () => (await brave(shopDebug)).pages.find((p) => p.url === shopUrl && p.title === 'Orders'), 15000);
      const now = await brave(shopDebug);
      j.check('Brave has the profile\'s start page open', page, now ? JSON.stringify(now.pages.map((p) => p.url)) : 'no answer');
      j.check('PortPilot started nothing on the other profile', j.listeners(blogDebug).length === 0);
      const c = claims()['shop-admin'];
      j.check('the claims file names session A as holder of that browser', c && c.sessionId === A && c.pid === pids[0] && !c.starting, JSON.stringify(c));
      const open = bruns().filter((e) => e.profile === 'shop-admin' && !e.stoppedAt);
      j.check('browser-runs.json opens one session, started by claude A', open.length === 1 && open[0].startedBy?.kind === 'claude' && open[0].startedBy?.sessionId === A, JSON.stringify(open.map((e) => e.startedBy)));
      braveA = { pid: pids[0], ws: got && got.version.webSocketDebuggerUrl };
      const card = j.win.locator('.bcard[data-profile="shop-admin"]');
      j.check('the Browsers card reads in use', await j.waitFor(async () => (await card.getAttribute('data-group', { timeout: 500 })) === 'inuse', 15000), await card.getAttribute('data-group', { timeout: 500 }).catch(() => 'no card'));
      const lease = await card.locator('.lease').textContent({ timeout: 500 }).catch(() => '');
      j.check(`and names who holds it (claude ${short(A)})`, lease.includes(`In use by claude ${short(A)}`), lease);
      await j.shot('02-a-holds-shop-admin');
    }],

    ['session B asks for the same profile by a word in its note: IN_USE', async () => {
      const r = await b.tool('start_browser', { for: 'refunds', sessionId: B });
      j.check('B is refused with IN_USE', r.isError && r.body.code === 'IN_USE', r.body.code || JSON.stringify(r.body).slice(0, 200));
      j.check(`and told who holds it (session ${short(A)})`, r.body.leasedTo?.session === short(A) && /shop-admin/.test(r.body.error || ''), r.body.error);
      const stop = await b.tool('stop_browser', { name: 'shop-admin', sessionId: B });
      j.check('B cannot stop it either', stop.isError && stop.body.code === 'IN_USE', stop.body.code);
      await h.sleep(1000);
      const still = await brave(shopDebug);
      j.check('the same Brave still answers: not relaunched, not stopped', still && still.version.webSocketDebuggerUrl === braveA.ws && j.listeners(shopDebug).join() === String(braveA.pid), `${j.listeners(shopDebug).join('/')}`);
      const mains = braveMain(shopDir);
      j.check('exactly one Brave browser process on the profile folder: the one A started', mains.length === 1 && mains[0] === braveA.pid, mains.join(','));
      j.check('the claim still names A', claims()['shop-admin']?.sessionId === A, JSON.stringify(claims()['shop-admin']));
      j.check('browser-runs.json still holds one session for it', bruns().filter((e) => e.profile === 'shop-admin').length === 1);
      const listed = await b.tool('list_browser_profiles', { sessionId: B });
      const row = (listed.body.profiles || []).find((p) => p.name === 'shop-admin');
      j.check('to B the profile is not free', row && row.free === false && row.leasedTo?.session === short(A), JSON.stringify(row && { free: row.free, leasedTo: row.leasedTo }));
    }],

    ['session A goes quiet: its heartbeat goes stale and the lease frees', async () => {
      beating.delete(A);
      const old = Date.now() - 60000;
      beat(A, old);
      fs.utimesSync(path.join(sessionsDir, `${A}.json`), new Date(old), new Date(old));
      j.check('A\'s heartbeat is over 45 s old on disk', Date.now() - readJson(path.join(sessionsDir, `${A}.json`), {}).at > 45000);
      const listed = await b.tool('list_browser_profiles', { sessionId: B });
      const row = (listed.body.profiles || []).find((p) => p.name === 'shop-admin');
      j.check('the profile reads free, still running', row && row.free === true && !row.leasedTo && row.state === 'up', JSON.stringify(row && { state: row.state, free: row.free, leasedTo: row.leasedTo }));
      const r = await b.tool('start_browser', { for: 'refunds', sessionId: B });
      j.check('B now gets shop-admin', !r.isError && r.body.name === 'shop-admin', r.body.code || r.body.name);
      const got = await brave(shopDebug);
      j.check('it is the same running Brave (same debugger socket, same pid): nothing relaunched', got && got.version.webSocketDebuggerUrl === braveA.ws && j.listeners(shopDebug).join() === String(braveA.pid), got && got.version.webSocketDebuggerUrl);
      const c = claims()['shop-admin'];
      j.check('the claims file passes the browser to B', c && c.sessionId === B && c.pid === braveA.pid, JSON.stringify(c));
      const all = bruns().filter((e) => e.profile === 'shop-admin');
      j.check('browser-runs.json keeps one open session, still started by A', all.length === 1 && !all[0].stoppedAt && all[0].startedBy?.sessionId === A, JSON.stringify(all.map((e) => ({ by: e.startedBy?.sessionId, stoppedAt: e.stoppedAt }))));
      const card = j.win.locator('.bcard[data-profile="shop-admin"]');
      const lease = await j.waitFor(async () => { const t = await card.locator('.lease').textContent({ timeout: 500 }).catch(() => ''); return t.includes(`claude ${short(B)}`) && t; }, 15000);
      j.check(`the Browsers card now names claude ${short(B)}`, lease, lease || await card.locator('.lease').textContent({ timeout: 500 }).catch(() => 'no lease line'));
      await j.shot('03-b-took-over-after-a-went-quiet');
    }],

    ['session B starts the api app', async () => {
      j.check('nothing listens on api\'s port yet', j.listeners(apiPort).length === 0);
      const r = await b.tool('start_app', { identifier: 'api', sessionId: B });
      j.note(`start_app said: ${JSON.stringify(r.body).slice(0, 200)}`);
      const page = await j.waitFor(() => j.answers(apiPort), 20000);
      j.check('api answers on its port with its own page', page && page.status === 200 && page.title === 'Api', JSON.stringify(page));
      const run = await j.waitFor(() => j.runs().find((x) => x.appId === 'app_journey_api' && !x.stoppedAt), 10000);
      j.check(`runs.json stamps the run claude ${short(B)} (mcp, session B)`, run && run.startedBy?.kind === 'claude' && run.startedBy?.surface === 'mcp' && run.startedBy?.sessionId === B, JSON.stringify(run && run.startedBy));
      j.check('the runtime file says B started it', j.runtime().app_journey_api?.startedBy?.sessionId === B, JSON.stringify(j.runtime().app_journey_api));
      await h.sleep(21000); // two watcher scans: a second, "detected" run would show up now
      const runs = j.runs().filter((x) => x.appId === 'app_journey_api' || Number(x.port) === apiPort);
      j.check('and only one run: the watcher did not also record it as found running', runs.length === 1, JSON.stringify(runs.map((x) => ({ startedBy: x.startedBy?.kind, detected: x.detected }))));
      await j.tab('Apps');
      j.check('the api card reads running', await j.waitFor(async () => (await j.stateOf('app_journey_api')) === 'running', 15000), await j.stateOf('app_journey_api'));
      j.note(`api card text: ${(await j.card('app_journey_api').textContent().catch(() => '')).replace(/\s+/g, ' ')}`);
      const apiLabel = `started by claude ${short(B)}`;
      const apiCard = await j.waitFor(async () => { const t = await j.card('app_journey_api').textContent().catch(() => ''); return t.includes(apiLabel) && t; }, 15000);
      j.check(`the api card says "${apiLabel}"`, apiCard, apiCard || await j.card('app_journey_api').textContent().catch(() => 'no card'));
      // A person presses Start on web: its card and its History row must say nothing about who started it.
      await j.card('app_journey_web').getByRole('button', { name: 'Start' }).click();
      j.check('web card reads running', await j.waitFor(async () => (await j.stateOf('app_journey_web')) === 'running', 20000), await j.stateOf('app_journey_web'));
      const webRun = await j.waitFor(() => j.runs().find((x) => x.appId === 'app_journey_web' && !x.stoppedAt), 10000);
      j.check('runs.json stamps the web run as started by a person (human, desktop)', webRun && webRun.startedBy?.kind === 'human' && webRun.startedBy?.surface === 'desktop', JSON.stringify(webRun && webRun.startedBy));
      // Rendered first (running, named, with its port), then asserted: an empty card would pass "no label".
      const webCard = await j.waitFor(async () => { const t = await j.card('app_journey_web').textContent().catch(() => ''); return /running/.test(t) && /web/.test(t) && t.includes(`:${webPort}`) && t; }, 15000);
      j.check('the web card is rendered (running, named, with its port)', webCard, webCard);
      j.check('and shows no "started by" label', webCard && !/started by/i.test(webCard), webCard);
      await j.shot('04-b-started-api');
      await j.tab('History');
      const row = await j.waitFor(async () => (await j.win.locator('.run').allTextContents()).find((t) => /api/.test(t) && /running/i.test(t) && t.includes(apiLabel)), 15000);
      j.check(`App History lists the api run as running, "${apiLabel}"`, row, row || (await j.win.locator('.run').allTextContents()).join(' | '));
      j.note(`api history row text: ${row}`);
      // The row whose app name is exactly "web", rendered and running, then asserted.
      const webRows = j.win.locator('.run', { has: j.win.locator('.name', { hasText: /^web$/ }) });
      const webRow = await j.waitFor(async () => { const t = await webRows.first().textContent({ timeout: 500 }).catch(() => ''); return /running/i.test(t) && t.includes(`:${webPort}`) && t; }, 15000);
      j.check('App History lists the web run, running, with its port', webRow, webRow);
      j.check('and with no "started by" label', webRow && !/started by/i.test(webRow), webRow);
      await j.shot('05-history-apps');
      await j.tab('Apps');
      await j.card('app_journey_web').getByRole('button', { name: 'Stop' }).click();
      j.check('web stops again', await j.portFree(webPort, 15000), j.listeners(webPort).join('/'));
    }],

    ['session B stops the browser and the app; Browsers history says who', async () => {
      const r = await b.tool('stop_browser', { name: 'shop-admin', sessionId: B });
      j.check('stop_browser goes through for the holder', !r.isError, r.body.code || '');
      j.check('the debug port goes quiet', await j.portFree(shopDebug, 15000), j.listeners(shopDebug).join('/'));
      j.check('Brave no longer answers there', !(await brave(shopDebug)));
      // stop_browser waits for the Brave main process it launched, and ends it after ~5 s (F21, decided
      // 2026-11-07). Its helpers may take a moment more: measured and recorded, not a check.
      const exit = r.body.browserExit || {};
      j.check('stop_browser says the browser process is gone (exited or killed)', exit.pid === braveA.pid && ['exited', 'killed'].includes(exit.how), JSON.stringify(r.body.browserExit));
      j.check('the main browser it launched is gone when stop_browser returns', !braveMain(shopDir).includes(braveA.pid), braveMain(shopDir).join(','));
      j.note(`stop_browser: the browser process ${exit.how} ${((exit.ms || 0) / 1000).toFixed(1)} s after the port went quiet`);
      const left = braveOn(shopDir);
      j.note(`Brave processes on the profile folder when stop_browser returned: ${left.length ? left.join(',') : 'none'}${left.includes(braveA.pid) ? ' (the main browser it launched among them)' : ''}`);
      const s0 = Date.now();
      const gone = await j.waitFor(() => braveOn(shopDir).length === 0, 60000);
      j.note(gone ? `the last Brave browser process on the folder exited ${((Date.now() - s0) / 1000).toFixed(1)} s after stop_browser returned`
        : `still on the folder 60 s after stop_browser returned: ${braveOn(shopDir).map((p) => `${p}${p === braveA.pid ? ' (main)' : ''}`).join(',')}`);
      j.check('the claims file drops the profile', !claims()['shop-admin'], JSON.stringify(claims()));
      const e = bruns().find((x) => x.profile === 'shop-admin');
      j.check('browser-runs.json closes the session, ended by B', e && e.stoppedAt && e.endedBy?.sessionId === B, JSON.stringify(e && { stoppedAt: e.stoppedAt, endedBy: e.endedBy }));
      j.check('with the start page among its tabs', e && (e.tabs || []).some((t) => t.url === shopUrl), JSON.stringify(e && e.tabs));
      const stopApp = await b.tool('stop_app', { identifier: 'api', sessionId: B });
      j.check('api\'s port goes quiet after stop_app', await j.portFree(apiPort, 15000), JSON.stringify(stopApp.body).slice(0, 200));
      const run = await j.waitFor(() => j.runs().find((x) => x.appId === 'app_journey_api' && x.startedBy?.sessionId === B && x.stoppedAt), 15000);
      j.check('runs.json closes B\'s api run as stopped', run && run.endedBy === 'stop', run && run.endedBy);
      j.check('and no api run is left open', !j.runs().some((x) => x.appId === 'app_journey_api' && !x.stoppedAt));

      await j.tab('History');
      await j.win.getByRole('button', { name: 'Browsers', exact: true }).click();
      const li = j.win.locator(`li[data-session="${e && e.id}"]`);
      const sub = await j.waitFor(() => li.locator('.sub').first().textContent({ timeout: 500 }), 15000);
      j.check(`Browsers history reads "started by claude ${short(A)}"`, (sub || '').includes(`started by claude ${short(A)}`), sub);
      j.check(`and "stopped by claude ${short(B)}"`, (sub || '').includes(`stopped by claude ${short(B)}`), sub);
      const tabs = await li.locator('.tabs-line').textContent().catch(() => '');
      j.check('with the Orders tab', /Orders/.test(tabs), tabs);
      await j.shot('06-browser-history');
      await j.win.getByRole('button', { name: 'Apps', exact: true }).click();
    }],

    ['session B changes its mind: stop, then start the same profile at once', async () => {
      // stop_browser waits for the main browser process; start_browser checks nothing holds the folder first.
      const r1 = await b.tool('start_browser', { name: 'shop-admin', sessionId: B });
      j.check('start_browser succeeds', !r1.isError, r1.body.code || '');
      const up = await j.waitFor(() => brave(shopDebug), 30000);
      j.check('Brave answers on the debug port', up, r1.body.error || '');
      const pid1 = j.listeners(shopDebug)[0];
      const stop = await b.tool('stop_browser', { name: 'shop-admin', sessionId: B });
      const lingering = braveOn(shopDir);
      j.note(`stop_browser returned with ${lingering.length} Brave processes still on the folder${lingering.includes(pid1) ? ', the main browser among them' : ''}; it said ${JSON.stringify(stop.body.browserExit)}`);
      j.check('the stopped main browser is not among them', !lingering.includes(pid1), lingering.join(','));
      const r2 = await b.tool('start_browser', { name: 'shop-admin', sessionId: B });
      j.note(`start_browser right after the stop said: ${JSON.stringify({ isError: r2.isError, code: r2.body.code, error: r2.body.error, already: r2.body.already }).slice(0, 300)}`);
      const again = await j.waitFor(() => brave(shopDebug), 30000);
      j.check('a start right after a stop brings Brave back on the debug port', !stop.isError && again && !r2.isError, again ? `pid ${j.listeners(shopDebug).join('/')} (was ${pid1})` : r2.body.error);
      j.check('a new browser, not the one that was stopped', again && j.listeners(shopDebug)[0] !== pid1);
      const end = await b.tool('stop_browser', { name: 'shop-admin', sessionId: B });
      j.check('and it stops again', !end.isError && await j.portFree(shopDebug, 15000));
      const open = bruns().filter((e) => e.profile === 'shop-admin' && !e.stoppedAt);
      j.check('browser-runs.json has no session left open', open.length === 0, `${bruns().length} sessions, ${open.length} open`);
    }],

    ['nothing reached the developer\'s real PortPilot', async () => {
      beating.clear();
      clearInterval(ticker);
      // Positive control: with no real PortPilot folder to read, every "gained nothing" below would pass vacuously.
      if (!REAL_DIR || !fs.existsSync(REAL_DIR)) {
        j.note(`SKIP real-data leakage checks: no real PortPilot folder (${REAL_DIR || 'APPDATA unset'}) on this machine`);
        site.close();
        return;
      }
      const realSessions = (() => { try { return fs.readdirSync(path.join(REAL_DIR, 'sessions')); } catch { return []; } })();
      j.check('the real sessions/ has no heartbeat of ours', ![A, B].some((id) => realSessions.includes(`${id}.json`)));
      const realClaims = Object.values(readJson(path.join(REAL_DIR, 'portpilot-browser-claims.json'), {}).profiles || {});
      j.check('the real claims file names neither session', !realClaims.some((c) => c && [A, B].includes(c.sessionId)), `${realClaims.length} real claims`);
      const ours = realBrowserRuns().filter((e) => e && e.startedAt >= t0 && ([shopDebug, blogDebug].includes(Number(e.port)) || [A, B].includes(e.startedBy?.sessionId)));
      j.check('the real browser-runs.json gained no sessions from this journey', ours.length === 0, `${ours.length} of ours; real total ${realBefore} -> ${realBrowserRuns().length}`);
      const realRuntime = readJson(path.join(REAL_DIR, 'portpilot-runtime.json'), {}).apps || {};
      j.check('the real runtime file holds no start of ours', !realRuntime.app_journey_api);
      site.close();
    }],

    ['quit PortPilot: every process it ran goes away', async () => {
      // Brave can outlive a stop (its browser and its crash reporter): give it a minute, then end what is
      // left (it runs on this world's profile folder, so it is the journey's to end) and say so.
      const s1 = Date.now();
      const braveGone = await j.waitFor(() => braveOn(shopDir, { crashpad: true }).length === 0, 60000);
      const rest = braveOn(shopDir, { crashpad: true });
      j.note(braveGone ? `the last Brave process left the profile folder ${((Date.now() - s1) / 1000).toFixed(1)} s into the wait before quit`
        : `Brave still on the profile folder after the stops plus 60 s; the journey ended it: ${rest.map((p) => `${p} ${((processInfo(p) || {}).cmd || '').includes('crashpad') ? 'crash reporter' : 'browser'}`).join(', ')}`);
      rest.forEach((p) => { try { process.kill(p); } catch { /* gone */ } });
      const mcpPid = j.listeners(mcpPort)[0];
      const errors = await j.quit();
      j.check('no page errors in the session', errors.length === 0, errors.join(' | '));
      // Electron's helpers (a renderer) can outlive the main process by a moment. Measured here, with the
      // same 20 s bound the kit's teardown sweep gives world processes before calling them strays.
      const s0 = Date.now();
      const clear = await j.waitFor(() => worldProcs(j.tmp).length === 0, 20000);
      j.note(`world processes gone ${((Date.now() - s0) / 1000).toFixed(1)} s after the main process exited`);
      j.check('no process on the world folder outlives PortPilot by more than 20 s', clear, worldProcs(j.tmp).join(' | '));
      j.check('the MCP server exited with it', !mcpPid || !h.alive(mcpPid), `pid ${mcpPid}`);
      j.check('its MCP port is free', await j.portFree(mcpPort, 10000));
    }],
  ]);
})().catch((e) => { console.error(e); process.exit(1); });
