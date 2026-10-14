/**
 * Browsers tab view logic (src/core/browserView.js).
 * Run: node tests/browser-view.test.cjs   (part of npm run test:unit)
 */
const assert = require('assert');
const v = require('../src/core/browserView');

let passed = 0;
let failed = 0;
function t(name, fn) {
  try { fn(); console.log(`✅ ${name}`); passed++; } catch (err) { console.log(`❌ ${name}\n     ${err.stack || err.message}`); failed++; }
}

console.log('\n=== browser view ===\n');

t('stateOf maps up, down and blocked to a word and a shape, and unknown to stopped', () => {
  assert.deepStrictEqual([v.stateOf({ state: 'up' }).word, v.stateOf({ state: 'up' }).glyph], ['Running', '●']);
  assert.strictEqual(v.stateOf({ state: 'blocked' }).word, 'Port held');
  assert.notStrictEqual(v.stateOf({ state: 'blocked' }).glyph, v.stateOf({ state: 'up' }).glyph);
  assert.strictEqual(v.stateOf({ state: 'wat' }).word, 'Stopped');
  assert.strictEqual(v.stateOf(null).word, 'Stopped');
});

t('sortRows puts running first, then port-held, then stopped, by name, without mutating the input', () => {
  const rows = [
    { name: 'zed', state: 'down' }, { name: 'bee', state: 'up' }, { name: 'Ann', state: 'down' },
    { name: 'cat', state: 'blocked' }, { name: 'aye', state: 'up' },
  ];
  const copy = JSON.stringify(rows);
  assert.deepStrictEqual(v.sortRows(rows).map((r) => r.name), ['aye', 'bee', 'cat', 'Ann', 'zed']);
  assert.strictEqual(JSON.stringify(rows), copy);
});

t('summary counts each state and only mentions port-held when there is one', () => {
  assert.strictEqual(v.summary([{ state: 'up' }, { state: 'down' }, { state: 'down' }]), '1 running · 2 stopped');
  assert.strictEqual(v.summary([{ state: 'blocked' }, { state: 'down' }]), '0 running · 1 port held · 1 stopped');
  assert.strictEqual(v.summary([]), '0 running · 0 stopped');
});

t('claimLine names who and when, and is empty without a claim', () => {
  const now = Date.parse('2026-10-10T09:00:00Z');
  assert.strictEqual(v.claimLine({ by: 'claude 4a2f', at: '2026-10-10T08:57:00Z' }, now), 'In use by claude 4a2f · 3m ago');
  assert.strictEqual(v.claimLine(null), '');
  assert.strictEqual(v.claimLine({ at: 'x' }), '');
  assert.match(v.claimLine({ by: 'a', at: 'garbage' }, now), /earlier/);
});

t('suggestPort starts at 9231, skips used ports and 9240', () => {
  assert.strictEqual(v.suggestPort([]), 9231);
  assert.strictEqual(v.suggestPort([{ port: 9231 }, { port: 9232 }]), 9233);
  assert.strictEqual(v.suggestPort(Array.from({ length: 9 }, (_, i) => ({ port: 9231 + i }))), 9241);
});

t('failureText starts the sentence with a capital', () => {
  assert.strictEqual(v.failureText({ code: 'DUPLICATE_NAME', error: 'a profile named "x" already exists' }), 'A profile named "x" already exists. Pick a name that is not already used.');
});

t('defaultBrowser follows the newest profile when installed, else the first installed', () => {
  const installed = [{ id: 'chrome' }, { id: 'brave' }];
  assert.strictEqual(v.defaultBrowser([{ browser: 'chrome' }, { browser: 'brave' }], installed), 'brave');
  assert.strictEqual(v.defaultBrowser([{ browser: 'opera' }], installed), 'chrome');
  assert.strictEqual(v.defaultBrowser([], installed), 'chrome');
  assert.strictEqual(v.defaultBrowser([], []), '');
});

