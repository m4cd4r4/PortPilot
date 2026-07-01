const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, nativeTheme, Notification } = require('electron');
const path = require('path');
const { setupIpcHandlers } = require('./ipcHandlers');
const { ConfigStore } = require('./configStore');

let mainWindow = null;
let tray = null;
let webAgent = null;  // opt-in loopback web agent (Option C), shares this process's configStore
let mcpServer = null; // shared HTTP MCP server: one process for every Claude session, vs one stdio child per session

/** Create the main application window */
function createWindow(configStore) {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 600,
    minHeight: 400,
    backgroundColor: '#1a1a1a', // Dark background to match app theme
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, '../../public/icon.png'),
    show: false
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    // Open DevTools if enabled in settings (dev mode only)
    if (!app.isPackaged && configStore) {
      const settings = configStore.getSettings();
      if (settings.openDevTools === true) {
        mainWindow.webContents.openDevTools();
      }
    }
  });

  // Handle close - either minimize to tray or exit completely
  mainWindow.on('close', (event) => {
    if (!configStore) return;
    const settings = configStore.getSettings();
    if (!app.isQuitting && settings.closeToTray !== false) {
      event.preventDefault();
      mainWindow.hide();
    }
    // If closeToTray is false, window closes normally
  });

  return mainWindow;
}

/** Build tray context menu - called on create and when running apps change */
function buildTrayMenu(runningApps = []) {
  const template = [
    { label: 'Show PortPilot', click: () => mainWindow?.show() },
    { label: 'Scan Ports', click: () => mainWindow?.webContents.send('trigger-scan') },
    { type: 'separator' }
  ];

  if (runningApps.length > 0) {
    template.push({ label: `Running (${runningApps.length})`, enabled: false });
    for (const runApp of runningApps) {
      template.push({
        label: `  ■ Stop ${runApp.name}`,
        click: async () => {
          try {
            const { stopApp } = require('./processManager');
            await stopApp(runApp.id);
          } catch (err) {
            console.error('Tray stop error:', err);
          }
        }
      });
    }
    template.push({ type: 'separator' });
  }

  template.push(
    {
      label: 'Stop All Apps',
      click: async () => {
        try {
          const { cleanupAllProcesses } = require('./processManager');
          await cleanupAllProcesses();
          mainWindow?.webContents.send('toast', { type: 'success', message: 'Stopped all running apps' });
        } catch (err) {
          console.error('Error stopping all apps:', err);
        }
      }
    },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } }
  );

  return Menu.buildFromTemplate(template);
}

/** Create system tray icon and menu */
function createTray() {
  // Create a simple tray icon (16x16 blue circle)
  const icon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAA' +
    'WElEQVQ4T2NkoBAwUqifYdQABqoHwv8GBob/DAwMjFDnMTIy/mdgZPwPFYdxkF0B0wRy' +
    'PkwvXAPMAAbeAIIGAmk/OGaEOQtdA7IngBqPHghUDwSqBwKtAwEAr4MXEZ3xnHsAAAAA' +
    'SUVORK5CYII='
  );

  tray = new Tray(icon);
  tray.setToolTip('PortPilot - Port Manager');
  tray.setContextMenu(buildTrayMenu([]));

  tray.on('click', () => {
    mainWindow?.isVisible() ? mainWindow.hide() : mainWindow?.show();
  });
}

// App lifecycle
let configStore;

// Detect if running in test mode (Playwright adds --remote-debugging-port)
const isTestMode = process.argv.some(arg => arg.includes('--remote-debugging-port'));

// Single instance lock - prevent multiple copies of PortPilot from running (skip in test mode)
const gotTheLock = isTestMode || app.requestSingleInstanceLock();

