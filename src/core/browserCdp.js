/**
 * Chrome DevTools Protocol helpers for browser profiles (plan row 26).
 *
 * HTTP probes (/json/version, /json) and the few browser-level CDP calls the
 * profile runner needs: close, and move a window off-screen. The WebSocket calls
 * use Node's global WebSocket (Node 22+, Electron 44); where it is missing they
 * return null/false and the caller degrades. Zero dependencies.
 */

const PROBE_MS = 1500;
const CALL_MS = 8000;

async function getJson(port, route) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}${route}`, { signal: AbortSignal.timeout(PROBE_MS) });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

/** The browser's /json/version document, or null when nothing answers CDP there. */
const version = (port) => getJson(port, '/json/version');

/** Open page targets as [{ id, title, url }]; [] when CDP does not answer. */
async function pageTabs(port) {
  const list = await getJson(port, '/json');
  return (Array.isArray(list) ? list : [])
    .filter((t) => t.type === 'page')
    .map((t) => ({ id: t.id, title: t.title || '', url: t.url || '' }));
}

/**
 * Run fn(send) against the browser-level CDP endpoint; null when unavailable.
 * `send(method, params)` resolves with the CDP result or rejects with its error.
 */
async function withBrowserSession(port, fn) {
  if (typeof WebSocket !== 'function') return null;
  const v = await version(port);
  if (!v || !v.webSocketDebuggerUrl) return null;
  const ws = new WebSocket(v.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  // A hung browser can accept the connection and never finish the handshake; without a limit the
  // caller (stop, and the desktop's per-profile busy lock) would wait for it indefinitely.
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { try { ws.close(); } catch { /* not open */ } reject(new Error('CDP socket timed out')); }, CALL_MS);
    ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP socket error')); }, { once: true });
  });
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error.message)); else p.resolve(msg.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
    setTimeout(() => {
      if (pending.delete(mid)) reject(new Error(`${method} timed out`));
    }, CALL_MS);
  });
  try {
    return await fn(send);
  } finally {
    try { ws.close(); } catch { /* already gone */ }
  }
}

/** Ask the browser to quit cleanly. True if the request was accepted. */
async function closeBrowser(port) {
  try {
    const r = await withBrowserSession(port, (send) => send('Browser.close'));
    return r !== null;
  } catch {
    return false;
  }
}

/**
 * Move the first page's window to x=`left`. The OS may refuse (macOS keeps a window
 * on a screen), so read the bounds back: the answer is where the window really is.
 * @returns {Promise<{ parked: boolean, left: number|null }>}
 */
async function parkOffscreen(port, left) {
  try {
    const out = await withBrowserSession(port, async (send) => {
      const [tab] = await pageTabs(port);
      if (!tab) return null;
      const { windowId } = await send('Browser.getWindowForTarget', { targetId: tab.id });
      await send('Browser.setWindowBounds', {
        windowId,
        bounds: { left, top: 0, width: 1440, height: 900, windowState: 'normal' },
      });
      const { bounds } = await send('Browser.getWindowBounds', { windowId });
      return bounds.left;
    });
    if (out == null) return { parked: false, left: null };
    return { parked: Math.abs(out - left) < 100, left: out };
  } catch {
    return { parked: false, left: null };
  }
}

module.exports = { version, pageTabs, withBrowserSession, closeBrowser, parkOffscreen };
