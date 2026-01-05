const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } = require('electron');
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
    if (!app.isPackaged) {
      const settings = configStore.getSettings();
      if (settings.openDevTools === true) {
        mainWindow.webContents.openDevTools();
      }
    }
  });

  // Minimize to tray instead of closing
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
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

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async (event) => {
  app.isQuitting = true;

  // Clean up any child processes started by PortPilot
  try {
    const { cleanupAllProcesses } = require('./processManager');
    await cleanupAllProcesses();
  } catch (err) {
    console.error('Error cleaning up processes:', err);
  }
});
