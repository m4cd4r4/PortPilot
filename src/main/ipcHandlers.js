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

    // Normalize paths for comparison
    const normalizedCwd = path.normalize(app.cwd).toLowerCase();
    const cwdWithForwardSlash = normalizedCwd.replace(/\\/g, '/');
    const cwdWithBackSlash = normalizedCwd.replace(/\//g, '\\');

    for (const portInfo of ports) {
      // Check all bindings to find which one matches this app
      const allBindings = portInfo.bindings || [{
        pid: portInfo.pid,
        address: portInfo.address,
        commandLine: portInfo.commandLine,
        processName: portInfo.processName
      }];

      for (const binding of allBindings) {
        const cmdLower = (binding.commandLine || '').toLowerCase();
        const cwdInCmd = cmdLower.includes(cwdWithForwardSlash) ||
                         cmdLower.includes(cwdWithBackSlash) ||
                         cmdLower.includes(normalizedCwd);

        if (cwdInCmd) {
          // Return the specific binding that matched, with correct address
          matches[app.id] = {
            port: portInfo.port,
            pid: binding.pid,
            address: binding.address,
            processName: binding.processName,
            commandLine: binding.commandLine,
            conflict: portInfo.conflict,
            matchType: 'cwd',
            confidence: 'high'
          };
          break;
        }
      }
      if (matches[app.id]) break;
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
