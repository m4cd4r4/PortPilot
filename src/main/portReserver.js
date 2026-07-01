/**
 * Port reservation ("squatter" socket).
 *
 * Registering an app does not stop the OS handing its port to something else.
 * When an app opts in (reservePort), PortPilot holds a lightweight placeholder
 * server on the app's preferredPort while the app is stopped, so nothing else
 * can grab it. The instant the app starts, the placeholder is released so the
 * real dev server can bind. On stop/crash the placeholder is re-acquired.
 *
 * The placeholder refuses connections immediately - it exists only to occupy
 * the port. Binding on 0.0.0.0 blocks the port on every interface.
 */
const net = require('net');

// appId -> net.Server currently holding that app's port
const servers = new Map();

function isReserved(appId) {
  return servers.has(appId);
}

/**
 * Acquire the placeholder for an app. No-op unless the app opted in and has a
 * port. Resolves { ok, reason? } - ok:false when the port is already taken by
 * something else (EADDRINUSE) or the bind otherwise failed. Never throws.
 */
function reserve(app) {
  return new Promise((resolve) => {
    if (!app || !app.preferredPort || !app.reservePort) {
      return resolve({ ok: false, reason: 'not eligible' });
    }
    if (servers.has(app.id)) return resolve({ ok: true, already: true });

    const server = net.createServer((sock) => sock.destroy());
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };

    server.on('error', (err) => {
      servers.delete(app.id);
      done({ ok: false, reason: err.code || err.message });
    });
    server.listen(app.preferredPort, '0.0.0.0', () => {
      servers.set(app.id, server);
      done({ ok: true });
    });
  });
}

/** Release an app's placeholder (so the real app can bind the port). */
function release(appId) {
  return new Promise((resolve) => {
    const s = servers.get(appId);
    if (!s) return resolve({ ok: true, released: false });
    servers.delete(appId);
    try { s.close(() => resolve({ ok: true, released: true })); }
    catch { resolve({ ok: true, released: true }); }
  });
}

/** Release everything (e.g. on quit). */
async function releaseAll() {
  for (const id of [...servers.keys()]) await release(id);
}

/**
 * Reconcile reservations with current state: hold the port for every opted-in,
 * stopped app; release it for anything running or no longer opted in.
 * @param {Array} apps
 * @param {(appId:string)=>boolean} isRunning
 * @returns {Promise<{reserved:string[], failed:{id:string,reason:string}[]}>}
 */
async function sync(apps, isRunning) {
  const reserved = [];
  const failed = [];
  for (const app of apps || []) {
    const eligible = !!(app.preferredPort && app.reservePort);
    const running = isRunning(app.id);
    if (eligible && !running) {
      const r = await reserve(app);
      if (r.ok && !r.already) reserved.push(app.id);
      else if (!r.ok) failed.push({ id: app.id, reason: r.reason });
    } else {
      await release(app.id);
    }
  }
  return { reserved, failed };
}

module.exports = { reserve, release, releaseAll, sync, isReserved };
