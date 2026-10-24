const assert = require('assert');
const { createLiveThumbs } = require('../src/main/liveThumbs');

(async () => {
  let clock = 1000;
  let calls = 0;
  let release = null;
  const capture = (port) => { calls++; return release ? new Promise((r) => { release = () => r({ jpeg: Buffer.from('x') }); }) : Promise.resolve({ jpeg: Buffer.from('jpg' + port) }); };
  const live = createLiveThumbs({ capture, now: () => clock, minGapMs: 10000 });

  const a = await live.request('app1', 3000);
  assert.strictEqual(a.ok, true);
  assert.strictEqual(live.get(a.key), 'data:image/jpeg;base64,' + Buffer.from('jpg3000').toString('base64'));
  assert.deepStrictEqual(live.index(), { app1: { key: a.key, at: 1000 } });

  assert.deepStrictEqual(await live.request('app1', 3000), { ok: false, reason: 'throttled' });
  assert.strictEqual(calls, 1, 'a throttled request never reaches the capture');
  clock += 10000;
  const b = await live.request('app1', 3000);
  assert.strictEqual(b.ok, true);
  assert.strictEqual(live.get(a.key), null, 'the replaced key no longer resolves');
  assert.ok(live.get(b.key));

  // One in flight at a time.
  release = () => {};
  const slow = live.request('app2', 3001);
  assert.deepStrictEqual(await live.request('app3', 3002), { ok: false, reason: 'busy' });
  release();
  assert.strictEqual((await slow).ok, true);
  release = null;

  // A failure is reported and still counts toward the throttle.
  const bad = createLiveThumbs({ capture: () => Promise.reject(new Error('boom')), now: () => clock });
  assert.deepStrictEqual(await bad.request('x', 1), { ok: false, reason: 'failed', error: 'boom' });
  assert.strictEqual((await bad.request('x', 1)).reason, 'throttled');

  assert.strictEqual((await live.request('../etc', 1)).reason, 'failed');
  assert.strictEqual(live.get('live-../x-1'), null);
  console.log('live-thumbs: ok');
})().catch((e) => { console.error(e); process.exit(1); });
