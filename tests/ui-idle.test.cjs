// Polling stops while the window is hidden and catches up when it shows again.
// Ports sets system ports apart from the ones a dev server could own.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file).exports;
  const mod = { exports: {} };
  cache.set(file, mod);
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  new Function('require', 'module', 'exports', js)((id) => (id.startsWith('.') ? load(path.join(path.dirname(file), `${id}.ts`)) : require(id)), mod, mod.exports);
  return mod.exports;
}
const ui = path.join(__dirname, '../ui/src');
const { every } = load(path.join(ui, 'poll.ts'));
globalThis.PortPilotStatus = require('../src/core/status'); // in the app, ui/src/legacy.ts loads it
const { isSystemPort, isTempPort, splitPorts } = load(path.join(ui, 'portsModel.ts'));

let failed = 0;
function t(name, fn) {
  try { fn(); console.log(`✅ ${name}`); } catch (e) { failed++; console.log(`❌ ${name}\n     ${e.message}`); }
}

/** A window that can be hidden and shown, with a clock moved by hand. */
function fakeEnv(visible = true) {
  const timers = new Map();
  const subs = new Set();
  let next = 1;
  return {
    env: {
      visible: () => visible,
      onChange: (cb) => { subs.add(cb); return () => subs.delete(cb); },
      setInterval: (fn, ms) => { timers.set(next, { fn, ms }); return next++; },
      clearInterval: (id) => { timers.delete(id); },
    },
    tick: () => { for (const x of [...timers.values()]) x.fn(); },
    show: () => { visible = true; for (const cb of [...subs]) cb(); },
    hide: () => { visible = false; for (const cb of [...subs]) cb(); },
    timers: () => timers.size,
    subs: () => subs.size,
  };
}

console.log('\n=== ui/src/poll.ts ===\n');

t('a visible window polls on every tick', () => {
  const w = fakeEnv(); let n = 0;
  every(() => n++, 5000, w.env);
  w.tick(); w.tick();
  assert.strictEqual(n, 2);
});

t('a hidden window does not poll', () => {
  const w = fakeEnv(); let n = 0;
  every(() => n++, 5000, w.env);
  w.hide();
  w.tick(); w.tick();
  assert.strictEqual(n, 0);
  assert.strictEqual(w.timers(), 0);
});

t('showing the window reads once at once, then polls again', () => {
  const w = fakeEnv(); let n = 0;
  every(() => n++, 5000, w.env);
  w.hide(); w.show();
  assert.strictEqual(n, 1);
  w.tick();
  assert.strictEqual(n, 2);
  assert.strictEqual(w.timers(), 1);
});

t('a window that starts hidden waits until it is shown', () => {
  const w = fakeEnv(false); let n = 0;
  every(() => n++, 5000, w.env);
  w.tick();
  assert.strictEqual(n, 0);
  w.show();
  assert.strictEqual(n, 1);
});

t('two shows in a row do not start two timers', () => {
  const w = fakeEnv(); let n = 0;
  every(() => n++, 5000, w.env);
  w.show(); w.show();
  assert.strictEqual(w.timers(), 1);
});

t('stopping clears the timer and the listener, hidden or not', () => {
  const a = fakeEnv(); const stopA = every(() => {}, 1000, a.env); stopA();
  assert.deepStrictEqual([a.timers(), a.subs()], [0, 0]);
  const b = fakeEnv(); let n = 0; const stopB = every(() => n++, 1000, b.env); b.hide(); stopB(); b.show();
  assert.deepStrictEqual([b.timers(), b.subs(), n], [0, 0, 0]);
});

console.log('\n=== ui/src/portsModel.ts ===\n');

const p = (port, processName, pid = 100) => ({ port, processName, pid });

t('a port under 1024 or a Windows service process is a system port', () => {
  assert.strictEqual(isSystemPort(p(135, 'svchost.exe')), true);
  assert.strictEqual(isSystemPort(p(445, 'System')), true);
  assert.strictEqual(isSystemPort(p(80, 'nginx.exe')), true);
  assert.strictEqual(isSystemPort(p(49664, 'lsass.exe')), true);
  assert.strictEqual(isSystemPort(p(49669, 'services')), true);
});

t('system follows the shared model in src/core/status.js: its processes, ports and kernel pids', () => {
  assert.strictEqual(isSystemPort(p(2179, 'vmms.exe')), true);
  assert.strictEqual(isSystemPort(p(2179, 'vmms')), true);
  assert.strictEqual(isSystemPort(p(5353, 'chrome.exe')), true);
  assert.strictEqual(isSystemPort(p(5040, 'whatever.exe', 4)), true);
  assert.strictEqual(isSystemPort(p(2179, 'vmms.exe'), new Set([2179])), false);
});

t('a dev server, a database and an unnamed process are not system ports', () => {
  assert.strictEqual(isSystemPort(p(3000, 'node.exe')), false);
  assert.strictEqual(isSystemPort(p(5432, 'postgres.exe')), false);
  assert.strictEqual(isSystemPort(p(8080, undefined)), false);
});

t('a port a PortPilot app runs on is never a system port, whatever its number', () => {
  assert.strictEqual(isSystemPort(p(80, 'node.exe'), new Set([80])), false);
});

t('an unowned port at 49152 or above is a temporary port', () => {
  assert.strictEqual(isTempPort(p(49152, 'Code.exe')), true);
  assert.strictEqual(isTempPort(p(64013, undefined)), true);
  assert.strictEqual(isTempPort(p(49151, 'node.exe')), false);
  assert.strictEqual(isTempPort(p(3000, 'node.exe')), false);
});

t('a high port is not temporary when a PortPilot app runs on it or a system service holds it', () => {
  assert.strictEqual(isTempPort(p(53718, 'node.exe'), new Set([53718])), false);
  assert.strictEqual(isTempPort(p(49664, 'lsass.exe')), false);
  assert.strictEqual(isSystemPort(p(49664, 'lsass.exe')), true);
});

t('the list splits in three, each part in port order, no row in two parts', () => {
  const all = [p(60001, 'Code.exe'), p(5173, 'node.exe'), p(445, 'System'), p(3000, 'node.exe'), p(135, 'svchost.exe'), p(52000, 'node.exe'), p(49664, 'lsass.exe'), p(50000, 'brave.exe')];
  const { mine, temp, system } = splitPorts(all, new Set([52000]));
  assert.deepStrictEqual(mine.map((x) => x.port), [3000, 5173, 52000]);
  assert.deepStrictEqual(temp.map((x) => x.port), [50000, 60001]);
  assert.deepStrictEqual(system.map((x) => x.port), [135, 445, 49664]);
  assert.strictEqual(mine.length + temp.length + system.length, all.length);
});

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
