/**
 * Keeps the shared MCP server child alive.
 *
 * Incident (code review, 2026-11-02): main.js only logged the child's exit and nulled the handle,
 * so a port clash at launch (EADDRINUSE exits 1 at once) or a kill from the Ports list left every
 * Claude session without PortPilot tools for the whole desktop session, with one console line.
 *
 * Pure apart from the injected `spawn`, `setTimeout` and `now`, so the policy is unit-tested
 * (tests/mcp-supervisor.test.cjs). Restarts with doubling delay, gives up after `maxRestarts`
 * quick deaths in a row (a child that lived `healthyMs` resets the budget) and reports that once.
 */
function createSupervisor({
  spawn, onChild, onGiveUp, log = () => {},
  maxRestarts = 5, baseDelayMs = 1000, healthyMs = 60000,
  setTimeout = global.setTimeout, clearTimeout = global.clearTimeout, now = Date.now,
}) {
  let child = null;
  let restarts = 0;
  let stopped = false;
  let timer = null;
  let startedAt = 0;

  // One death per child: 'error' (spawn failed) and 'exit' can both fire, and a throwing
  // spawn is a death with no child at all.
  function died(dead, code, signal) {
    if (child !== dead && dead !== null) return; // an old child's late event
    child = null;
    if (stopped) return;
    if (now() - startedAt >= healthyMs) restarts = 0;
    const why = `code ${code}${signal ? `, ${signal}` : ''}`;
    if (restarts >= maxRestarts) {
      log(`MCP server exited (${why}) after ${restarts} restarts; giving up`);
      if (onGiveUp) onGiveUp({ code, signal, restarts, pid: dead && dead.pid });
      return;
    }
    const delay = baseDelayMs * 2 ** restarts;
    restarts += 1;
    log(`MCP server exited (${why}); restart ${restarts}/${maxRestarts} in ${delay} ms`);
    timer = setTimeout(() => { timer = null; start(); }, delay);
  }

  function start() {
    if (stopped || child || timer) return;
    startedAt = now();
    let spawned;
    try {
      spawned = spawn();
    } catch (err) {
      log(`MCP server failed to spawn: ${err && err.message}`);
      died(null, -1, null);
      return;
    }
    child = spawned;
    if (onChild) onChild(spawned);
    let reported = false;
    const once = (code, signal) => { if (reported) return; reported = true; died(spawned, code, signal); };
    spawned.on('exit', once);
    spawned.on('error', (err) => once(err && err.code === 'ENOENT' ? -2 : -1, null));
  }

  function stop() {
    stopped = true;
    if (timer) { clearTimeout(timer); timer = null; }
    const c = child;
    child = null;
    if (c) { try { c.kill(); } catch { /* already gone */ } }
  }

  return { start, stop, get child() { return child; }, get restarts() { return restarts; } };
}

module.exports = { createSupervisor };
