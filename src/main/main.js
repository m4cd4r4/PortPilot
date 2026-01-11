const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, nativeTheme } = require('electron');
const path = require('path');
const { setupIpcHandlers } = require('./ipcHandlers');
const { ConfigStore } = require('./configStore');

let mainWindow = null;
let tray = null;

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
  
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show PortPilot',
      click: () => mainWindow.show()
    },
    {
      label: 'Scan Ports',
      click: () => mainWindow.webContents.send('trigger-scan')
    },
    { type: 'separator' },
    {
      label: 'Stop All Apps',
      click: async () => {
        try {
          const { cleanupAllProcesses } = require('./processManager');
          await cleanupAllProcesses();
          mainWindow.webContents.send('toast', {
            type: 'success',
            message: 'Stopped all running apps'
          });
        } catch (err) {
          console.error('Error stopping apps:', err);
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setToolTip('PortPilot - Port Manager');
  tray.setContextMenu(contextMenu);
  
  tray.on('click', () => {
    mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
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
