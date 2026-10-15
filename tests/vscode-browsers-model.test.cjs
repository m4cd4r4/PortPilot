/**
 * VS Code Browsers view (vscode-extension/src/browserModel.ts, browserProbe.ts,
 * browsersTreeProvider.ts, browserCommands.ts): state mapping, tab list shaping and
 * cap, leased text, URL validation, failure wording; the probe and the tab actions
 * against a fake CDP server; and the provider and commands run in plain Node with a
 * stubbed `vscode` module against a throwaway config dir.
 * Never touches the real %APPDATA%/portpilot, ports 9222-9240 or a real browser:
 * every port here is an OS-assigned ephemeral one, start/stop are faked.
 * Requires the compiled modules (vscode-extension/out is committed; rebuild with
 * `npm run compile` in vscode-extension/ after editing the sources).
 * Run: node tests/vscode-browsers-model.test.cjs   (part of npm run test:unit)
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const net = require('net');
const Module = require('module');
const { execFileSync } = require('child_process');

const ext = path.join(__dirname, '..', 'vscode-extension');

// Before anything loads config.js: the extension must read a throwaway config, never the real one.
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-browsers-view-'));
process.env.APPDATA = sandbox;
process.env.HOME = sandbox;
process.env.USERPROFILE = sandbox;
const configDir = process.platform === 'win32' ? path.join(sandbox, 'portpilot')
  : process.platform === 'darwin' ? path.join(sandbox, 'Library', 'Application Support', 'portpilot')
    : path.join(sandbox, '.config', 'portpilot');
fs.mkdirSync(configDir, { recursive: true });
const configPath = path.join(configDir, 'portpilot-config.json');

// runtime/ is built (and gitignored) by copy-runtime; the provider needs it for the shared config and API.
if (!fs.existsSync(path.join(ext, 'runtime', 'core', 'browserApi.js'))) {
  execFileSync(process.execPath, [path.join(ext, 'scripts', 'copy-runtime.js')], { stdio: 'ignore' });
}

const bm = require('../vscode-extension/out/browserModel.js');
const probe = require('../vscode-extension/out/browserProbe.js');

let passed = 0;
let failed = 0;
async function t(name, fn) {
  try { await fn(); console.log('✅', name); passed++; }
  catch (e) { console.log('❌', name, '-', e.stack || e.message); failed++; }
}

// ---- fakes ----------------------------------------------------------------

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const freePort = async () => {
  const s = net.createServer();
  const port = await listen(s);
  await new Promise((r) => s.close(r));
  return port;
};

const page = (id, title, url) => ({ id, type: 'page', title, url });
/** A browser's CDP HTTP face: /json, /json/version, PUT /json/new?url, /json/activate/<id>. Records every request. */
function fakeCdp({ targets }) {
  const state = { requests: [], targets, opened: [], activated: [] };
  const server = http.createServer((req, res) => {
    state.requests.push(`${req.method} ${req.url}`);
    const send = (code, body) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };
    if (req.url === '/json' || req.url === '/json/list') return send(200, state.targets);
    if (req.url === '/json/version') return send(200, { Browser: 'Fake/1.0' });
    if (req.url.startsWith('/json/new?')) {
      if (req.method !== 'PUT') return send(405, 'Using unsafe HTTP verb GET to invoke /json/new. PUT should be used instead');
      const url = req.url.slice('/json/new?'.length);
      state.opened.push(url);
      return send(200, page(`new${state.opened.length}`, '', url));
    }
    if (req.url.startsWith('/json/activate/')) {
      const id = req.url.slice('/json/activate/'.length);
      if (!state.targets.some((x) => x.id === id)) return send(404, 'No such target id');
      state.activated.push(id);
      return send(200, 'Target activated');
    }
    return send(404, 'nope');
  });
  return { state, server };
}
/** Something that holds a port and answers HTTP, but is not a browser. */
const fakeOther = (body, type = 'text/plain') => http.createServer((req, res) => { res.setHeader('content-type', type); res.end(body); });

const cleanup = [];
const serve = async (server) => { const port = await listen(server); cleanup.push(() => new Promise((r) => { server.closeAllConnections?.(); server.close(r); })); return port; };

