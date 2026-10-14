// Pure model of the home "Now running" strip: which apps get a card, in what order.
const assert = require('assert');
const S = require('../src/core/nowStrip');

let n = 0;
const t = (name, fn) => { fn(); n += 1; };

t('homeLayoutOf defaults to preview for anything unset or unknown', () => {
  assert.strictEqual(S.homeLayoutOf(undefined), 'preview');
  assert.strictEqual(S.homeLayoutOf({}), 'preview');
  assert.strictEqual(S.homeLayoutOf({ homeLayout: 'grid' }), 'preview');
  assert.strictEqual(S.homeLayoutOf({ homeLayout: 'preview' }), 'preview');
  assert.strictEqual(S.homeLayoutOf({ homeLayout: 'classic' }), 'classic');
});

const apps = [
  { id: 'a', name: 'alpha', preferredPort: 3000 },
  { id: 'b', name: 'beta', branch: 'feat/x', color: '#7aa2f7' },
  { id: 'c', name: 'charlie' },
  { id: 'd', name: 'delta' },
];

t('only running or detected apps get a card', () => {
  const cards = S.runningCards({
    apps,
    runningApps: [{ id: 'a', running: true, port: 3001, startTime: '2026-10-14T01:00:00Z' }, { id: 'c', running: false }],
    detectedApps: { b: { port: 4000, address: '127.0.0.1' } },
  });
  assert.deepStrictEqual(cards.map((c) => c.id).sort(), ['a', 'b']);
});

t('latest started first; unknown start time last; ties by name', () => {
  const cards = S.runningCards({
    apps,
    runningApps: [
      { id: 'a', running: true, port: 1, startTime: '2026-10-14T01:00:00Z' },
      { id: 'd', running: true, port: 2, startTime: '2026-10-14T03:00:00Z' },
    ],
    detectedApps: { c: { port: 3 }, b: { port: 4 } },
  });
  assert.deepStrictEqual(cards.map((c) => c.id), ['d', 'a', 'b', 'c']);
});

t('port prefers the managed run, then the detected one, then the preferred port', () => {
  const [m] = S.runningCards({ apps: [apps[0]], runningApps: [{ id: 'a', running: true, port: 3001 }], detectedApps: { a: { port: 3002 } } });
  assert.strictEqual(m.port, 3001);
  const [d] = S.runningCards({ apps: [apps[0]], runningApps: [], detectedApps: { a: { port: 3002 } } });
  assert.strictEqual(d.port, 3002);
  const [p] = S.runningCards({ apps: [apps[0]], runningApps: [{ id: 'a', running: true }], detectedApps: {} });
  assert.strictEqual(p.port, 3000);
});

t('a card carries branch, colour, managed and IPv6-only flags', () => {
  const [c] = S.runningCards({ apps: [apps[1]], runningApps: [], detectedApps: { b: { port: 5173, address: '[::1]' } } });
  assert.strictEqual(c.branch, 'feat/x');
  assert.strictEqual(c.color, '#7aa2f7');
  assert.strictEqual(c.managed, false);
  assert.strictEqual(c.ipv6Only, true);
});

t('noPreviewReason names IPv6-only servers and says nothing when a preview exists', () => {
  assert.strictEqual(S.noPreviewReason({ ipv6Only: false }, true), null);
  assert.strictEqual(S.noPreviewReason({ ipv6Only: false }, false), 'No preview yet');
  assert.strictEqual(S.noPreviewReason({ ipv6Only: true }, false), 'No preview (IPv6 only)');
  assert.strictEqual(S.noPreviewReason({ ipv6Only: true }, false, false), 'Previews are off in Settings');
});

t('an empty state gives an empty strip', () => {
  assert.deepStrictEqual(S.runningCards({}), []);
});

console.log(`now-strip: ${n} cases ok`);
