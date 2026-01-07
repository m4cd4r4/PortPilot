const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, nativeTheme } = require('electron');
const path = require('path');
const { setupIpcHandlers } = require('./ipcHandlers');
const { ConfigStore } = require('./configStore');

// Force dark mode for window frame/titlebar
nativeTheme.themeSource = 'dark';

let mainWindow = null;
let tray = null;

/** Create the main application window */
function createWindow(configStore) {
  const isWindows = process.platform === 'win32';

  const windowConfig = {
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
  };

  // Windows-specific dark titlebar (Windows 10/11)
  if (isWindows) {
    windowConfig.titleBarStyle = 'hidden';
    windowConfig.titleBarOverlay = {
      color: '#1a1a1a',
      symbolColor: '#ffffff',
      height: 32
    };
  }

  mainWindow = new BrowserWindow(windowConfig);

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    // Open DevTools if enabled in settings (dev mode only)
    if (!app.isPackaged) {
      const settings = configStore.getSettings();
      if (settings.openDevTools === true) {
        mainWindow.webContents.openDevTools();
      }
    }
  });

  // Handle close - either minimize to tray or exit completely
  mainWindow.on('close', (event) => {
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

// Single instance lock - prevent multiple copies of PortPilot from running
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  // Another instance is already running, quit this one
  console.log('PortPilot is already running. Exiting duplicate instance.');
  app.quit();
} else {
  // We have the lock - this is the primary instance
  // Handle second-instance attempts by focusing our window
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // Someone tried to run a second instance, focus our window instead
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    configStore = new ConfigStore();
    createWindow(configStore);
    createTray();
    setupIpcHandlers(ipcMain, configStore);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow(configStore);
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
});