(async () => {
  // ================= model =================

  await t('normaliseProfiles: drops unusable entries, dedupes by name, fills defaults', () => {
    const out = bm.normaliseProfiles([
      { name: 'shop', port: 9231, browser: 'brave', mode: 'offscreen', url: 'https://a.test', note: 'n' },
      { name: 'SHOP', port: 9232 },          // same name, other case
      { name: 'low', port: 80 },              // below 1024
      { name: 'str', port: '9233' },          // not an integer
      { name: '', port: 9234 },
      { port: 9235 },
      null, 'x', 7,
      { name: 'bare', port: 9236, mode: 'weird' },
    ]);
    assert.deepEqual(out.map((p) => p.name), ['shop', 'bare']);
    assert.equal(out[1].mode, 'headed');
    assert.equal(out[1].browser, 'chrome');
    assert.deepEqual(bm.normaliseProfiles(undefined), []);
    assert.deepEqual(bm.normaliseProfiles({ name: 'x', port: 9999 }), []);
  });

  await t('shapeTabs: page targets only, titles and URLs only, capped at 30', () => {
    const raw = [
      ...Array.from({ length: 40 }, (_, i) => ({ ...page(`id${i}`, `T${i}`, `https://x.test/${i}`), webSocketDebuggerUrl: 'ws://secret', description: 'x' })),
      { id: 'sw', type: 'service_worker', title: 'sw', url: 'https://x.test/sw.js' },
    ];
    const { tabs, total } = bm.shapeTabs(raw);
    assert.equal(tabs.length, 30);
    assert.equal(total, 40);
    assert.deepEqual(Object.keys(tabs[0]).sort(), ['id', 'title', 'url']); // no websocket URL, no content
    assert.equal(tabs[0].title, 'T0');
    assert.equal(tabs[29].title, 'T29');
  });

  await t('shapeTabs: bad ids and non-arrays never reach the view; long text is cut', () => {
    assert.deepEqual(bm.shapeTabs('nope'), { tabs: [], total: 0 });
    const { tabs } = bm.shapeTabs([
      page('../../etc', 'a', 'b'), page('ok-1', 'x'.repeat(900), 'https://u.test/' + 'y'.repeat(900)), page(42, 'n', 'n'), null,
    ]);
    assert.equal(tabs.length, 1);
    assert.equal(tabs[0].id, 'ok-1');
    assert.equal(tabs[0].title.length, 200);
    assert.equal(tabs[0].url.length, 500);
  });

  await t('looksLikeCdpList: needs typed objects; an empty list is not proof', () => {
    assert.equal(bm.looksLikeCdpList([page('a', 't', 'u')]), true);
    assert.equal(bm.looksLikeCdpList([]), false);
    assert.equal(bm.looksLikeCdpList([{ id: 1 }]), false);
    assert.equal(bm.looksLikeCdpList({ type: 'page' }), false);
    assert.equal(bm.looksLikeCdpList([null]), false);
  });

  await t('stateOf: running, stopped, held; the API can overrule a CDP answer', () => {
    const up = { up: true, held: false, tabs: [], tabCount: 0 };
    const held = { up: false, held: true, tabs: [], tabCount: 0 };
    const down = { up: false, held: false, tabs: [], tabCount: 0 };
    assert.equal(bm.stateOf(up), 'running');
    assert.equal(bm.stateOf(down), 'stopped');
    assert.equal(bm.stateOf(held), 'held');
    assert.equal(bm.stateOf(undefined), 'unknown');
    assert.equal(bm.stateOf(up, { state: 'up' }), 'running');
    assert.equal(bm.stateOf(up, { state: 'blocked' }), 'held'); // CDP answers but another program's browser holds it
    assert.equal(bm.stateOf(down, { state: 'up' }), 'stopped'); // a stale API read never outvotes the live look
  });

  await t('leasedText: string or object, null when absent', () => {
    assert.equal(bm.leasedText('claude 4a2f'), 'claude 4a2f');
    assert.equal(bm.leasedText({ by: 'claude 9z', sessionId: 'abc' }), 'claude 9z');
    assert.equal(bm.leasedText({ sessionId: 'abc123' }), 'abc123');
    assert.equal(bm.leasedText(''), null);
    assert.equal(bm.leasedText(undefined), null);
    assert.equal(bm.leasedText(5), null);
    assert.equal(bm.leasedText({}), null);
  });

  const profiles = bm.normaliseProfiles([
    { name: 'stopped-one', port: 9301, browser: 'chrome', mode: 'headed' },
    { name: 'held-one', port: 9302, browser: 'edge', mode: 'headless' },
    { name: 'alpha', port: 9303, browser: 'brave', mode: 'offscreen', url: 'https://start.test/', note: 'login test', userDataDir: 'C:\\pool\\old-pool' },
    { name: 'Beta', port: 9304, browser: 'brave', mode: 'headed' },
  ]);
  const mkProbe = (n) => ({ up: true, held: false, tabs: Array.from({ length: Math.min(n, 30) }, (_, i) => ({ id: `t${i}`, title: `T${i}`, url: `https://x.test/${i}` })), tabCount: n });
  const probes = new Map([
    ['stopped-one', { up: false, held: false, tabs: [], tabCount: 0 }],
    ['held-one', { up: false, held: true, tabs: [], tabCount: 0 }],
    ['alpha', mkProbe(3)],
    ['Beta', mkProbe(33)],
  ]);

  await t('buildRows: running first, then held, then stopped, by name; description is :port · mode · browser', () => {
    const rows = bm.buildRows(profiles, probes);
    assert.deepEqual(rows.map((r) => r.name), ['alpha', 'Beta', 'held-one', 'stopped-one']);
    assert.equal(rows[0].description, ':9303 · offscreen · brave');
    assert.equal(rows[3].description, ':9301 · headed · chrome');
    assert.equal(rows[2].description, ':9302 · headless · edge · port held');
    assert.equal(rows[0].cdpUrl, 'http://127.0.0.1:9303');
    assert.deepEqual(rows.map((r) => r.state), ['running', 'running', 'held', 'stopped']);
  });

  await t('buildRows: tabs only while running, capped, with the count left over', () => {
    const rows = bm.buildRows(profiles, probes);
    const beta = rows.find((r) => r.name === 'Beta');
    assert.equal(beta.tabs.length, 30);
    assert.equal(beta.tabsHidden, 3);
    assert.equal(rows.find((r) => r.name === 'alpha').tabsHidden, 0);
    assert.deepEqual(rows.find((r) => r.name === 'stopped-one').tabs, []);
    assert.ok(beta.tooltip.some((l) => l === 'Tabs: 33 (first 30 listed)'));
  });

  await t('buildRows: tooltip carries note, start URL, profile folder name, CDP URL', () => {
    const tip = bm.buildRows(profiles, probes).find((r) => r.name === 'alpha').tooltip;
    assert.ok(tip.includes('Note: login test'));
    assert.ok(tip.includes('Start URL: https://start.test/'));
    assert.ok(tip.includes('Profile folder: old-pool')); // an adopted dir shows its folder name
    assert.ok(tip.includes('CDP: http://127.0.0.1:9303'));
    const plain = bm.buildRows(profiles, probes).find((r) => r.name === 'Beta').tooltip;
    assert.ok(plain.includes('Profile folder: Beta'));
    assert.ok(!plain.some((l) => l.startsWith('Note:') || l.startsWith('Start URL:')));
  });

  await t('buildRows: "Leased to <session>" appears only when the API sends a lease', () => {
    const none = bm.buildRows(profiles, probes).find((r) => r.name === 'alpha');
    assert.equal(none.leasedTo, null);
    assert.ok(!none.tooltip.some((l) => /leased/i.test(l)));
    const full = new Map([['alpha', { name: 'alpha', state: 'up', leasedTo: 'claude 4a2f', free: false }]]);
    const row = bm.buildRows(profiles, probes, full).find((r) => r.name === 'alpha');
    assert.equal(row.leasedTo, 'claude 4a2f');
    assert.ok(row.tooltip.includes('Leased to claude 4a2f'));
    assert.ok(row.tooltip.includes('Free: no'));
    const free = bm.buildRows(profiles, probes, new Map([['alpha', { name: 'alpha', state: 'up', free: true }]])).find((r) => r.name === 'alpha');
    assert.ok(free.tooltip.includes('Free: yes'));
    assert.equal(free.leasedTo, null);
  });

  await t('buildRows: a claim shows when there is no lease; a held row shows the API warning', () => {
    const claim = new Map([['alpha', { name: 'alpha', state: 'up', claim: { by: 'claude 1abc', at: new Date().toISOString() } }]]);
    assert.ok(bm.buildRows(profiles, probes, claim).find((r) => r.name === 'alpha').tooltip.some((l) => l.startsWith('In use by claude 1abc')));
    const held = new Map([['held-one', { name: 'held-one', state: 'blocked', warning: 'port 9302 is held by msedge.exe (pid 4)' }]]);
    assert.ok(bm.buildRows(profiles, probes, held).find((r) => r.name === 'held-one').tooltip.includes('port 9302 is held by msedge.exe (pid 4)'));
  });

  await t('buildRows: a hostile config never throws', () => {
    assert.deepEqual(bm.buildRows(bm.normaliseProfiles(null), new Map()), []);
    const rows = bm.buildRows(bm.normaliseProfiles([{ name: 'x', port: 9400 }]), new Map(), new Map([['x', { leasedTo: { deep: { x: 1 } }, free: 'yes', claim: { by: 5 } }]]));
    assert.equal(rows[0].state, 'unknown');
    assert.equal(rows[0].leasedTo, null);
  });

  await t('validateOpenUrl: http and https only', () => {
    assert.deepEqual(bm.validateOpenUrl(' https://example.com/a?b=1 '), { ok: true, url: 'https://example.com/a?b=1' });
    assert.equal(bm.validateOpenUrl('http://localhost:3000').ok, true);
    assert.equal(bm.validateOpenUrl('http://localhost:3000').url, 'http://localhost:3000/');
    for (const bad of ['', '   ', 'example.com', 'javascript:alert(1)', 'file:///etc/passwd', 'ftp://x.test', 'data:text/html,hi', 'chrome://settings', 'about:blank', 'https://a b.test', 'http://']) {
      const r = bm.validateOpenUrl(bad);
      assert.equal(r.ok, false, `${JSON.stringify(bad)} must be rejected`);
      assert.ok(r.reason.length > 0);
    }
  });

  await t('failureMessage: the API error plus next step; unknown codes fall back to its action text', () => {
    const known = bm.failureMessage({ code: 'PORT_HELD', error: ':9302 is held by msedge.exe (pid 4). Not started; nothing was killed.', action: 'Do not kill it and ask the user.' });
    assert.match(known, /held by msedge\.exe/);
    assert.match(known, /Close the program using that port/);
    const odd = bm.failureMessage({ code: 'SOMETHING_NEW', error: 'it broke', action: 'Ask the user.' });
    assert.equal(odd, 'It broke. Ask the user.');
    assert.equal(bm.failureMessage(null), 'Something went wrong.');
    assert.ok(!/at .*\(.*:\d+:\d+\)/.test(bm.failureMessage({ code: 'INTERNAL', error: 'x', action: 'y', stack: 'at foo (a.js:1:2)' })));
  });

  await t('isRefusal: only the deliberate refusals', () => {
    for (const c of ['NOT_OURS', 'NOT_VERIFIED', 'PORT_HELD']) assert.equal(bm.isRefusal(c), true);
    for (const c of ['START_TIMEOUT', 'LAUNCH_FAILED', 'NOT_FOUND', undefined]) assert.equal(bm.isRefusal(c), false);
  });

  // ================= probe (real HTTP against fakes) =================

  const cdpA = fakeCdp({ targets: [page('a1', 'Dashboard', 'https://app.test/'), page('a2', 'Docs', 'https://docs.test/'), { id: 'sw', type: 'service_worker', title: 'sw', url: 'x' }] });
  const portA = await serve(cdpA.server);

  await t('probeProfile: CDP answers = up, with page tabs (title and url only)', async () => {
    const r = await probe.probeProfile(portA);
    assert.equal(r.up, true);
    assert.equal(r.held, false);
    assert.equal(r.tabCount, 2);
    assert.deepEqual(r.tabs.map((x) => [x.id, x.title, x.url]), [['a1', 'Dashboard', 'https://app.test/'], ['a2', 'Docs', 'https://docs.test/']]);
    assert.ok(cdpA.state.requests.every((q) => q === 'GET /json'), `only /json was requested: ${cdpA.state.requests}`);
  });

  await t('probeProfile: a free port is down, not held', async () => {
    assert.deepEqual(await probe.probeProfile(await freePort()), { up: false, held: false, tabs: [], tabCount: 0 });
  });

  await t('probeProfile: a non-CDP server on the port is held', async () => {
    const html = await serve(fakeOther('<html>hi</html>', 'text/html'));
    const notCdp = await serve(fakeOther(JSON.stringify([{ name: 'a' }, { name: 'b' }]), 'application/json'));
    const emptyJson = await serve(fakeOther('[]', 'application/json'));
    for (const p of [html, notCdp, emptyJson]) {
      const r = await probe.probeProfile(p);
      assert.equal(r.up, false, `port ${p} is not a browser`);
      assert.equal(r.held, true);
    }
  });

  await t('probeProfile: a browser with no pages is still up (confirmed by /json/version)', async () => {
    const empty = fakeCdp({ targets: [] });
    const p = await serve(empty.server);
    const r = await probe.probeProfile(p);
    assert.equal(r.up, true);
    assert.equal(r.tabCount, 0);
  });

  await t('probeProfile: an out-of-range port makes no request', async () => {
    const before = cdpA.state.requests.length;
    assert.equal((await probe.probeProfile(80)).up, false);
    assert.equal((await probe.probeProfile(NaN)).up, false);
    assert.equal(cdpA.state.requests.length, before);
  });

  await t('activateTab: activates by id; a gone tab and a hostile id are refused', async () => {
    assert.deepEqual(await probe.activateTab(portA, 'a2'), { ok: true });
    assert.deepEqual(cdpA.state.activated, ['a2']);
    assert.equal((await probe.activateTab(portA, 'zzz')).ok, false);
    const before = cdpA.state.requests.length;
    assert.equal((await probe.activateTab(portA, '../json/close/a1')).ok, false);
    assert.equal(cdpA.state.requests.length, before);
  });

  await t('openUrlInProfile: PUT /json/new with the URL; a non-http URL makes no request', async () => {
    assert.deepEqual(await probe.openUrlInProfile(portA, 'https://example.com/x?y=1'), { ok: true });
    assert.deepEqual(cdpA.state.opened, ['https://example.com/x?y=1']);
    assert.ok(cdpA.state.requests.includes('PUT /json/new?https://example.com/x?y=1'));
    const before = cdpA.state.requests.length;
    assert.equal((await probe.openUrlInProfile(portA, 'javascript:alert(1)')).ok, false);
    assert.equal((await probe.openUrlInProfile(portA, 'file:///c:/x')).ok, false);
    assert.equal(cdpA.state.requests.length, before);
  });

  await t('openUrlInProfile: nothing listening is a plain failure, not a throw', async () => {
    const r = await probe.openUrlInProfile(await freePort(), 'https://example.com/');
    assert.equal(r.ok, false);
    assert.ok(r.reason);
  });

  // ================= provider and commands, vscode stubbed =================

  const messages = [];
  const registered = new Map();
  const picks = { quick: null, input: undefined };
  const status = [];
  const clip = { text: null };
  class TreeItem { constructor(label, state) { this.label = label; this.collapsibleState = state; } }
  class EventEmitter {
    constructor() { this.listeners = []; this.fired = 0; this.event = (l) => { this.listeners.push(l); return { dispose() {} }; }; }
    fire(v) { this.fired++; this.listeners.forEach((l) => l(v)); }
    dispose() {}
  }
  const vscodeStub = {
    TreeItem,
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    ThemeIcon: class { constructor(id, color) { this.id = id; this.color = color; } },
    ThemeColor: class { constructor(id) { this.id = id; } },
    EventEmitter,
    ProgressLocation: { Notification: 15 },
    window: {
      showInformationMessage: async (m) => { messages.push(['info', m]); },
      showWarningMessage: async (m) => { messages.push(['warn', m]); return picks.warnPick; },
      showQuickPick: async (items) => { picks.lastItems = items; return picks.quick ? items.find((i) => i.id === picks.quick) : undefined; },
      showInputBox: async (opts) => { picks.lastInput = opts; (picks.inputBoxes = picks.inputBoxes || []).push(opts); return picks.inputs ? picks.inputs.shift() : picks.input; },
      withProgress: async (_o, fn) => fn(),
      setStatusBarMessage: (m) => { status.push(m); return { dispose() {} }; },
    },
    commands: { registerCommand: (id, fn) => { registered.set(id, fn); return { dispose() {} }; } },
    env: { clipboard: { writeText: async (x) => { clip.text = x; } } },
  };
  const origLoad = Module._load;
  Module._load = function (request, ...rest) { return request === 'vscode' ? vscodeStub : origLoad.call(this, request, ...rest); };

  const { BrowsersTreeProvider, BrowserProfileItem, BrowserTabItem } = require('../vscode-extension/out/browsersTreeProvider.js');
  const { registerBrowserCommands } = require('../vscode-extension/out/browserCommands.js');

  const portHeld = await serve(fakeOther('not a browser'));
  const portFree = await freePort();
  const writeConfig = (list) => fs.writeFileSync(configPath, JSON.stringify({ apps: [], settings: {}, groups: [], browserProfiles: list }));
  writeConfig([
    { name: 'shop', port: portA, browser: 'brave', mode: 'offscreen', url: 'https://shop.test/', note: 'checkout flow' },
    { name: 'idle', port: portFree, browser: 'chrome', mode: 'headed', url: '', note: '' },
    { name: 'taken', port: portHeld, browser: 'edge', mode: 'headless', url: '', note: '' },
    { name: 'bad', port: 5, browser: 'x', mode: 'y' },
  ]);

  const apiCalls = [];
  let fullReply = { success: true, profiles: [{ name: 'shop', state: 'up' }, { name: 'idle', state: 'down' }, { name: 'taken', state: 'blocked', warning: 'port held by other.exe (pid 9)' }], warnings: [] };
  const fakeApi = async (tool, args) => { apiCalls.push([tool, args]); return tool === 'list_browser_profiles' ? fullReply : { success: true }; };
  const nap = (ms) => new Promise((r) => setTimeout(r, ms));
  const settle = async (provider) => { for (let i = 0; i < 50 && provider.polling; i++) await nap(20); await nap(20); };

  const provider = new BrowsersTreeProvider(fakeApi);

  await t('provider: a hidden view does no polling at all', async () => {
    const before = cdpA.state.requests.length;
    await provider.update();
    await provider.update();
    await settle(provider);
    assert.equal(cdpA.state.requests.length, before);
    assert.equal(apiCalls.length, 0);
  });

  await t('provider: before the first look the profiles are listed with no state', () => {
    const kids = provider.getChildren();
    assert.deepEqual(kids.map((k) => k.label).sort(), ['idle', 'shop', 'taken']);
    assert.ok(kids.every((k) => k instanceof BrowserProfileItem && /bdown/.test(k.contextValue)));
  });

  await t('provider: showing the view reads once; rows are running, held, stopped in that order', async () => {
    provider.setVisible(true);
    await settle(provider);
    const kids = provider.getChildren();
    assert.deepEqual(kids.map((k) => k.label), ['shop', 'taken', 'idle']);
    assert.deepEqual(kids.map((k) => k.contextValue), ['bprofile bup', 'bprofile bheld', 'bprofile bdown']);
    assert.equal(kids[0].description, `:${portA} · offscreen · brave`);
    assert.equal(kids[0].collapsibleState, 1); // collapsed, has tabs
    assert.equal(kids[2].collapsibleState, 0);
    assert.ok(kids[0].tooltip.includes('Note: checkout flow'));
    assert.ok(kids[1].tooltip.includes('port held by other.exe (pid 9)'));
    assert.equal(apiCalls.filter(([tool]) => tool === 'list_browser_profiles').length, 1);
  });

  await t('provider: tab children are the profile\'s own tabs; click focuses', () => {
    const shop = provider.getChildren().find((k) => k.label === 'shop');
    const tabs = provider.getChildren(shop);
    assert.deepEqual(tabs.map((x) => x.label), ['Dashboard', 'Docs']);
    assert.ok(tabs.every((x) => x instanceof BrowserTabItem && x.command.command === 'portpilot.focusBrowserTab'));
    assert.equal(tabs[0].description, 'https://app.test/');
    assert.deepEqual(provider.getChildren(tabs[0]), []);
  });

  await t('provider: the 10 s cycle with nothing changed repaints nothing and re-reads no API', async () => {
    const fired = provider._onDidChangeTreeData.fired;
    const calls = apiCalls.length;
    await provider.update();
    await settle(provider);
    assert.equal(provider._onDidChangeTreeData.fired, fired);
    assert.equal(apiCalls.length, calls);
  });

  await t('provider: a browser going down repaints and earns a fresh API read', async () => {
    const fired = provider._onDidChangeTreeData.fired;
    const calls = apiCalls.length;
    const saved = cdpA.state.targets;
    cdpA.server.closeAllConnections?.();
    await new Promise((r) => cdpA.server.close(r));
    await provider.update();
    await settle(provider);
    assert.ok(provider._onDidChangeTreeData.fired > fired);
    assert.equal(provider.getChildren().find((k) => k.label === 'shop').contextValue, 'bprofile bdown');
    assert.ok(apiCalls.length > calls);
    // bring it back on the same port for the command tests
    await new Promise((r) => cdpA.server.listen(portA, '127.0.0.1', r));
    cdpA.state.targets = saved;
  });

  await t('provider: the config is re-read only when its mtime moves; a new profile appears', async () => {
    const config = require('../vscode-extension/out/config.js');
    const a = config.readBrowserProfilesCached();
    const b = config.readBrowserProfilesCached();
    assert.equal(a, b, 'same cache object while the file is unchanged');
    await nap(30);
    writeConfig([
      { name: 'shop', port: portA, browser: 'brave', mode: 'offscreen' },
      { name: 'idle', port: portFree, browser: 'chrome', mode: 'headed' },
      { name: 'taken', port: portHeld, browser: 'edge', mode: 'headless' },
      { name: 'fresh', port: await freePort(), browser: 'chrome', mode: 'headed' },
    ]);
    assert.notEqual(config.readBrowserProfilesCached().key, a.key);
    await provider.refresh();
    await settle(provider);
    assert.ok(provider.getChildren().some((k) => k.label === 'fresh'));
  });

  await t('provider: lease fields show when the API sends them, and a hidden-again view stops reading', async () => {
    fullReply = { success: true, profiles: [{ name: 'shop', state: 'up', leasedTo: 'claude 4a2f', free: false }] };
    await provider.refresh();
    await settle(provider);
    const shop = provider.getChildren().find((k) => k.label === 'shop');
    assert.ok(shop.tooltip.includes('Leased to claude 4a2f'));
    provider.setVisible(false);
    const before = cdpA.state.requests.length;
    await provider.update();
    await settle(provider);
    assert.equal(cdpA.state.requests.length, before);
    provider.setVisible(true);
    await settle(provider);
    assert.ok(cdpA.state.requests.length > before, 'showing it again looks again');
  });

  await t('provider: an unreadable config is an empty view, never a throw', async () => {
    const p2 = new BrowsersTreeProvider(fakeApi);
    fs.writeFileSync(configPath, '{ not json');
    assert.deepEqual(p2.getChildren(), []);
    p2.setVisible(true);
    await settle(p2);
    assert.deepEqual(p2.getChildren(), []);
    writeConfig([{ name: 'shop', port: portA, browser: 'brave', mode: 'offscreen', note: 'checkout flow' }, { name: 'idle', port: portFree }, { name: 'taken', port: portHeld }]);
    p2.setVisible(false);
  });

  // commands: start/stop are faked at the API seam, never a real browser
  const cmdCalls = [];
  let cmdReply = { success: true };
  const cmdProvider = new BrowsersTreeProvider(fakeApi);
  cmdProvider.setVisible(true);
  await settle(cmdProvider);
  registerBrowserCommands({ subscriptions: [] }, { provider: cmdProvider, call: async (tool, args) => { cmdCalls.push([tool, args]); return cmdReply; } });
  const item = (name) => cmdProvider.getChildren().find((k) => k.label === name);
  const cmd = (id) => registered.get(id);

  await t('commands: every command the manifest names is registered', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ext, 'package.json'), 'utf8'));
    const mine = ['startBrowser', 'stopBrowser', 'setBrowserMode', 'openBrowserUrl', 'copyBrowserCdp', 'copyBrowserPort', 'focusBrowserTab', 'refreshBrowsers', 'addBrowserProfile', 'removeBrowserProfile'].map((n) => `portpilot.${n}`);
    const declared = pkg.contributes.commands.map((c) => c.command);
    for (const id of mine) {
      assert.ok(declared.includes(id), `${id} is not declared in package.json`);
      assert.ok(registered.has(id), `${id} is declared but not registered`);
    }
    assert.ok(pkg.contributes.views.portpilot.some((v) => v.id === 'portpilot.browsers'));
    assert.ok(pkg.contributes.viewsWelcome.some((w) => w.view === 'portpilot.browsers' && /start_browser/.test(w.contents)));
  });

  await t('manifest: Browsers menus name declared commands, and each row state gets Start or Stop inline', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ext, 'package.json'), 'utf8'));
    const declared = new Set(pkg.contributes.commands.map((c) => c.command));
    const menus = [...pkg.contributes.menus['view/title'], ...pkg.contributes.menus['view/item/context']].filter((m) => /portpilot\.browsers/.test(m.when));
    assert.ok(menus.length >= 8);
    for (const m of menus) assert.ok(declared.has(m.command), `${m.command} is in a menu but not declared`);
    // Evaluate the inline "when" clauses the way VS Code does, against the contextValues the provider emits.
    const inlineFor = (cv) => menus.filter((m) => /^inline/.test(m.group) && [...m.when.matchAll(/viewItem =~ \/([^/]+)\//g)].every((x) => new RegExp(x[1]).test(cv))).map((m) => m.command);
    assert.deepEqual(inlineFor('bprofile bdown'), ['portpilot.startBrowser']);
    assert.deepEqual(inlineFor('bprofile bup'), ['portpilot.stopBrowser', 'portpilot.openBrowserUrl']);
    assert.deepEqual(inlineFor('bprofile bheld'), []);
    for (const id of ['startBrowser', 'stopBrowser', 'setBrowserMode', 'openBrowserUrl', 'copyBrowserCdp', 'copyBrowserPort', 'focusBrowserTab']) {
      assert.ok(pkg.contributes.menus.commandPalette.some((m) => m.command === `portpilot.${id}` && m.when === 'false'), `${id} is hidden from the palette`);
    }
  });

  await t('model: suggestPort starts at 9231, skips used and held ports and 9240', () => {
    const { suggestPort, nameProblem, portProblem } = require('../vscode-extension/out/browserModel.js');
    assert.equal(suggestPort([]), 9231);
    assert.equal(suggestPort([9231, 9232]), 9233);
    assert.equal(suggestPort([9231], [9232, 9233]), 9234);
    assert.equal(suggestPort([9239]), 9231);
    assert.equal(suggestPort(Array.from({ length: 9 }, (_, i) => 9231 + i)), 9241);
    assert.equal(nameProblem('', []), 'Give the profile a name.');
    assert.ok(/letters/.test(nameProblem('-x', [])));
    assert.ok(/already exists/.test(nameProblem('Shop', ['shop'])));
    assert.equal(nameProblem('good.name', ['other']), undefined);
    const used = new Map([[9300, 'shop']]);
    assert.ok(/number/.test(portProblem('abc', used)));
    assert.ok(/1024 to 65535/.test(portProblem('80', used)));
    assert.ok(/belongs to "shop"/.test(portProblem('9300', used)));
    assert.equal(portProblem('9301', used), undefined);
  });

  await t('commands: + adds a profile with the suggested port, Remove takes it out and keeps the folder', async () => {
    const config = require('../vscode-extension/out/config.js');
    picks.inputBoxes = [];
    picks.inputs = ['fresh', '9777', 'for tests'];
    await cmd('portpilot.addBrowserProfile')();
    assert.equal(picks.inputBoxes.length, 3);
    assert.ok(/^\d+$/.test(picks.inputBoxes[1].value), 'the port box is pre-filled');
    assert.equal(picks.inputBoxes[0].validateInput('shop'), 'A profile named "shop" already exists.');
    assert.ok(/belongs to/.test(picks.inputBoxes[1].validateInput(String(config.readBrowserProfilesCached().profiles[0].port))));
    const added = config.readBrowserProfilesCached().profiles.find((p) => p.name === 'fresh');
    assert.ok(added, 'profile is in the shared config');
    assert.equal(added.port, 9777);
    assert.equal(added.purpose, 'for tests');
    // Cancelling any box adds nothing.
    picks.inputs = ['cancelled', undefined];
    await cmd('portpilot.addBrowserProfile')();
    assert.ok(!config.readBrowserProfilesCached().profiles.some((p) => p.name === 'cancelled'));
    // Remove needs the confirmation; declining leaves it.
    await cmdProvider.refresh();
    picks.warnPick = undefined;
    await cmd('portpilot.removeBrowserProfile')(item('fresh'));
    assert.ok(config.readBrowserProfilesCached().profiles.some((p) => p.name === 'fresh'));
    picks.warnPick = 'Remove';
    await cmd('portpilot.removeBrowserProfile')(item('fresh'));
    assert.ok(!config.readBrowserProfilesCached().profiles.some((p) => p.name === 'fresh'));
    picks.warnPick = undefined; picks.inputs = undefined;
  });

  await t('commands: Remove refuses a running profile', async () => {
    messages.length = 0;
    picks.warnPick = 'Remove';
    await cmd('portpilot.removeBrowserProfile')(item('shop'));
    assert.ok(messages.some(([, m]) => /is running\. Stop it before removing/.test(m)), JSON.stringify(messages));
    assert.ok(require('../vscode-extension/out/config.js').readBrowserProfilesCached().profiles.some((p) => p.name === 'shop'));
    picks.warnPick = undefined;
  });

  await t('commands: Start calls start_browser by name; Stop calls stop_browser', async () => {
    cmdCalls.length = 0;
    await cmd('portpilot.startBrowser')(item('idle'));
    await cmd('portpilot.stopBrowser')(item('shop'));
    assert.deepEqual(cmdCalls, [['start_browser', { name: 'idle' }], ['stop_browser', { name: 'shop' }]]);
  });

  await t('commands: a refusal is information with the API text; a failure is a warning; never a stack', async () => {
    messages.length = 0;
    cmdReply = { success: false, code: 'NOT_OURS', error: ':9302 is held by msedge.exe. Not stopping a process this profile did not start.', action: 'Leave it running.', stack: 'at x (y.js:1:1)' };
    await cmd('portpilot.stopBrowser')(item('taken'));
    cmdReply = { success: false, code: 'START_TIMEOUT', error: 'idle: nothing answered CDP on :1 within 10000 ms.', action: 'Call start_browser once more.' };
    await cmd('portpilot.startBrowser')(item('idle'));
    assert.equal(messages[0][0], 'info');
    assert.match(messages[0][1], /not stopping a process this profile did not start/i);
    assert.equal(messages[1][0], 'warn');
    assert.match(messages[1][1], /nothing answered CDP/);
    assert.ok(messages.every(([, m]) => !/\bat .*\.js:\d+/.test(m)));
    cmdReply = { success: true };
  });

  await t('commands: Set mode offers the three modes and sends the pick; a running browser is told to restart', async () => {
    cmdCalls.length = 0; messages.length = 0;
    picks.quick = 'headless';
    cmdReply = { success: true, note: 'The running browser keeps its old mode. Call stop_browser, then start_browser, to apply it.' };
    await cmd('portpilot.setBrowserMode')(item('shop'));
    assert.deepEqual(picks.lastItems.map((i) => i.id), ['headed', 'offscreen', 'headless']);
    assert.equal(picks.lastItems.find((i) => i.id === 'offscreen').description, 'current');
    assert.deepEqual(cmdCalls, [['set_browser_mode', { name: 'shop', mode: 'headless' }]]);
    assert.match(messages[0][1], /keeps its old mode/);
    cmdCalls.length = 0;
    picks.quick = 'offscreen'; // the current mode: nothing to do
    await cmd('portpilot.setBrowserMode')(item('shop'));
    picks.quick = null;          // dismissed
    await cmd('portpilot.setBrowserMode')(item('shop'));
    assert.deepEqual(cmdCalls, []);
    cmdReply = { success: true };
  });

  await t('commands: Open URL validates, then opens a tab in that profile only', async () => {
    messages.length = 0;
    cdpA.state.opened.length = 0;
    picks.input = 'javascript:alert(1)';
    await cmd('portpilot.openBrowserUrl')(item('shop'));
    assert.deepEqual(cdpA.state.opened, []);
    assert.equal(picks.lastInput.validateInput('javascript:alert(1)').length > 0, true);
    assert.equal(picks.lastInput.validateInput('https://ok.test/'), undefined);
    picks.input = 'https://ok.test/path';
    await cmd('portpilot.openBrowserUrl')(item('shop'));
    assert.deepEqual(cdpA.state.opened, ['https://ok.test/path']);
    picks.input = undefined; // cancelled
    await cmd('portpilot.openBrowserUrl')(item('shop'));
    assert.equal(cdpA.state.opened.length, 1);
  });

  await t('commands: Open URL on a stopped profile says to start it, and opens nothing', async () => {
    messages.length = 0;
    picks.input = 'https://ok.test/';
    await cmd('portpilot.openBrowserUrl')(item('idle'));
    assert.match(messages[0][1], /not running/);
  });

  await t('commands: clicking a tab activates it in its own browser', async () => {
    cdpA.state.activated.length = 0;
    await cmdProvider.refresh();
    await settle(cmdProvider);
    const tab = cmdProvider.getChildren(item('shop'))[0];
    await cmd('portpilot.focusBrowserTab')(tab);
    assert.deepEqual(cdpA.state.activated, [tab.tab.id]);
  });

  await t('commands: focusing a tab that closed warns instead of throwing', async () => {
    messages.length = 0;
    const tab = cmdProvider.getChildren(item('shop'))[0];
    cdpA.state.targets = [];
    await cmd('portpilot.focusBrowserTab')(tab);
    assert.equal(messages[0][0], 'warn');
    assert.match(messages[0][1], /tab is gone/i);
  });

  await t('commands: Copy CDP URL and Copy port', async () => {
    await cmd('portpilot.copyBrowserCdp')(item('idle'));
    assert.equal(clip.text, `http://127.0.0.1:${portFree}`);
    await cmd('portpilot.copyBrowserPort')(item('idle'));
    assert.equal(clip.text, String(portFree));
  });

  await t('commands: a call with something that is not a row does nothing', async () => {
    cmdCalls.length = 0;
    await cmd('portpilot.startBrowser')(undefined);
    await cmd('portpilot.stopBrowser')({ row: { name: 'x' } });
    assert.deepEqual(cmdCalls, []);
  });

  // The real API against the throwaway config: list_browser_profiles resolves and parses.
  // The fake CDP server is a node process, not a browser, so the API calling it "blocked" is correct.
  await t('real list_browser_profiles (throwaway config, fake ports) resolves and the provider draws it', async () => {
    const config = require('../vscode-extension/out/config.js');
    const res = await config.browserCall('list_browser_profiles');
    assert.equal(res.success, true);
    assert.deepEqual(res.profiles.map((p) => p.name).sort(), ['idle', 'shop', 'taken']);
    const real = new BrowsersTreeProvider();
    real.setVisible(true);
    await settle(real);
    await nap(500);
    assert.equal(real.getChildren().length, 3);
    real.setVisible(false);
  });

  Module._load = origLoad;
  for (const c of cleanup) { try { await c(); } catch { /* already closed */ } }
  try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch { /* best effort */ }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