t('tabsLine shows a count and at most three titles', () => {
  assert.strictEqual(v.tabsLine([]), '');
  assert.strictEqual(v.tabsLine([{ title: 'Home' }]), '1 tab: Home');
  assert.strictEqual(v.tabsLine([{ title: 'A' }, { title: 'B' }, { title: 'C' }, { title: 'D' }]), '4 tabs: A, B, C, ...');
  assert.strictEqual(v.tabsLine([{ url: 'https://x.test/' }]), '1 tab: https://x.test/');
});

t('failureText keeps the error and adds a human next step; the model-facing action is never shown', () => {
  const text = v.failureText({ code: 'PORT_HELD', error: 'Port 9231 is held by node.exe', action: 'Do not kill it and do not pick another port.' });
  assert.match(text, /Port 9231 is held by node\.exe\. Close the program using that port/);
  assert.ok(!/Do not kill it/.test(text));
  assert.strictEqual(v.failureText({ code: 'WHO_KNOWS', error: 'Boom.' }), 'Boom.');
  assert.strictEqual(v.failureText(null), 'Something went wrong.');
});

t('every error code the panel can see has a next step', () => {
  for (const code of ['PORT_HELD', 'NOT_OURS', 'NOT_VERIFIED', 'BROWSER_NOT_FOUND', 'BAD_BROWSER', 'START_TIMEOUT', 'LAUNCH_FAILED', 'STOP_FAILED', 'SOURCE_RUNNING', 'PROFILE_RUNNING', 'COPY_FAILED', 'DUPLICATE_NAME', 'DUPLICATE_PORT', 'BAD_NAME', 'BAD_PORT', 'BAD_URL', 'BUSY']) {
    assert.notStrictEqual(v.failureText({ code, error: 'x' }), 'x', code);
  }
});

t('modes: three, each with a hint; unknown ids pass through', () => {
  assert.deepStrictEqual(v.MODES.map((m) => m.id), ['headed', 'offscreen', 'headless']);
  assert.ok(v.MODES.every((m) => m.hint.length > 10));
  assert.strictEqual(v.modeInfo('offscreen').label, 'Offscreen');
  assert.strictEqual(v.modeInfo('odd').label, 'odd');
});

t('extensionsText lists name and version, or says there are none', () => {
  assert.strictEqual(v.extensionsText([]), 'No extensions installed in this profile yet.');
  assert.strictEqual(v.extensionsText([{ name: 'Vault Pass', version: '1.2' }, { name: 'uBlock', version: '1.5' }]), 'Vault Pass 1.2, uBlock 1.5');
});

t('history rows: who, how it ended, tab count, and the tabs to show', () => {
  const e = { startedAt: '2026-10-13T06:02:00.000Z', stoppedAt: '2026-10-13T06:40:00.000Z', startedBy: { kind: 'claude', surface: 'mcp', sessionId: 'B71C-4d2e', label: 'claude b71c' }, endedBy: { kind: 'human', surface: 'desktop', label: 'PortPilot desktop' }, tabs: Array.from({ length: 9 }, (_, i) => ({ url: `https://t.test/${i}`, title: i ? '' : 'Home' })) };
  assert.strictEqual(v.startedByWord({ kind: 'human', surface: 'desktop' }), 'you');
  assert.strictEqual(v.startedByWord(e.startedBy), 'claude b71c');
  assert.strictEqual(v.startedByWord({ kind: 'claude', surface: 'mcp', sessionId: 'B71C-4d2e' }), 'claude b71c');
  assert.strictEqual(v.startedByWord(null), 'unknown');
  assert.strictEqual(v.endedWord(e), 'stopped by you');
  assert.strictEqual(v.endedWord({ ...e, endedBy: { kind: 'external', reason: 'closed' } }), 'closed outside PortPilot');
  assert.strictEqual(v.endedWord({ ...e, endedBy: { kind: 'external', reason: 'unknown' } }), 'end not seen');
  assert.strictEqual(v.endedWord({ ...e, stoppedAt: null }), '');
  const line = v.sessionLine(e);
  assert.match(line, /^\w{3} \d+ \w{3}, \d\d:\d\d - \d\d:\d\d · started by claude b71c · 9 tabs · stopped by you$/);
  assert.match(v.sessionLine({ ...e, stoppedAt: null, tabs: [e.tabs[0]] }), /^\w{3} \d+ \w{3}, \d\d:\d\d · started by claude b71c · 1 tab · running now$/);
  assert.strictEqual(v.shownTabs(e).shown.length, 6);
  assert.strictEqual(v.shownTabs(e).more, 3);
  assert.deepStrictEqual(v.shownTabs({ tabs: [] }), { shown: [], more: 0 });
  assert.strictEqual(v.tabLabel(e.tabs[0]), 'Home');
  assert.strictEqual(v.tabLabel(e.tabs[1]), 't.test/1');
});

