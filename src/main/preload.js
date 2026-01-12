const { contextBridge, ipcRenderer } = require('electron');

/**
 * Expose protected methods to renderer via contextBridge
 * This maintains security while allowing IPC communication
 */
contextBridge.exposeInMainWorld('portpilot', {
  // Port operations
  ports: {
    scan: () => ipcRenderer.invoke('ports:scan'),
    scanWithApps: () => ipcRenderer.invoke('ports:scanWithApps'),
    check: (port) => ipcRenderer.invoke('ports:check', port),
    findAvailable: (start, end) => ipcRenderer.invoke('ports:findAvailable', start, end),
    kill: (port) => ipcRenderer.invoke('ports:kill', port),
    getDetails: (pid, port) => ipcRenderer.invoke('ports:getDetails', pid, port)
  },

  // Process operations
  process: {
    kill: (pid) => ipcRenderer.invoke('process:kill', pid),
    start: (appConfig) => ipcRenderer.invoke('process:start', appConfig),
    stop: (appId) => ipcRenderer.invoke('process:stop', appId),
    list: () => ipcRenderer.invoke('process:list'),
    logs: (appId) => ipcRenderer.invoke('process:logs', appId)
  },

  // Config operations
  config: {
    getApps: () => ipcRenderer.invoke('config:getApps'),
    saveApp: (appConfig) => ipcRenderer.invoke('config:saveApp', appConfig),
    deleteApp: (appId) => ipcRenderer.invoke('config:deleteApp', appId),
    toggleFavorite: (appId) => ipcRenderer.invoke('config:toggleFavorite', appId),
    deleteAllApps: () => ipcRenderer.invoke('config:deleteAllApps'),
    updateAppsOrder: (appIds) => ipcRenderer.invoke('config:updateAppsOrder', appIds),
    getSettings: () => ipcRenderer.invoke('config:getSettings'),
    updateSettings: (settings) => ipcRenderer.invoke('config:updateSettings', settings),
    export: () => ipcRenderer.invoke('config:export'),
    import: (json) => ipcRenderer.invoke('config:import', json)
  },

  // Discovery operations
  discovery: {
    scan: (scanPaths) => ipcRenderer.invoke('discovery:scan', scanPaths),
    addScanPath: (path) => ipcRenderer.invoke('discovery:addScanPath', path),
    removeScanPath: (path) => ipcRenderer.invoke('discovery:removeScanPath', path),
    getSettings: () => ipcRenderer.invoke('discovery:getSettings'),
    updateSettings: (settings) => ipcRenderer.invoke('discovery:updateSettings', settings),
    detectProject: (dirPath) => ipcRenderer.invoke('discovery:detectProject', dirPath)
  },

  // Event listeners
  on: (channel, callback) => {
    const validChannels = ['trigger-scan', 'config-changed'];
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (_, ...args) => callback(...args));
    }
  },

  // Shell operations
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  browseDirectory: () => ipcRenderer.invoke('shell:browseDirectory'),

  // Docker operations
  docker: {
    status: () => ipcRenderer.invoke('docker:status'),
    start: () => ipcRenderer.invoke('docker:start')
  },

  // Window operations
  window: {
    autoResize: (appCount) => ipcRenderer.invoke('window:autoResize', appCount)
  }
});
