/**
 * The MCP server child is restarted when it dies, with backoff, and the outage is reported once
 * when restarts are exhausted. (src/core/mcpSupervisor.js)
 * Run: node tests/mcp-supervisor.test.cjs   (part of npm run test:unit)
 */
const assert = require('assert');
const { EventEmitter } = require('events');
const { createSupervisor } = require('../src/core/mcpSupervisor');

let passed = 0;
let failed = 0;
function t(name, fn) {
  try { fn(); console.log('OK ', name); passed++; }
  catch (e) { console.log('XX ', name, '-', e.message); failed++; }
}

/** A fake clock whose timers fire only when `tick` advances past them. */
function clock() {
  let now = 0;
  const timers = [];
  return {
    now: () => now,
    setTimeout: (fn, ms) => { const h = { at: now + ms, fn }; timers.push(h); return h; },
    clearTimeout: (h) => { const i = timers.indexOf(h); if (i >= 0) timers.splice(i, 1); },
    tick(ms) {
      now += ms;
      for (const h of timers.splice(0).sort((a, b) => a.at - b.at)) { if (h.at <= now) h.fn(); else timers.push(h); }
    },
    pending: () => timers.length,
  };
}

function world(opts = {}) {
  const c = clock();
  const spawned = [];
  const log = [];
  const gaveUp = [];
  const sup = createSupervisor({
    spawn: () => { const ch = new EventEmitter(); ch.pid = 100 + spawned.length; ch.kill = () => { ch.killed = true; }; spawned.push(ch); return ch; },
    onChild: opts.onChild, onGiveUp: (info) => gaveUp.push(info), log: (m) => log.push(m),
    maxRestarts: 3, baseDelayMs: 1000, healthyMs: 60000,
    setTimeout: c.setTimeout, clearTimeout: c.clearTimeout, now: c.now,
  });
  return { c, spawned, log, gaveUp, sup };
}

t('start spawns once and hands the child to onChild', () => {
  const seen = [];
  const { spawned, sup } = world({ onChild: (ch) => seen.push(ch.pid) });
  sup.start();
  assert.equal(spawned.length, 1);
  assert.deepEqual(seen, [100]);
  assert.equal(sup.child, spawned[0]);
});

t('a quick death is restarted after 1 s, then 2 s, then 4 s', () => {
  const { c, spawned, sup } = world();
  sup.start();
  spawned[0].emit('exit', 1, null);
  assert.equal(spawned.length, 1, 'no restart before the delay');
  c.tick(999); assert.equal(spawned.length, 1);
  c.tick(1); assert.equal(spawned.length, 2);
  spawned[1].emit('exit', 1, null);
  c.tick(1999); assert.equal(spawned.length, 2);
  c.tick(1); assert.equal(spawned.length, 3);
  spawned[2].emit('exit', 0, null);
  c.tick(4000); assert.equal(spawned.length, 4);
});

t('after maxRestarts quick deaths it gives up once and reports the exit', () => {
  const { c, spawned, gaveUp, sup } = world();
  sup.start();
  for (let i = 0; i < 3; i++) { spawned[i].emit('exit', 1, null); c.tick(10000); }
  assert.equal(spawned.length, 4);
  spawned[3].emit('exit', 1, null);
  c.tick(100000);
  assert.equal(spawned.length, 4, 'no further restart');
  assert.equal(gaveUp.length, 1);
  assert.equal(gaveUp[0].code, 1);
  assert.equal(gaveUp[0].restarts, 3);
  assert.equal(gaveUp[0].pid, 103);
});

t('a child that lived past healthyMs resets the restart budget', () => {
  const { c, spawned, gaveUp, sup } = world();
  sup.start();
  for (let i = 0; i < 3; i++) { spawned[i].emit('exit', 1, null); c.tick(10000); }
  c.tick(60000); // child 4 has now lived a minute
  spawned[3].emit('exit', null, 'SIGTERM');
  c.tick(1000);
  assert.equal(spawned.length, 5, 'restarted again with a fresh budget');
  assert.equal(gaveUp.length, 0);
  assert.equal(sup.restarts, 1);
});

t('stop kills the child, cancels a pending restart and ignores the exit that follows', () => {
  const { c, spawned, sup } = world();
  sup.start();
  spawned[0].emit('exit', 1, null);
  assert.equal(c.pending(), 1);
  sup.stop();
  assert.equal(c.pending(), 0);
  c.tick(10000);
  assert.equal(spawned.length, 1);
  assert.equal(sup.child, null);

  const w2 = world();
  w2.sup.start();
  w2.sup.stop();
  assert.ok(w2.spawned[0].killed);
  w2.spawned[0].emit('exit', null, 'SIGTERM');
  w2.c.tick(10000);
  assert.equal(w2.spawned.length, 1, 'quit is not a crash');
});

t('a spawn that throws counts as a death and is retried; a second start() is ignored', () => {
  let fail = true;
  const c = clock();
  const spawned = [];
  const sup = createSupervisor({
    spawn: () => { if (fail) throw new Error('EMFILE'); const ch = new EventEmitter(); ch.pid = 1; ch.kill = () => {}; spawned.push(ch); return ch; },
    maxRestarts: 3, baseDelayMs: 1000, healthyMs: 60000, setTimeout: c.setTimeout, clearTimeout: c.clearTimeout, now: c.now,
  });
  sup.start();
  assert.equal(c.pending(), 1, 'retry scheduled');
  fail = false;
  sup.start();
  assert.equal(spawned.length, 0, 'start() while a retry is pending does nothing');
  c.tick(1000);
  assert.equal(spawned.length, 1);
  sup.start();
  assert.equal(spawned.length, 1, 'start() while a child runs does nothing');
});

t("a child that emits 'error' then 'exit' dies once; a late exit from an old child is ignored", () => {
  const { c, spawned, gaveUp, sup } = world();
  sup.start();
  spawned[0].emit('error', Object.assign(new Error('spawn'), { code: 'ENOENT' }));
  spawned[0].emit('exit', 1, null);
  assert.equal(c.pending(), 1, 'one restart, not two');
  c.tick(1000);
  assert.equal(spawned.length, 2);
  spawned[0].emit('exit', 1, null); // the old child again
  assert.equal(c.pending(), 0);
  assert.equal(spawned.length, 2);
  assert.equal(gaveUp.length, 0);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