t('reopenText says what opened, what failed and that hidden secrets may need a sign-in', () => {
  assert.strictEqual(v.reopenText({ name: 'shop', opened: 2 }), 'Opened 2 tabs in shop');
  assert.strictEqual(v.reopenText({ name: 'shop', opened: 1 }), 'Opened 1 tab in shop');
  assert.strictEqual(v.reopenText({ name: 'shop', opened: 0 }), 'Started shop; no tabs to add');
  assert.match(v.reopenText({ name: 'shop', opened: 1, failed: 2, hidden: 1 }), /2 could not be opened\. Addresses had secrets hidden/);
  assert.match(v.failureText({ code: 'IN_USE', error: 'x is in use' }), /Another Claude session/);
});

t('purposeLine joins the purpose and the sites; empty when neither is set', () => {
  assert.strictEqual(v.purposeLine({ purpose: 'Google Search Console', sites: ['search.google.com', 'analytics.google.com'] }), 'Google Search Console · search.google.com, analytics.google.com');
  assert.strictEqual(v.purposeLine({ sites: ['a.test'] }), 'a.test');
  assert.strictEqual(v.purposeLine({ purpose: 'Only words' }), 'Only words');
  assert.strictEqual(v.purposeLine({}), '');
  assert.strictEqual(v.purposeLine(null), '');
});

t('windowLine shows size, position and keep-in-front; negative and partial values read plainly', () => {
  assert.strictEqual(v.windowLine({ left: -1920, top: 40, width: 1200, height: 800, front: true }), '1200x800 at -1920,40 · stays in front');
  assert.strictEqual(v.windowLine({ left: 0, top: 0 }), 'at 0,0');
  assert.strictEqual(v.windowLine({ width: 900, height: 700 }), '900x700');
  assert.strictEqual(v.windowLine({ front: true }), 'stays in front');
  assert.strictEqual(v.windowLine(undefined), '');
  assert.strictEqual(v.windowLine({}), '');
});

t('placementWarning is empty when the window landed, and says so when it did not', () => {
  assert.strictEqual(v.placementWarning(undefined), '');
  assert.strictEqual(v.placementWarning({ requested: { left: 1 }, actual: { left: 1 }, applied: true }), '');
  assert.match(v.placementWarning({ requested: { left: 1 }, actual: { left: 0 }, applied: false }), /adjusted it/);
  assert.match(v.placementWarning({ requested: { left: 1 }, actual: null, applied: false }), /could not be placed/);
  assert.match(v.placementWarning({ requested: {}, applied: true, front: { raised: true, topmost: false } }), /Always-on-top did not take/);
  assert.strictEqual(v.placementWarning({ requested: {}, applied: true, front: { raised: true, topmost: null } }), '');
});

t('the new failure codes get a next step in plain words', () => {
  assert.match(v.failureText({ code: 'BAD_SITES', error: 'x is not a hostname' }), /hostnames such as search\.google\.com/);
  assert.match(v.failureText({ code: 'NOT_RUNNING', error: 'not running' }), /Start the profile/);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
