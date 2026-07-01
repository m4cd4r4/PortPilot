/**
 * PortPilot demo seed - fictional, nautical-themed data for marketing
 * screenshots. Contains NO real project or client names, and no real
 * filesystem paths. Loading this before renderer.js installs a mock
 * window.portpilot backed by this data, so the real renderer renders a
 * curated showcase (nested worktrees, health states, a reserved port, a
 * live port conflict, groups) without a backend.
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

  const runningApps = Object.keys(running).map((id) => {
    const app = apps.find((a) => a.id === id);
    return { id, pid: running[id].pid, name: app.name, command: app.command, cwd: app.cwd, running: true, startTime: now, exitCode: null };
  });

  const matches = {};
  for (const id of Object.keys(running)) {
    matches[id] = { port: running[id].port, pid: running[id].pid, address: '127.0.0.1', processName: running[id].processName, commandLine: running[id].commandLine, conflict: false, matchType: 'preferredPort-cwd', confidence: 'high' };
  }

  // dockyard-docs (4321) is squatted by a foreign process -> conflict.
  const unknownConflicts = [
    { appId: 'a_docs', appName: 'dockyard-docs', port: 4321, occupiedBy: { processName: 'node.exe', pid: 9812 } },
  ];

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
      check: () => ok({ inUse: false }),
      findAvailable: () => ok({ port: 3004 }),
      kill: noop, getDetails: () => ok({ details: {} }),
    },
    process: {
      list: () => ok({ apps: runningApps }),
      start: noop, stop: noop, kill: noop, logs: () => ok({ stdout: '', stderr: '' }),
    },
    config: {
      getApps: () => ok({ apps }),
      getGroups: () => ok({ groups }),
      getSettings: () => ok({ settings }),
      updateSettings: () => ok({ settings }),
      saveApp: noop, deleteApp: noop, toggleFavorite: noop, deleteAllApps: noop,
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
    on: () => {},
    openExternal: noop,
    browseDirectory: () => ok({ canceled: true }),
  };
})();
