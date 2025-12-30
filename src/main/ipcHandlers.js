const { scanPorts, checkPort, findAvailablePort } = require('./portScanner');
const { startApp, stopApp, killProcess, killByPort, getRunningApps, getAppLogs } = require('./processManager');
const path = require('path');

/**
 * Match scanned ports to registered apps by analyzing command line and working directory
 * @param {Array} ports - Scanned port info
 * @param {Array} apps - Registered apps from config
 * @returns {Object} Map of appId -> detected port info
 */
function matchPortsToApps(ports, apps) {
  const matches = {};

  for (const app of apps) {
    if (!app.cwd) continue;

    // Normalize the app's cwd for comparison
    const normalizedCwd = path.normalize(app.cwd).toLowerCase();
    const cwdBasename = path.basename(normalizedCwd);

    for (const portInfo of ports) {
      const cmdLine = (portInfo.commandLine || '').toLowerCase();
      const processName = (portInfo.processName || '').toLowerCase();

      // Match strategies:
      // 1. CommandLine contains the full cwd path
      // 2. CommandLine contains the directory name and it's a node/npm process
      // 3. Check preferred port if it matches

      const cwdInCmd = cmdLine.includes(normalizedCwd.replace(/\\/g, '\\\\')) ||
                       cmdLine.includes(normalizedCwd.replace(/\\/g, '/'));

      const isNodeProcess = processName.includes('node') ||
                           processName.includes('npm') ||
                           processName.includes('python') ||
                           processName.includes('docker');

      const dirInCmd = cmdLine.includes(cwdBasename);

      // Primary match: full path in command line
      if (cwdInCmd) {
        matches[app.id] = {
          ...portInfo,
          matchType: 'cwd',
          confidence: 'high'
        };
        break;
      }

      // Secondary match: port matches preferred and it's the right type of process
      if (app.preferredPort === portInfo.port && isNodeProcess && dirInCmd) {
        matches[app.id] = {
          ...portInfo,
          matchType: 'port+dir',
          confidence: 'medium'
        };
        break;
      }

      // Tertiary match: just the preferred port and node process
      if (app.preferredPort === portInfo.port && isNodeProcess && !matches[app.id]) {
        matches[app.id] = {
          ...portInfo,
          matchType: 'port',
          confidence: 'low'
        };
      }
    }
  }

  return matches;
}

/**
 * Setup all IPC handlers for communication with renderer
 * @param {Electron.IpcMain} ipcMain
 * @param {ConfigStore} configStore
 */
function setupIpcHandlers(ipcMain, configStore) {

  // ============ Port Operations ============

  /** Scan all listening ports */
  ipcMain.handle('ports:scan', async () => {
    try {
      const ports = await scanPorts();
      return { success: true, ports };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  /** Scan ports and match to registered apps */
  ipcMain.handle('ports:scanWithApps', async () => {
    try {
      const ports = await scanPorts();
      const apps = configStore.getApps();
      const matches = matchPortsToApps(ports, apps);
      return { success: true, ports, matches };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  /** Check if specific port is in use */
  ipcMain.handle('ports:check', async (_, port) => {
    try {
      const result = await checkPort(port);
      return { success: true, inUse: !!result, info: result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  /** Find next available port */
  ipcMain.handle('ports:findAvailable', async (_, startPort, endPort) => {
    try {
      const port = await findAvailablePort(startPort, endPort);
      return { success: true, port };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  /** Kill process by port */
  ipcMain.handle('ports:kill', async (_, port) => {
    try {
      const result = await killByPort(port);
      return result;
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ============ Process Operations ============

  /** Kill process by PID */
  ipcMain.handle('process:kill', async (_, pid) => {
    try {
      const result = await killProcess(pid);
      return result;
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  /** Start an app */
  ipcMain.handle('process:start', async (_, appConfig) => {
    try {
      const result = await startApp(appConfig);
      return result;
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  /** Stop an app */
  ipcMain.handle('process:stop', async (_, appId) => {
    try {
      const result = await stopApp(appId);
      return result;
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  /** Get all running apps managed by PortPilot */
  ipcMain.handle('process:list', async () => {
    try {
      const apps = getRunningApps();
      return { success: true, apps };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  /** Get logs for an app */
  ipcMain.handle('process:logs', async (_, appId) => {
    try {
      const logs = getAppLogs(appId);
      return { success: true, ...logs };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ============ Config Operations ============

  /** Get all registered apps */
  ipcMain.handle('config:getApps', async () => {
    try {
      const apps = configStore.getApps();
      return { success: true, apps };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  /** Save an app config */
  ipcMain.handle('config:saveApp', async (_, appConfig) => {
    try {
      const app = configStore.saveApp(appConfig);
      return { success: true, app };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  /** Delete an app config */
  ipcMain.handle('config:deleteApp', async (_, appId) => {
    try {
      const deleted = configStore.deleteApp(appId);
      return { success: deleted, error: deleted ? null : 'App not found' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  /** Get settings */
  ipcMain.handle('config:getSettings', async () => {
    try {
      const settings = configStore.getSettings();
      return { success: true, settings };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  /** Update settings */
  ipcMain.handle('config:updateSettings', async (_, newSettings) => {
    try {
      const settings = configStore.updateSettings(newSettings);
      return { success: true, settings };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  /** Export config */
  ipcMain.handle('config:export', async () => {
    try {
      const data = configStore.export();
      return { success: true, data };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  /** Import config */
  ipcMain.handle('config:import', async (_, jsonString) => {
    try {
      const result = configStore.import(jsonString);
      return { success: result, error: result ? null : 'Invalid config format' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ============ Shell Operations ============

  /** Open URL in default browser */
  ipcMain.handle('shell:openExternal', async (_, url) => {
    try {
      const { shell } = require('electron');
      await shell.openExternal(url);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
}

module.exports = { setupIpcHandlers };