if (!gotTheLock) {
  // Another instance is already running, quit this one
  console.log('PortPilot is already running. Exiting duplicate instance.');
  app.quit();
} else {
  // We have the lock - this is the primary instance
  // Handle second-instance attempts by focusing our window
  if (!isTestMode) {
    app.on('second-instance', (event, commandLine, workingDirectory) => {
      // Someone tried to run a second instance, focus our window instead
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        if (!mainWindow.isVisible()) mainWindow.show();
        mainWindow.focus();
      }
    });
  }

  app.whenReady().then(() => {
    // Set dark mode for native title bar on Windows
    nativeTheme.themeSource = 'dark';

    // Create window first, then pass it to ConfigStore for file watching
    const window = createWindow(null);
    configStore = new ConfigStore(window);
    createTray();
    setupIpcHandlers(ipcMain, configStore);

    // Notify (OS notification + in-app toast) when a running app crashes.
    const { onAppCrash, getRunningApps } = require('./processManager');
    const reserver = require('./portReserver');
    onAppCrash(({ id, name, code }) => {
      if (configStore.getSettings().notifyOnCrash !== false) {
        const body = `${name} exited unexpectedly${code != null ? ` (code ${code})` : ''}.`;
        try {
          if (Notification.isSupported()) {
            new Notification({ title: 'PortPilot - app stopped', body }).show();
          }
        } catch (err) { console.error('Crash notification failed:', err); }
        mainWindow?.webContents.send('toast', { type: 'error', message: body });
      }
      // Re-acquire the port reservation the crashed app left behind.
      const app = configStore.getApp(id);
      if (app && app.reservePort) reserver.reserve(app);
    });

    // Hold reserved ports for opted-in, stopped apps at startup.
    reserver.sync(configStore.getApps(), (id) => getRunningApps().some(a => a.id === id && a.running))
      .catch((err) => console.error('Port reservation sync failed:', err));

    // Reflect the persisted "start on login" preference (default on). Packaged
    // only - in dev the exec path is electron.exe and would pollute startup.
    if (app.isPackaged) {
      try {
        app.setLoginItemSettings({ openAtLogin: configStore.getSettings().openAtLogin !== false });
      } catch (err) {
        console.error('Failed to apply login item settings:', err);
      }
    }

    // ============ Shared MCP HTTP server ============
    // One long-lived process serving every Claude session over HTTP, instead of
    // each session spawning its own stdio child. Register clients against
    // http://127.0.0.1:<port>/mcp (default 8788).
    // Forked via ELECTRON_RUN_AS_NODE so Electron's bundled Node runs the ESM
    // server (utilityProcess.fork can't load an ESM entry).
    try {
      const { fork } = require('child_process');
      const mcpEntry = app.isPackaged
        ? path.join(process.resourcesPath, 'mcp-server', 'index.js')
        : path.join(__dirname, '..', '..', 'mcp-server', 'index.js');
      const mcpPort = process.env.PORTPILOT_MCP_PORT || '8788';
      mcpServer = fork(mcpEntry, ['--port', mcpPort], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
      });
      mcpServer.on('error', (err) => console.error('MCP server failed to start:', err));
      mcpServer.on('exit', (code) => {
        if (code) console.error(`PortPilot MCP server exited with code ${code}`);
        mcpServer = null;
      });
      console.log(`PortPilot MCP HTTP server starting on port ${mcpPort}`);
    } catch (err) {
      console.error('Failed to start MCP HTTP server:', err);
    }

    // Tray update - renderer sends running apps list whenever state changes
    ipcMain.handle('tray:update', (event, runningApps) => {
      try {
        if (!tray) return { success: false };
        const apps = Array.isArray(runningApps) ? runningApps.slice(0, 20) : [];
        tray.setContextMenu(buildTrayMenu(apps));
        tray.setToolTip(apps.length > 0
          ? `PortPilot - ${apps.length} app${apps.length !== 1 ? 's' : ''} running`
          : 'PortPilot - Port Manager');
        return { success: true };
      } catch (err) {
        return { success: false, error: err.message };
      }
    });

    // ============ Web Agent (Option C: opt-in browser access) ============
    // Runs the loopback web agent IN-PROCESS, sharing this configStore and
    // process table, so apps started from the browser and the desktop are the
    // same. Off until the user enables it in Settings.
    ipcMain.handle('agent:status', () => (webAgent ? { running: true, ...webAgent.getInfo() } : { running: false }));

    ipcMain.handle('agent:start', async () => {
      try {
        if (webAgent) return { success: true, ...webAgent.getInfo() };
        const { createAgent, DEFAULT_PORT } = require('../agent/server');
        const { findAvailablePort } = require('./portScanner');
        // Auto-pick a free port from the default up, so a busy 7317 (e.g. a
        // standalone agent) doesn't dead-end the toggle. The returned info
        // carries the real URL, which the renderer shows.
        const port = (await findAvailablePort(DEFAULT_PORT)) || DEFAULT_PORT;
        webAgent = createAgent({ configStore, port });
        const info = await webAgent.start();
        return { success: true, ...info };
      } catch (err) {
        webAgent = null;
        return { success: false, error: err.code === 'EADDRINUSE' ? 'Port in use - set PORTPILOT_AGENT_PORT' : err.message };
      }
    });

    ipcMain.handle('agent:stop', async () => {
      try {
        if (webAgent) { await webAgent.stop(); webAgent = null; }
        return { success: true };
      } catch (err) {
        return { success: false, error: err.message };
      }
    });

    ipcMain.handle('agent:open', async () => {
      if (!webAgent) return { success: false, error: 'Agent not running' };
      const { shell } = require('electron');
      await shell.openExternal(webAgent.getInfo().url);
      return { success: true };
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        const window = createWindow(null);
        configStore.mainWindow = window;
      }
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async (event) => {
  app.isQuitting = true;

  // Drop all port reservations so we don't leave sockets held after exit.
  try { await require('./portReserver').releaseAll(); } catch (err) { console.error('Error releasing reservations:', err); }

  // Stop the web agent if it was enabled
  if (webAgent) {
    try { await webAgent.stop(); } catch (err) { console.error('Error stopping web agent:', err); }
    webAgent = null;
  }

  // Stop the shared MCP HTTP server
  if (mcpServer) {
    try { mcpServer.kill(); } catch (err) { console.error('Error stopping MCP server:', err); }
    mcpServer = null;
  }

  // Clean up child processes if enabled in settings
  if (configStore) {
    const settings = configStore.getSettings();
    if (settings.stopAppsOnQuit !== false) {
      try {
        const { cleanupAllProcesses } = require('./processManager');
        await cleanupAllProcesses();
        console.log('Stopped all PortPilot-managed apps');
      } catch (err) {
        console.error('Error cleaning up processes:', err);
      }
    }
  }
});
