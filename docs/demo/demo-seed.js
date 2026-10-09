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

  // ---- Run history (the History tab) ----
  // Fictional runs, newest first once sorted. Two are live (their apps are in
  // `running`: harbor-web x2 and tugboat-api), one crashed and pinned, one has no git, one is a re-run.
  const thumbSvg = (bg, bar, accent) => 'data:image/svg+xml;utf8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="300" viewBox="0 0 480 300">`
    + `<rect width="480" height="300" fill="${bg}"/><rect width="480" height="34" fill="${bar}"/>`
    + `<circle cx="18" cy="17" r="5" fill="${accent}"/><rect x="40" y="12" width="120" height="10" rx="5" fill="${accent}" opacity=".6"/>`
    + `<rect x="32" y="64" width="250" height="26" rx="6" fill="${accent}"/><rect x="32" y="104" width="400" height="10" rx="5" fill="${bar}"/>`
    + `<rect x="32" y="124" width="340" height="10" rx="5" fill="${bar}"/>`
    + `<rect x="32" y="168" width="124" height="96" rx="8" fill="${bar}"/><rect x="178" y="168" width="124" height="96" rx="8" fill="${bar}"/>`
    + `<rect x="324" y="168" width="124" height="96" rx="8" fill="${bar}"/></svg>`);
  const mins = (m) => ago(m * 60);
  const run = (o) => ({
    repoRoot: o.cwd, relCwd: '', url: o.port ? `http://localhost:${o.port}/` : null, stoppedAt: null, endedBy: null,
    exitCode: null, page: null, pinned: false, ...o,
  });
  const gitOf = (branch, sha, subject, files = []) => ({ branch, sha, subject, dirty: files.length > 0, files, snapshot: files.length ? { ref: `refs/portpilot/runs/${sha.slice(0, 7)}`, commit: sha, bytes: 12000 } : null, skipped: null });
  const human = (at) => ({ kind: 'human', surface: 'desktop', at });
  const historyRuns = [
    run({ id: 'r_demo01', appId: 'a_web', appName: 'harbor-web', cwd: 'C:/dev/harbor/web', command: 'npm run dev', port: 3000, startedBy: human(mins(134)), startedAt: mins(134),
      git: gitOf('main', '4be07c1aa91d', 'chore: bump deps', ['src/app/page.tsx', 'src/lib/cart.ts']), page: { title: 'Harbor - Home', thumb: 'thumbs/r_demo01.jpg' } }),
    run({ id: 'r_demo02', appId: 'a_web_checkout', appName: 'harbor-web', cwd: 'C:/dev/harbor/web-checkout', command: 'npm run dev', port: 3002,
      startedBy: { kind: 'claude', surface: 'mcp', sessionId: 'a3f2c91e-demo', label: 'checkout drift fix', at: mins(18) }, startedAt: mins(18),
      git: gitOf('feat/checkout-drift', '9c41e0a73b2f', 'wip: checkout layout', ['src/pages/checkout.tsx', 'public/mock/checkout-v2.html', 'src/styles/checkout.css']), page: { title: 'Checkout - Harbor', thumb: 'thumbs/r_demo02.jpg' } }),
    run({ id: 'r_demo03', appId: 'a_api', appName: 'tugboat-api', cwd: 'C:/dev/harbor/api', command: 'uvicorn main:app --reload', port: 8000, startedBy: human(mins(52)), startedAt: mins(52),
      git: gitOf('main', '77d0e12c4a90', 'fix: tide table rounding') }),
    run({ id: 'r_demo04', appId: 'a_metrics', appName: 'anchor-metrics', cwd: 'C:/dev/tools/metrics', command: 'python main.py', port: 9090, startedBy: human(mins(210)), startedAt: mins(210),
      stoppedAt: mins(205), endedBy: 'crash', exitCode: 1, pinned: true, git: gitOf('main', 'e5a1b30f9c11', 'feat: tide store', ['main.py']) }),
    run({ id: 'r_demo05', appId: 'a_docs', appName: 'dockyard-docs', cwd: 'C:/dev/tools/docs', command: 'npm run dev', port: 4321, startedBy: human(mins(60 * 26)), startedAt: mins(60 * 26),
      stoppedAt: mins(60 * 25), endedBy: 'stop', rerunOf: 'r_demo09', git: gitOf('docs/ports-page', '3a9f6c20d7e4', 'docs: ports page'), page: { title: 'Dockyard Docs', thumb: 'thumbs/r_demo05.jpg' } }),
    run({ id: 'r_demo06', appId: 'a_admin', appName: 'lighthouse-admin', cwd: 'C:/dev/harbor/admin', command: 'npm run dev', port: 5173,
      startedBy: { kind: 'claude', surface: 'mcp', sessionId: 'b71c9e04-demo', at: mins(60 * 30) }, startedAt: mins(60 * 30), stoppedAt: mins(60 * 29), endedBy: 'stop',
      git: gitOf('release/2.4', 'c08d4417be52', 'release: 2.4.0 candidate', ['package.json']), page: { title: 'Lighthouse - Sign in', thumb: 'thumbs/r_demo06.jpg' } }),
    run({ id: 'r_demo07', appId: 'a_gw', appName: 'beacon-gateway', cwd: 'C:/dev/tools/gateway', command: 'node server.js', port: 4000, startedBy: human(mins(60 * 52)), startedAt: mins(60 * 52),
      stoppedAt: mins(60 * 50), endedBy: 'unknown', git: null }),
    run({ id: 'r_demo08', appId: 'a_web', appName: 'harbor-web', cwd: 'C:/dev/harbor/web', command: 'npm run dev', port: 3000, startedBy: human(mins(60 * 75)), startedAt: mins(60 * 75),
      stoppedAt: mins(60 * 73), endedBy: 'stop', git: gitOf('feat/live-search', '1f7b9d03a6c8', 'feat: live search box'), page: { title: 'Harbor - Search', thumb: 'thumbs/r_demo08.jpg' } }),
  ];
  const historyThumbs = {
    r_demo01: thumbSvg('#1a1b26', '#24283b', '#7aa2f7'), r_demo02: thumbSvg('#1f2335', '#2f3549', '#bb9af7'),
    r_demo05: thumbSvg('#16161e', '#292e42', '#9ece6a'), r_demo06: thumbSvg('#1a1b26', '#2a2f45', '#e0af68'),
    r_demo08: thumbSvg('#1f2335', '#2f3549', '#7dcfff'),
  };
  const liveRunIds = ['r_demo01', 'r_demo02', 'r_demo03'];
  const progressListeners = [];
  const history = {
    list: () => ok({ runs: historyRuns, live: liveRunIds, stats: { runs: 312, bytes: 41 * 1024 * 1024, maxBytes: 150 * 1024 * 1024 } }),
    thumbs: (ids) => ok({ thumbs: Object.fromEntries((ids || []).filter((id) => historyThumbs[id]).map((id) => [id, historyThumbs[id]])) }),
    // Same rule as runView.rowThumbs: the newest open run per app, if it has a thumb.
    rowThumbs: () => ok({ byApp: Object.fromEntries(historyRuns.filter((r) => !r.stoppedAt && r.page && r.page.thumb).map((r) => [r.appId, { id: r.id, thumb: r.page.thumb, port: r.port ?? null }])) }),
    pin: (id, pinned) => { const r = historyRuns.find((x) => x.id === id); if (r) r.pinned = !!pinned; return ok(); },
    rerun: (id) => new Promise((resolve) => {
      ['checking', 'worktree', 'install', 'register', 'start', 'done'].forEach((stage, i) => {
        setTimeout(() => progressListeners.forEach((cb) => cb({ runId: id, stage, line: stage === 'install' ? 'added 412 packages' : undefined })), 300 * i);
      });
      setTimeout(() => resolve({ success: true, port: 3004, appId: 'a_rerun' }), 1800);
    }),
  };

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
    history,
    on: (channel, cb) => {
      if (channel === 'history-progress') { progressListeners.push(cb); return; }
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
