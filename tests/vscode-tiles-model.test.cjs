/**
 * VS Code Tiles view model (vscode-extension/src/tilesModel.ts): which apps become tiles and in what
 * order, idle apps going to the compact list, pictures only for running apps and only when previews
 * are on, one tile per browser profile, and the picture sync that never sends a key twice.
 * Requires the compiled module, so run `npm run compile` in vscode-extension/ first.
 * Run: node tests/vscode-tiles-model.test.cjs   (part of npm run test:unit)
 */
const assert = require('assert');
const m = require('../vscode-extension/out/tilesModel.js');

let passed = 0;
let failed = 0;
function t(name, fn) {
  try { fn(); console.log('✅', name); passed++; }
  catch (e) { console.log('❌', name, '-', e.message); failed++; }
}

const app = (id, name, state, extra = {}) => ({ id, name, port: 3000, state, word: state, favorite: false, ...extra });
const names = (list) => list.map(x => x.name);

// ---- apps ----
t('attention first, then running; favourites lead inside a state, then name', () => {
  const { live } = m.buildAppTiles([
    app('1', 'zeta', 'running'), app('2', 'alpha', 'running'), app('3', 'mid', 'running', { favorite: true }),
    app('4', 'boom', 'crashed'), app('5', 'held', 'conflict'),
  ]);
  assert.deepEqual(names(live), ['boom', 'held', 'mid', 'alpha', 'zeta']);
});

t('stopped apps go to the compact list, in the same order', () => {
  const { live, stopped } = m.buildAppTiles([app('1', 'b', 'stopped'), app('2', 'run', 'running'), app('3', 'a', 'stopped', { favorite: true })]);
  assert.deepEqual(names(live), ['run']);
  assert.deepEqual(names(stopped), ['a', 'b']);
});

t('a crashed app stays a tile and can be started again', () => {
  const { live, stopped } = m.buildAppTiles([app('1', 'boom', 'crashed')]);
  assert.equal(stopped.length, 0);
  assert.equal(live[0].lamp, 'crashed');
  assert.equal(live[0].canStart, true);
  assert.equal(live[0].canStop, false);
});

t('lamps use the Apps rows words: conflict is blocked, error is crashed', () => {
  const { live } = m.buildAppTiles([app('1', 'a', 'conflict'), app('2', 'b', 'error'), app('3', 'c', 'starting'), app('4', 'd', 'running')]);
  assert.deepEqual(Object.fromEntries(live.map(x => [x.name, x.lamp])), { a: 'blocked', b: 'crashed', c: 'starting', d: 'running' });
});

t('only a running app with a port can be opened; only a running one can be stopped', () => {
  const { live, stopped } = m.buildAppTiles([app('1', 'up', 'running'), app('2', 'noport', 'running', { port: null }), app('3', 'down', 'stopped')]);
  const by = Object.fromEntries([...live, ...stopped].map(x => [x.name, x]));
  assert.equal(by.up.canOpen, true);
  assert.equal(by.noport.canOpen, false);
  assert.equal(by.down.canOpen, false);
  assert.equal(by.up.canStop, true);
  assert.equal(by.down.canStart, true);
});

t('a picture key only for a running app, and only when previews are on', () => {
  const inputs = [app('1', 'up', 'running', { thumb: 'thumbs/a.jpg' }), app('2', 'down', 'stopped', { thumb: 'thumbs/b.jpg' })];
  const on = m.buildAppTiles(inputs, true);
  assert.equal(on.live[0].img, 'run:thumbs/a.jpg');
  assert.equal(on.stopped[0].img, '');
  assert.equal(m.buildAppTiles(inputs, false).live[0].img, '');
});

t('a tile with no picture gets a letter', () => {
  assert.equal(m.buildAppTiles([app('1', 'azurePrep', 'running')]).live[0].letter, 'A');
  assert.equal(m.letterOf('  Éclair'), 'É');
  assert.equal(m.letterOf(''), '?');
  assert.equal(m.letterOf('🚀 rocket'), '🚀');
});

t('a branch shows on the tile; a plain app has an empty branch', () => {
  const { live } = m.buildAppTiles([app('1', 'site', 'running', { branch: 'feat/x' }), app('2', 'plain', 'running')]);
  assert.deepEqual(live.map(x => x.branch).sort(), ['', 'feat/x']);
});

