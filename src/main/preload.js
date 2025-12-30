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
    kill: (port) => ipcRenderer.invoke('ports:kill', port)
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
    getSettings: () => ipcRenderer.invoke('config:getSettings'),
    updateSettings: (settings) => ipcRenderer.invoke('config:updateSettings', settings),
    export: () => ipcRenderer.invoke('config:export'),
    import: (json) => ipcRenderer.invoke('config:import', json)
  },

  // Event listeners
  on: (channel, callback) => {
    const validChannels = ['trigger-scan'];
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (_, ...args) => callback(...args));
    }
  },

  // Shell operations
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),

  // Docker operations
  docker: {
    status: () => ipcRenderer.invoke('docker:status'),
    start: () => ipcRenderer.invoke('docker:start')
  }
});
