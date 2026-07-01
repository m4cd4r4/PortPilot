/**
 * Web shim for window.portpilot.
 *
 * Implements the exact same surface the Electron preload exposes, but backed by
 * fetch() calls to the local agent's /api endpoint. Loaded BEFORE renderer.js so
 * the existing renderer runs in a browser unchanged.
 *
 * The per-session token is read from the <meta name="pp-token"> tag the agent
 * injects into this same-origin page (a cross-origin page cannot read it). It is
 * sent as a custom header, which also forces a CORS preflight on every call.
 */
(function () {
  const TOKEN = document.querySelector('meta[name="pp-token"]')?.content || '';

  const sseListeners = {};
  let eventSource = null;
  function ensureEventSource() {
    if (eventSource) return;
    // EventSource can't set headers, so the token rides in the query string.
    // The endpoint still validates Host + Origin + token server-side.
    eventSource = new EventSource('/events?token=' + encodeURIComponent(TOKEN));
    eventSource.addEventListener('config-changed', (e) => {
      let data = {};
      try { data = JSON.parse(e.data); } catch { /* ignore */ }
      (sseListeners['config-changed'] || []).forEach((cb) => { try { cb(data); } catch { /* ignore */ } });
    });
    eventSource.onerror = () => { /* browser auto-reconnects */ };
  }

  async function call(action, ...args) {
    const res = await fetch('/api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-PortPilot-Token': TOKEN },
      body: JSON.stringify({ action, args })
    });
    if (!res.ok) {
      let msg = `Agent error ${res.status}`;
      try { msg = (await res.json()).error || msg; } catch { /* ignore */ }
      throw new Error(msg);
    }
    return res.json();
  }

  window.portpilot = {
    ports: {
      scan: () => call('ports:scan'),
      scanWithApps: () => call('ports:scanWithApps'),
      check: (port) => call('ports:check', port),
      findAvailable: (start, end) => call('ports:findAvailable', start, end),
      kill: (port) => call('ports:kill', port),
      getDetails: (pid, port) => call('ports:getDetails', pid, port)
    },
    process: {
      kill: (pid) => call('process:kill', pid),
      start: (appConfig) => call('process:start', appConfig),
      stop: (appId) => call('process:stop', appId),
      list: () => call('process:list'),
      logs: (appId) => call('process:logs', appId)
    },
    config: {
      getApps: () => call('config:getApps'),
      saveApp: (appConfig) => call('config:saveApp', appConfig),
      deleteApp: (appId) => call('config:deleteApp', appId),
      toggleFavorite: (appId) => call('config:toggleFavorite', appId),
      deleteAllApps: () => call('config:deleteAllApps'),
      updateAppsOrder: (appIds) => call('config:updateAppsOrder', appIds),
      getSettings: () => call('config:getSettings'),
      updateSettings: (settings) => call('config:updateSettings', settings),
      export: () => call('config:export'),
      import: (json) => call('config:import', json),
      getGroups: () => call('config:getGroups'),
      saveGroup: (group) => call('config:saveGroup', group),
      deleteGroup: (groupId) => call('config:deleteGroup', groupId)
    },
    worktrees: {
      detect: (appId) => call('worktrees:detect', appId),
      stale: () => call('worktrees:stale')
    },
    health: {
      check: (appId, port) => call('health:check', appId, port)
    },
    net: {
      shareInfo: (port) => call('net:shareInfo', port)
    },
    discovery: {
      scan: (scanPaths) => call('discovery:scan', scanPaths),
      addScanPath: (p) => call('discovery:addScanPath', p),
      removeScanPath: (p) => call('discovery:removeScanPath', p),
      getSettings: () => call('discovery:getSettings'),
      updateSettings: (settings) => call('discovery:updateSettings', settings),
      detectProject: (dirPath) => call('discovery:detectProject', dirPath)
    },
    docker: {
      status: () => call('docker:status'),
      start: () => call('docker:start')
    },

    // Live updates via Server-Sent Events. The renderer subscribes to
    // 'config-changed'; we lazily open one EventSource and fan events out.
    on: (channel, cb) => {
      if (!sseListeners[channel]) sseListeners[channel] = [];
      sseListeners[channel].push(cb);
      ensureEventSource();
    },

    // Open links in a new browser tab.
    openExternal: (url) => { window.open(url, '_blank', 'noopener'); return Promise.resolve({ success: true }); },

    // No native folder picker in a browser - prompt for the path so
    // Browse & Auto-detect still works (the agent runs detection server-side).
    browseDirectory: () => {
      const p = window.prompt('Enter the project folder path to auto-detect:');
      return Promise.resolve(p ? { success: true, path: p } : { success: false, canceled: true });
    },

    // No-ops in the web build (window chrome / tray are desktop-only).
    window: { autoResize: () => Promise.resolve({ success: true }) },
    tray: { update: () => Promise.resolve({ success: true }) }
  };
})();
