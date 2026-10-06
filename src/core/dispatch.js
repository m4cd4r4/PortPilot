/**
 * Transport-agnostic action dispatcher.
 *
 * Maps action strings (the same names the Electron preload uses as IPC channels)
 * to the underlying port/process/config/discovery operations, so a single core
 * can be driven by either the Electron IPC layer or the web agent's HTTP layer.
 *
 * Shell/window/tray actions (openExternal, browseDirectory, autoResize, tray)
 * are environment-specific and handled by each front-end, not here.
 */
const path = require('path');
const { exec } = require('child_process');
const fs = require('fs');

const { scanPorts, checkPort, findAvailablePort } = require('../main/portScanner');
const {
  startApp, stopApp, killProcess, killByPort, getRunningApps, getAppLogs
} = require('../main/processManager');
const { matchPortsToApps, getProcessDetails, detectWorktrees, detectStaleWorktrees } = require('../main/ipcHandlers');
const { probe } = require('../main/healthCheck');
const { shareInfo } = require('../main/shareInfo');
const reserver = require('../main/portReserver');

function createDispatcher(configStore) {
  const handlers = {
    // ---- Ports ----
    'ports:scan': async () => ({ success: true, ports: await scanPorts() }),
    'ports:scanWithApps': async () => {
      const ports = await scanPorts();
      const { matches, unknownConflicts } = matchPortsToApps(ports, configStore.getApps());
      return { success: true, ports, matches, unknownConflicts };
    },
    'ports:check': async (port) => {
      const result = await checkPort(port);
      return { success: true, inUse: !!result, info: result };
    },
    'ports:findAvailable': async (start, end) => ({ success: true, port: await findAvailablePort(start, end) }),
    'ports:kill': async (port) => killByPort(port),
    'ports:getDetails': async (pid, port) => {
      const safePid = parseInt(pid, 10);
      const safePort = parseInt(port, 10);
      if (!Number.isInteger(safePid) || safePid < 1 || safePid > 4194304) return { success: false, error: 'Invalid PID' };
      if (!Number.isInteger(safePort) || safePort < 1 || safePort > 65535) return { success: false, error: 'Invalid port' };
      return { success: true, details: await getProcessDetails(safePid, safePort) };
    },

    // ---- Processes ----
    'process:kill': async (pid) => killProcess(pid),
    'process:start': async (appConfig) => {
      // Free our own reservation first so the real app can bind the port.
      if (appConfig && appConfig.id) await reserver.release(appConfig.id);
      return startApp(appConfig);
    },
    'process:stop': async (appId) => {
      const result = await stopApp(appId);
      // Re-acquire the reservation if the app opted in.
      const app = configStore.getApp(appId);
      if (app && app.reservePort) await reserver.reserve(app);
      return result;
    },
    'process:list': async () => ({ success: true, apps: getRunningApps() }),
    'process:logs': async (appId) => ({ success: true, ...getAppLogs(appId) }),

    // ---- Config ----
    'config:getApps': async () => ({ success: true, apps: configStore.getApps() }),
    'config:saveApp': async (appConfig) => ({ success: true, app: configStore.saveApp(appConfig) }),
    'config:deleteApp': async (appId) => {
      const deleted = configStore.deleteApp(appId);
      return { success: deleted, error: deleted ? null : 'App not found' };
    },
    'config:toggleFavorite': async (appId) => {
      const app = configStore.patchApp(appId, a => ({ isFavorite: !a.isFavorite }));
      if (!app) return { success: false, error: 'App not found' };
      return { success: true, app };
    },
    'config:deleteAllApps': async () => {
      const count = configStore.clearApps();
      return { success: true, count };
    },
    'config:updateAppsOrder': async (appIds) => { configStore.updateAppsOrder(appIds); return { success: true }; },
    'config:getSettings': async () => ({ success: true, settings: configStore.getSettings() }),
    'config:updateSettings': async (newSettings) => ({ success: true, settings: configStore.updateSettings(newSettings) }),
    'config:export': async () => ({ success: true, data: configStore.export() }),
    'config:import': async (jsonString) => {
      const result = configStore.import(jsonString);
      return { success: result, error: result ? null : 'Invalid config format' };
    },
    'config:getGroups': async () => ({ success: true, groups: configStore.getGroups() }),
    'config:saveGroup': async (groupConfig) => ({ success: true, group: configStore.saveGroup(groupConfig) }),
    'config:deleteGroup': async (groupId) => { configStore.deleteGroup(groupId); return { success: true }; },

    // ---- Health ----
    'health:check': async (appId, port) => {
      const app = configStore.getApp(appId);
      if (!app) return { success: false, error: 'App not found' };
      const target = port || app.preferredPort;
      if (!target) return { success: true, appId, state: 'unknown' };
      const state = await probe(target, app.healthPath || '/');
      return { success: true, appId, port: target, state };
    },

    // ---- Share ----
    'net:shareInfo': async (port) => shareInfo(port),

    // ---- Port reservation ----
    'reserve:enable': async (appId) => {
      const app = configStore.patchApp(appId, a => (a.preferredPort ? { reservePort: true } : null));
      if (!app) return { success: false, error: 'App not found' };
      if (!app.preferredPort) return { success: false, error: 'App has no preferred port to reserve' };
      const running = getRunningApps().some(a => a.id === appId && a.running);
      const r = running ? { ok: true } : await reserver.reserve(app);
      if (!r.ok) return { success: false, error: `Port ${app.preferredPort} is already in use (${r.reason})` };
      return { success: true, reserved: !running };
    },
    'reserve:disable': async (appId) => {
      const app = configStore.patchApp(appId, { reservePort: false });
      if (!app) return { success: false, error: 'App not found' };
      await reserver.release(appId);
      return { success: true };
    },

    // ---- Worktrees ----
    'worktrees:detect': async (appId) => detectWorktrees(configStore, appId),
    'worktrees:stale': async () => detectStaleWorktrees(configStore),

    // ---- Discovery ----
    'discovery:scan': async (scanPaths) => {
      const { scanDirectories } = require('../main/projectScanner');
      const settings = configStore.getSettings();
      const paths = scanPaths || settings.discovery?.scanPaths || [];
      if (paths.length === 0) return { success: true, projects: [], total: 0 };
      const discovered = await scanDirectories(paths, {
        maxDepth: settings.discovery?.maxDepth || 2,
        ignorePatterns: settings.discovery?.ignorePatterns || []
      });
      const existingApps = configStore.getApps();
      const newProjects = discovered.filter(proj => {
        const normalizedPath = path.normalize(proj.path).toLowerCase();
        return !existingApps.some(app => path.normalize(app.cwd || '').toLowerCase() === normalizedPath);
      });
      return { success: true, projects: newProjects, total: discovered.length };
    },
    'discovery:addScanPath': async (dirPath) => {
      if (!fs.existsSync(dirPath)) return { success: false, error: 'Directory does not exist' };
      const normalizedPath = path.normalize(dirPath);
      return configStore.updateDiscovery((discovery) => {
        const scanPaths = discovery.scanPaths || [];
        if (scanPaths.some(p => path.normalize(p).toLowerCase() === normalizedPath.toLowerCase())) {
          return { success: false, error: 'Path already exists' };
        }
        discovery.scanPaths = [...scanPaths, normalizedPath];
        return { success: true, scanPaths: discovery.scanPaths };
      });
    },
    'discovery:removeScanPath': async (dirPath) => {
      const normalizedPath = path.normalize(dirPath);
      const scanPaths = configStore.updateDiscovery((discovery) => {
        discovery.scanPaths = (discovery.scanPaths || []).filter(p =>
          path.normalize(p).toLowerCase() !== normalizedPath.toLowerCase());
        return discovery.scanPaths;
      });
      return { success: true, scanPaths };
    },
    'discovery:getSettings': async () => ({ success: true, settings: configStore.getSettings().discovery || {} }),
    'discovery:updateSettings': async (newSettings) => {
      configStore.updateDiscovery((discovery) => { Object.assign(discovery, newSettings); });
      return { success: true };
    },
    'discovery:detectProject': async (dirPath) => {
      const { detectProject } = require('../main/projectScanner');
      const project = await detectProject(dirPath);
      if (!project) return { success: false, error: 'No project detected in this directory' };
      return { success: true, project };
    },

    // ---- Docker ----
    'docker:status': async () => new Promise((resolve) => {
      exec('docker info', { timeout: 5000 }, (error) => resolve({ running: !error }));
    }),
    'docker:start': async () => new Promise((resolve) => {
      const os = require('os');
      if (os.platform() === 'win32') {
        const { spawn } = require('child_process');
        const child = spawn('C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe', [], { detached: true, stdio: 'ignore', windowsHide: true });
        child.unref();
        resolve({ success: true });
      } else if (os.platform() === 'darwin') {
        exec('open -a Docker', { timeout: 10000 }, (error) => resolve(error ? { success: false, error: error.message } : { success: true }));
      } else {
        exec('systemctl start docker', { timeout: 10000 }, (error) => resolve(error ? { success: false, error: error.message } : { success: true }));
      }
    }),
  };

  /**
   * @param {string} action  one of the keys above
   * @param {Array}  args    positional arguments (as the preload passes them)
   */
  return async function dispatch(action, args = []) {
    const fn = handlers[action];
    if (!fn) return { success: false, error: `Unknown action: ${action}` };
    try {
      return await fn(...(Array.isArray(args) ? args : [args]));
    } catch (error) {
      return { success: false, error: error.message };
    }
  };
}

module.exports = { createDispatcher };
