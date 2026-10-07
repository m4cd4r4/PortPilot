/**
 * PortPilot demo seed - fictional, nautical-themed data for marketing
 * screenshots. Contains NO real project or client names, and no real
 * filesystem paths. Loading this before renderer.js installs a mock
 * window.portpilot backed by this data, so the real renderer renders a
 * curated showcase (nested worktrees, health states, a reserved port, a
 * live port conflict, a crashed app, a Claude-started app, groups) without
 * a backend.
 *
 * Reproduce a screenshot:
 *   serve src/renderer/index.html with this file executed first
 *   (e.g. via the chrome-devtools navigate initScript).
 */
(function () {
  const now = new Date('2026-07-01T06:00:00Z').toISOString();

  const groups = [
    { id: 'g_harbor', name: 'Harbor App', color: '#7aa2f7', expanded: true },
    { id: 'g_tools', name: 'Internal Tools', color: '#9ece6a', expanded: true },
  ];

  // name, command, cwd, port, group, parentId, branch, colour, flags
  const apps = [
    { id: 'a_web', name: 'harbor-web', command: 'npm run dev', cwd: 'C:/dev/harbor/web', preferredPort: 3000, group: 'g_harbor' },
    { id: 'a_web_checkout', name: 'harbor-web', command: 'npm run dev', cwd: 'C:/dev/harbor/web-checkout', preferredPort: 3002, group: 'g_harbor', parentId: 'a_web', branch: 'feat/checkout-drift', color: '#7aa2f7', colorSource: 'peacock' },
    { id: 'a_web_search', name: 'harbor-web', command: 'npm run dev', cwd: 'C:/dev/harbor/web-search', preferredPort: 3003, group: 'g_harbor', parentId: 'a_web', branch: 'feat/live-search', color: '#bb9af7', colorSource: 'peacock' },
    { id: 'a_api', name: 'tugboat-api', command: 'uvicorn main:app --reload', cwd: 'C:/dev/harbor/api', preferredPort: 8000, group: 'g_harbor' },
    { id: 'a_admin', name: 'lighthouse-admin', command: 'npm run dev', cwd: 'C:/dev/harbor/admin', preferredPort: 5173, group: 'g_harbor', reservePort: true },
    { id: 'a_gw', name: 'beacon-gateway', command: 'node server.js', cwd: 'C:/dev/tools/gateway', preferredPort: 4000, group: 'g_tools' },
    { id: 'a_docs', name: 'dockyard-docs', command: 'npm run dev', cwd: 'C:/dev/tools/docs', preferredPort: 4321, group: 'g_tools' },
    { id: 'a_metrics', name: 'anchor-metrics', command: 'python main.py', cwd: 'C:/dev/tools/metrics', preferredPort: 9090 },
    { id: 'a_preview', name: 'buoy-preview', command: 'uvicorn preview:app', cwd: 'C:/dev/harbor/preview', preferredPort: 8000, group: 'g_harbor' },
  ].map((a) => ({
    fallbackRange: null, env: {}, autoStart: false, isFavorite: false,
    description: null, startupDelay: null, parentId: null, branch: null,
    worktreePath: null, colorSource: null, color: '#7dcfff', healthPath: null,
    reservePort: false, createdAt: now, updatedAt: now, ...a,
  }));

  // Which apps are running (managed), and the detected port for each.
  const running = {
    a_web: { port: 3000, pid: 4101, processName: 'node.exe', commandLine: 'node next dev' },
    a_web_checkout: { port: 3002, pid: 4132, processName: 'node.exe', commandLine: 'node next dev' },
    a_web_search: { port: 3003, pid: 4140, processName: 'node.exe', commandLine: 'node next dev' },
    a_api: { port: 8000, pid: 4200, processName: 'python.exe', commandLine: 'uvicorn main:app' },
    a_gw: { port: 4000, pid: 4310, processName: 'node.exe', commandLine: 'node server.js' },
  };

  const health = { a_web: 'healthy', a_web_checkout: 'healthy', a_web_search: 'unhealthy', a_api: 'healthy', a_gw: 'healthy' };

  // Start times relative to page load, so the row state cell shows real uptimes.
  const ago = (sec) => new Date(Date.now() - sec * 1000).toISOString();
  const startedAgo = { a_web: 2 * 3600 + 14 * 60, a_web_checkout: 18 * 60, a_web_search: 41 * 60, a_api: 52 * 60, a_gw: 3 * 86400 + 600 };

  const runningApps = Object.keys(running).map((id) => {
    const app = apps.find((a) => a.id === id);
    return { id, pid: running[id].pid, name: app.name, command: app.command, cwd: app.cwd, running: true, startTime: ago(startedAgo[id]), exitCode: null, crashed: false };
  });
  // anchor-metrics started fine, then died on its own: a crash, not a stop.
  runningApps.push({ id: 'a_metrics', pid: 4420, name: 'anchor-metrics', command: 'python main.py', cwd: 'C:/dev/tools/metrics', running: false, startTime: ago(25 * 60), exitCode: 1, crashed: true });

  // Who started what (portpilot-runtime.json): Claude started the checkout
  // branch over MCP; the rest were started by hand.
  const runtime = {
    a_web: { startedBy: { kind: 'human', surface: 'desktop', at: ago(startedAgo.a_web) }, pid: 4101, port: 3000 },
    a_web_checkout: { startedBy: { kind: 'claude', surface: 'mcp', sessionId: 'a3f2c91e-demo', label: 'checkout drift fix', at: ago(startedAgo.a_web_checkout) }, pid: 4132, port: 3002 },
    a_api: { startedBy: { kind: 'human', surface: 'vscode', at: ago(startedAgo.a_api) }, pid: 4200, port: 8000 },
  };

  const matches = {};
  for (const id of Object.keys(running)) {
    matches[id] = { port: running[id].port, pid: running[id].pid, address: '127.0.0.1', processName: running[id].processName, commandLine: running[id].commandLine, conflict: false, matchType: 'preferredPort-cwd', confidence: 'high' };
  }

  // Two port conflicts, one of each kind the conflict strip describes:
  //   dockyard-docs (4321) is squatted by a foreign process -> "not managed".
  //   buoy-preview (8000) collides with tugboat-api, a registered app -> "Stop tugboat-api & start".
  const unknownConflicts = [
    { appId: 'a_docs', appName: 'dockyard-docs', port: 4321, occupiedBy: { processName: 'node.exe', pid: 9812, commandLine: 'node http-server' } },
    { appId: 'a_preview', appName: 'buoy-preview', port: 8000, occupiedBy: { processName: 'python.exe', pid: 4200, commandLine: 'uvicorn main:app' } },
  ];
  // Uptime (seconds) per listening pid, so the strip can say "started 3h ago".
  const uptimes = { 9812: 3 * 3600 + 540, 4200: 52 * 60 };

  const ports = [
    { port: 3000, pid: 4101, processName: 'node.exe', commandLine: 'node next dev', address: '127.0.0.1', appId: 'a_web' },
    { port: 3002, pid: 4132, processName: 'node.exe', commandLine: 'node next dev', address: '127.0.0.1', appId: 'a_web_checkout' },
    { port: 3003, pid: 4140, processName: 'node.exe', commandLine: 'node next dev', address: '127.0.0.1', appId: 'a_web_search' },
    { port: 8000, pid: 4200, processName: 'python.exe', commandLine: 'uvicorn main:app', address: '127.0.0.1', appId: 'a_api' },
    { port: 4000, pid: 4310, processName: 'node.exe', commandLine: 'node server.js', address: '127.0.0.1', appId: 'a_gw' },
    { port: 4321, pid: 9812, processName: 'node.exe', commandLine: 'node http-server', address: '127.0.0.1' },
    { port: 6006, pid: 5001, processName: 'node.exe', commandLine: 'storybook dev', address: '127.0.0.1' },
    { port: 5432, pid: 2200, processName: 'postgres.exe', commandLine: 'postgres', address: '127.0.0.1' },
    { port: 135, pid: 4, processName: 'System', commandLine: '', address: '0.0.0.0' },
    { port: 445, pid: 4, processName: 'System', commandLine: '', address: '0.0.0.0' },
  ];

  const settings = { autoScan: false, scanInterval: 5000, theme: 'tokyonight', closeToTray: true, stopAppsOnQuit: true, openAtLogin: true, autoResizeWindow: false, notifyOnCrash: true, favoritesExpanded: true, otherProjectsExpanded: true, discovery: {} };

  const ok = (extra) => Promise.resolve(Object.assign({ success: true }, extra));
  const noop = () => ok();

  window.portpilot = {
    ports: {
      scan: () => ok({ ports }),
      scanWithApps: () => ok({ ports, matches, unknownConflicts }),
      check: (port) => {
        const p = ports.find((x) => x.port === port);
        return ok(p ? { inUse: true, info: p } : { inUse: false });
      },
      findAvailable: (from, to) => {
        const taken = new Set(ports.map((p) => p.port));
        for (let n = from; n <= to; n++) if (!taken.has(n)) return ok({ port: n });
        return ok({ port: null });
      },
      kill: noop, getDetails: (pid) => ok({ details: { uptime: uptimes[pid] || null } }),
    },
    process: {
      list: () => ok({ apps: runningApps, runtime }),
      start: noop, stop: noop, kill: noop, logs: () => ok({ stdout: '', stderr: '' }),
    },
    config: {
      getApps: () => ok({ apps }),
      getGroups: () => ok({ groups }),
      getSettings: () => ok({ settings }),
      updateSettings: () => ok({ settings }),
      saveApp: noop, deleteApp: noop, toggleFavorite: noop, patchApp: noop, deleteAllApps: noop,
      updateAppsOrder: noop, export: () => ok({ data: '{}' }), import: noop,
      saveGroup: noop, deleteGroup: noop,
    },
    worktrees: { detect: () => ok({ candidates: [] }), stale: () => ok({ ids: [] }) },
    health: { check: (appId) => ok({ appId, state: health[appId] || 'down' }) },
    net: { shareInfo: () => ok({ localUrl: 'http://localhost:3000', lanUrl: 'http://192.168.1.24:3000', qrDataUrl: '' }) },
    reserve: { enable: noop, disable: noop },
    discovery: { scan: () => ok({ projects: [] }), detectProject: () => ok({ project: null }), getSettings: () => ok({ settings: {} }), addScanPath: noop, removeScanPath: noop, updateSettings: noop },
    docker: { status: () => Promise.resolve({ running: false }), start: noop },
    window: { autoResize: noop },
    tray: { update: noop },
    crash: { askClaude: () => ok({ short: 'b71c' }) },
    // The crash toast main.js would send when anchor-metrics dies, with a live
    // Claude session to hand it to (the shape crashAlert.buildCrashAlert makes).
    on: (channel, cb) => {
      if (channel !== 'crash-toast') return;
      setTimeout(() => cb({
        appId: 'a_metrics', name: 'anchor-metrics', title: 'anchor-metrics crashed 2x in 5m',
        meta: ':9090 · exit 1', count: 2, at: Date.now(),
        lines: [
          '  File "C:/dev/tools/metrics/main.py", line 42, in <module>',
          '    store = TideStore(os.environ["TIDE_DB_URL"])',
          "KeyError: 'TIDE_DB_URL'",
        ],
        session: { id: 'b71c9e04-demo', short: 'b71c', reason: 'owner' },
      }), 400);
    },
    openExternal: noop,
    browseDirectory: () => ok({ canceled: true }),
  };
})();
