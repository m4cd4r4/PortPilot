const { scanPorts, checkPort, findAvailablePort } = require('./portScanner');
const { startApp, stopApp, killProcess, killByPort, getRunningApps, getAppLogs } = require('./processManager');
const path = require('path');

/**
 * Match scanned ports to registered apps by analyzing command line and working directory
 * @param {Array} ports - Scanned port info
 * @param {Array} apps - Registered apps from config
 * @returns {Object} { matches: Map of appId -> detected port info, unknownConflicts: Array of port conflicts }
 */
function matchPortsToApps(ports, apps) {
  const matches = {};
  const matchedPorts = new Set(); // Track which ports have been matched to prevent duplicates
  const unknownConflicts = []; // Track ports with unknown processes blocking registered apps

  // Phase 1: High-confidence CWD matches (priority)
  for (const app of apps) {
    if (!app.cwd) continue;

    // Normalize paths for comparison
    const normalizedCwd = path.normalize(app.cwd).toLowerCase();
    const cwdWithForwardSlash = normalizedCwd.replace(/\\/g, '/');
    const cwdWithBackSlash = normalizedCwd.replace(/\//g, '\\');

    for (const portInfo of ports) {
      if (matchedPorts.has(portInfo.port)) continue; // Skip already matched ports

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
          // High-confidence match found
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
          matchedPorts.add(portInfo.port); // Mark port as matched
          break;
        }
      }
      if (matches[app.id]) break; // Found match, move to next app
    }
  }

  // Phase 2: Stricter preferredPort matches with CWD validation
  for (const app of apps) {
    if (matches[app.id]) continue; // Already matched in Phase 1
    if (!app.preferredPort) continue;

    const portInfo = ports.find(p => p.port === app.preferredPort);
    if (!portInfo || matchedPorts.has(portInfo.port)) continue; // Port not found or already matched

    const binding = portInfo.bindings?.[0] || portInfo;
    const cmdLower = (binding.commandLine || '').toLowerCase();
    const processLower = (binding.processName || '').toLowerCase();
    const appNameLower = app.name.toLowerCase();

    // Extract keywords from app name for better matching
    const appKeywords = app.name.toLowerCase()
      .replace(/[^a-z0-9]/gi, '')
      .split(/(?=[A-Z])/) // Split on capital letters (e.g., "AzurePrep" -> ["azure", "prep"])
      .filter(word => word.length > 3); // Only meaningful words

    // Check for CWD match (partial - just the folder name)
    let cwdMatch = false;
    if (app.cwd) {
      const normalizedCwd = path.normalize(app.cwd).toLowerCase();
      const cwdFolderName = path.basename(normalizedCwd);
      cwdMatch = cmdLower.includes(normalizedCwd) ||
                 cmdLower.includes(normalizedCwd.replace(/\\/g, '/')) ||
                 cmdLower.includes(cwdFolderName);
    }

    // Check for strong app name evidence in command or process
    const strongAppNameMatch =
      cmdLower.includes(appNameLower) ||
      appKeywords.some(keyword => cmdLower.includes(keyword) || processLower.includes(keyword));

    // STRICT MATCHING: Require CWD match OR strong app name match
    // Don't match just because it's a Node.js process
    const isConfidentMatch = cwdMatch || strongAppNameMatch;

    if (isConfidentMatch) {
      matches[app.id] = {
        port: portInfo.port,
        pid: binding.pid,
        address: binding.address,
        processName: binding.processName,
        commandLine: binding.commandLine,
        conflict: portInfo.conflict,
        matchType: cwdMatch ? 'preferredPort-cwd' : 'preferredPort-name',
        confidence: cwdMatch ? 'medium' : 'low'
      };
      matchedPorts.add(portInfo.port); // Mark port as matched
    } else {
      // Port is occupied but doesn't match this app - record as unknown conflict
      unknownConflicts.push({
        appId: app.id,
        appName: app.name,
        port: app.preferredPort,
        occupiedBy: {
          pid: binding.pid,
          processName: binding.processName,
          commandLine: binding.commandLine,
          address: binding.address
        }
      });
    }
  }

  return { matches, unknownConflicts };
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
      const { matches, unknownConflicts } = matchPortsToApps(ports, apps);
      return { success: true, ports, matches, unknownConflicts };
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

  // ============ Favorites Operations ============

  /** Toggle favorite status */
  ipcMain.handle('config:toggleFavorite', async (_, appId) => {
    try {
      const app = configStore.getApp(appId);
      if (!app) return { success: false, error: 'App not found' };

      app.isFavorite = !app.isFavorite;
      app.updatedAt = new Date().toISOString();

      const updated = configStore.saveApp(app);
      return { success: true, app: updated };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  /** Delete all apps */
  ipcMain.handle('config:deleteAllApps', async () => {
    try {
      const count = configStore.config.apps.length;
      configStore.config.apps = [];
      configStore.save();
      return { success: true, count };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ============ Window Management ============

  /** Auto-resize window based on app count (v1.6 feature) */
  ipcMain.handle('window:autoResize', async (_, appCount) => {
    try {
      const { BrowserWindow } = require('electron');
      const window = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];

      if (!window) return { success: false, error: 'No window found' };

      // Calculate required height (v1.6 compact design)
      const BASE_HEIGHT = 200;  // Header + tabs + padding
      const APP_CARD_HEIGHT = 45;  // Card (42px) + gap (3px)
      const SECTION_HEADER_HEIGHT = 30;  // Section header + margin
      const MAX_SECTIONS = 2;  // Favorites + Other Projects

      // Calculate total height
      const sectionsHeight = MAX_SECTIONS * SECTION_HEADER_HEIGHT;
      const cardsHeight = appCount * APP_CARD_HEIGHT;
      const calculatedHeight = BASE_HEIGHT + sectionsHeight + cardsHeight;

      // Constrain between min and max
      const MIN_HEIGHT = 400;
      const MAX_HEIGHT = 1200;
      const targetHeight = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, calculatedHeight));

      // Get current bounds
      const bounds = window.getBounds();

      // Smooth resize
      window.setBounds({
        ...bounds,
        height: targetHeight
      }, true);  // true = animate

      return { success: true, height: targetHeight, appCount };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ============ Discovery Operations ============

  /** Scan directories for projects */
  ipcMain.handle('discovery:scan', async (_, scanPaths) => {
    try {
      const { scanDirectories } = require('./projectScanner');
      const settings = configStore.getSettings();
      const paths = scanPaths || settings.discovery?.scanPaths || [];

      if (paths.length === 0) {
        return { success: true, projects: [], total: 0 };
      }

      const discovered = await scanDirectories(paths, {
        maxDepth: settings.discovery?.maxDepth || 2,
        ignorePatterns: settings.discovery?.ignorePatterns || []
      });

      // Filter out already registered apps (by cwd matching)
      const existingApps = configStore.getApps();
      const newProjects = discovered.filter(proj => {
        const normalizedPath = path.normalize(proj.path).toLowerCase();
        return !existingApps.some(app =>
          path.normalize(app.cwd).toLowerCase() === normalizedPath
        );
      });

      return { success: true, projects: newProjects, total: discovered.length };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  /** Add a scan path */
  ipcMain.handle('discovery:addScanPath', async (_, dirPath) => {
    try {
      const fs = require('fs');
      const settings = configStore.getSettings();
      const scanPaths = settings.discovery?.scanPaths || [];

      // Validate path exists
      if (!fs.existsSync(dirPath)) {
        return { success: false, error: 'Directory does not exist' };
      }

      // Normalize path
      const normalizedPath = path.normalize(dirPath);

      // Avoid duplicates
      if (scanPaths.some(p => path.normalize(p).toLowerCase() === normalizedPath.toLowerCase())) {
        return { success: false, error: 'Path already exists' };
      }

      scanPaths.push(normalizedPath);
      configStore.updateSettings({
        discovery: { ...settings.discovery, scanPaths }
      });

      return { success: true, scanPaths };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  /** Remove a scan path */
  ipcMain.handle('discovery:removeScanPath', async (_, dirPath) => {
    try {
      const settings = configStore.getSettings();
      const normalizedPath = path.normalize(dirPath);
      const scanPaths = (settings.discovery?.scanPaths || []).filter(p =>
        path.normalize(p).toLowerCase() !== normalizedPath.toLowerCase()
      );

      configStore.updateSettings({
        discovery: { ...settings.discovery, scanPaths }
      });

      return { success: true, scanPaths };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  /** Get discovery settings */
  ipcMain.handle('discovery:getSettings', async () => {
    try {
      const settings = configStore.getSettings();
      return { success: true, settings: settings.discovery || {} };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  /** Update discovery settings */
  ipcMain.handle('discovery:updateSettings', async (_, newSettings) => {
    try {
      const settings = configStore.getSettings();
      configStore.updateSettings({
        discovery: { ...settings.discovery, ...newSettings }
      });
      return { success: true };
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

  /** Browse for directory */
  ipcMain.handle('shell:browseDirectory', async () => {
    try {
      const { dialog, BrowserWindow } = require('electron');
      const result = await dialog.showOpenDialog(BrowserWindow.getFocusedWindow(), {
        properties: ['openDirectory']
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, canceled: true };
      }

      return { success: true, path: result.filePaths[0] };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  /** Detect project from a single directory */
  ipcMain.handle('discovery:detectProject', async (_, dirPath) => {
    try {
      const { detectProject } = require('./projectScanner');
      const project = await detectProject(dirPath);

      if (!project) {
        return { success: false, error: 'No project detected in this directory' };
      }

      return { success: true, project };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ============ Docker Operations ============

  /** Check if Docker Desktop is running */
  ipcMain.handle('docker:status', async () => {
    const { exec } = require('child_process');
    return new Promise((resolve) => {
      exec('docker info', { timeout: 5000 }, (error) => {
        resolve({ running: !error });
      });
    });
  });

  /** Start Docker Desktop */
  ipcMain.handle('docker:start', async () => {
    const { exec, spawn } = require('child_process');
    const os = require('os');

    return new Promise((resolve) => {
      if (os.platform() === 'win32') {
        // Use spawn with detached to start Docker without leaving a cmd window
        const dockerPath = 'C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe';
        const child = spawn(dockerPath, [], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true
        });
        child.unref();
        resolve({ success: true });
      } else if (os.platform() === 'darwin') {
        exec('open -a Docker', { timeout: 10000 }, (error) => {
          resolve(error ? { success: false, error: error.message } : { success: true });
        });
      } else {
        // Linux - systemd
        exec('systemctl start docker', { timeout: 10000 }, (error) => {
          resolve(error ? { success: false, error: error.message } : { success: true });
        });
      }
    });
  });
}

module.exports = { setupIpcHandlers };