t('thumbOf follows the Apps row rule (listening, runtime record, matching port)', () => {
  const byApp = { a: { id: 'r', thumb: 'thumbs/a.jpg', port: 3000 } };
  assert.equal(m.thumbOf(byApp, 'a', true, 3000), 'thumbs/a.jpg');
  assert.equal(m.thumbOf(byApp, 'a', false, 3000), null);
  assert.equal(m.thumbOf(byApp, 'a', true, 4000), null);
  assert.equal(m.thumbOf(byApp, 'a', true, null), null);
  assert.equal(m.thumbOf(byApp, 'zzz', true, 3000), null);
});

// ---- browsers ----
const row = (name, state, extra = {}) => ({ name, port: 9222, mode: 'headed', browser: 'brave', state, stateWord: state, cdpUrl: '', description: '', tooltip: [], leasedTo: null, tabs: [], tabsHidden: 0, ...extra });

t('one tile per profile, in the order the rows arrive', () => {
  const tiles = m.buildBrowserTiles([row('google', 'running'), row('reddit', 'stopped'), row('linkedin', 'held')], () => null);
  assert.deepEqual(names(tiles), ['google', 'reddit', 'linkedin']);
  assert.deepEqual(tiles.map(x => x.lamp), ['running', 'stopped', 'blocked']);
});

t('Start only for a stopped profile, Stop only for a running one, nothing for a held port', () => {
  const [up, down, held] = m.buildBrowserTiles([row('a', 'running'), row('b', 'stopped'), row('c', 'held')], () => null);
  assert.deepEqual([up.canStop, up.canStart], [true, false]);
  assert.deepEqual([down.canStop, down.canStart], [false, true]);
  assert.deepEqual([held.canStop, held.canStart], [false, false]);
});

t('a click focuses only a running profile with a web page open', () => {
  const page = { id: 'A1', title: 't', url: 'https://example.com/' };
  const blank = { id: 'B1', title: '', url: 'about:blank' };
  const tiles = m.buildBrowserTiles([row('a', 'running', { tabs: [page] }), row('b', 'running', { tabs: [blank] }), row('c', 'stopped', { tabs: [page] })], () => null);
  assert.deepEqual(tiles.map(x => x.canFocus), [true, false, false]);
});

t('the art key carries the file time, so a new picture is a new key; no art means no key', () => {
  const stamps = { google: 1700000000000 };
  const [g, r] = m.buildBrowserTiles([row('Google', 'stopped'), row('reddit', 'stopped')], (n) => stamps[n.toLowerCase()] ?? null);
  assert.equal(g.img, 'art:google@1700000000000');
  assert.equal(r.img, '');
  assert.equal(m.artImgKey('Google', 5), 'art:google@5');
});

t('a lease shows who holds the profile', () => {
  assert.equal(m.buildBrowserTiles([row('a', 'running', { leasedTo: 'claude 4a2f' })], () => null)[0].leasedTo, 'claude 4a2f');
  assert.equal(m.buildBrowserTiles([row('a', 'running')], () => null)[0].leasedTo, '');
});

// ---- picture sync ----
t('ImageSync sends a key once, not on every repaint', () => {
  const s = new m.ImageSync();
  assert.deepEqual(s.pending(['a', 'b', '']), ['a', 'b']);
  assert.deepEqual(s.pending(['a', 'b', 'c']), ['c']);
  assert.deepEqual(s.pending(['a']), []);
});

t('ImageSync tries a failed key again, and resends everything after a reset', () => {
  const s = new m.ImageSync();
  s.pending(['a', 'b']);
  s.failed('a');
  assert.deepEqual(s.pending(['a', 'b']), ['a']);
  s.reset();
  assert.deepEqual(s.pending(['a', 'b']), ['a', 'b']);
});

t('imageKeys lists every key a state refers to', () => {
  const state = {
    apps: [{ img: 'run:x' }, { img: '' }],
    stoppedApps: [{ img: '' }],
    browsers: [{ img: 'art:g@1' }],
  };
  assert.deepEqual(m.imageKeys(state), ['run:x', 'art:g@1']);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
