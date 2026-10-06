const fs = require('fs');
const path = require('path');
const { getConfigPath } = require('../core/configPath');
const { readJson, writeJsonAtomic, withLock, updateJson } = require('../core/configFile');

/**
 * ConfigStore - Manages persistent app configurations
 */
class ConfigStore {
  constructor(mainWindow = null, configPathOverride = null) {
    // Resolve via the shared helper so the desktop app, MCP server and web agent
    // all land on the same file (works with or without Electron).
    this.configPath = configPathOverride || getConfigPath();
    this.config = this.load();
    this.mainWindow = mainWindow;
    this.watchConfigFile();
  }

  /**
   * Watch config file for external changes (e.g., from MCP)
   */
  watchConfigFile() {
    let debounceTimer = null;

    // Ensure config file exists before watching
    if (!fs.existsSync(this.configPath)) {
      try {
        this.update(() => {}); // Create initial config file (locked, so a concurrent first write is not clobbered)
      } catch (error) {
        // Not fatal: the first real write creates it, and the directory watch below still works.
        console.error('[ConfigStore] Failed to create initial config file:', error.message);
      }
    }

    // Watch the directory, not the file: writers replace the file by rename, and
    // on Linux a file watch follows the old inode and goes silent after the
    // first replace. Filter to our filename (null = platform didn't say).
    const base = path.basename(this.configPath);
    try {
      this.watcher = fs.watch(path.dirname(this.configPath), (eventType, filename) => {
        if (!filename || filename.toString() === base) {
          // Debounce to avoid multiple rapid reloads
          clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            console.log('[ConfigStore] Detected external config change, reloading...');
            const oldConfig = JSON.stringify(this.config);
            this.config = this.load();
            const newConfig = JSON.stringify(this.config);

            // Only notify if config actually changed
            if (oldConfig !== newConfig) {
              const payload = { apps: this.config.apps, settings: this.config.settings };
              if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                this.mainWindow.webContents.send('config-changed', payload);
              }
              // Optional transport-agnostic listener (e.g. the web agent's SSE broadcast)
              if (typeof this.onConfigChange === 'function') {
                try { this.onConfigChange(payload); } catch (e) { console.error('onConfigChange failed:', e.message); }
              }
            }
          }, 100); // 100ms debounce
        }
      });
      console.log('[ConfigStore] Watching config file for changes');
    } catch (error) {
      console.error('[ConfigStore] Failed to watch config file:', error);
    }
  }

  /** Stop watching the config file */
  close() {
    if (this.watcher) this.watcher.close();
    this.watcher = null;
  }

  /** Load config from disk */
  load() {
    return readJson(this.configPath, () => this.defaultConfig());
  }

  /**
   * Locked read-modify-write against the file on disk, so a change another
   * process (MCP, agent, extension) made since our last load is not
   * overwritten. The mutator edits the fresh config in place; its return value
   * is returned.
   */
  update(mutator) {
    const { config, result } = updateJson(this.configPath, mutator, () => this.defaultConfig());
    this.config = config;
    return result;
  }

  defaultConfig() {
    return {
      apps: [],
      groups: [],
      settings: {
        startMinimized: false,
        autoScan: true,
        scanInterval: 5000,
        theme: 'dark',

        // Window behavior
        closeToTray: true,  // Close button minimizes to tray (true) or exits (false)
        stopAppsOnQuit: true,  // Stop PortPilot-managed apps when quitting
        openAtLogin: true,  // Start PortPilot (and the shared MCP server) at login
        autoResizeWindow: false,  // Auto-grow/shrink window height to app count (off by default - it fights manual resizing)
        notifyOnCrash: true,  // OS notification + toast when a running app exits unexpectedly

        // Favorites system
        favoritesExpanded: true,
        otherProjectsExpanded: true,

        // Project discovery
        discovery: {
          scanPaths: [],
          maxDepth: 2,
          autoScanOnStartup: false,
          ignorePatterns: ['node_modules', '.git', 'dist', 'build', 'venv', '__pycache__', 'target', 'bin', 'obj'],
          enabledDetectors: ['node', 'docker', 'python', 'static']
        }
      }
    };
  }

  /** Save config to disk */
  save() {
    try {
      withLock(this.configPath, () => writeJsonAtomic(this.configPath, this.config));
      return true;
    } catch (error) {
      console.error('Failed to save config:', error);
      return false;
    }
  }

  /** Get all registered apps */
  getApps() {
    return this.config.apps || [];
  }

  /** Get a single app by ID */
  getApp(id) {
    return this.config.apps.find(app => app.id === id);
  }

  /**
   * Add or update an app configuration
   * @param {Object} appConfig - App configuration object
   */
  saveApp(appConfig) {
    // Ensure required fields
    if (!appConfig.name || !appConfig.command) {
      throw new Error('App must have name and command');
    }

    // Generate ID if not provided
    if (!appConfig.id) {
      appConfig.id = `app_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    return this.update((config) => {
      if (!config.apps) config.apps = [];
      const existingIndex = config.apps.findIndex(a => a.id === appConfig.id);
      const app = this.buildApp(appConfig, existingIndex >= 0 ? config.apps[existingIndex] : {});
      if (existingIndex >= 0) {
        config.apps[existingIndex] = app;
      } else {
        config.apps.push(app);
      }
      return app;
    });
  }

  buildApp(appConfig, existing) {
    // Merge onto the existing record so fields the caller didn't supply
    // (e.g. `description` from an MCP-added app, `startupDelay`) are preserved.
    // Previously this rebuilt a fixed-shape object, silently dropping any field
    // not in the list - so starring or editing an app destroyed its description.
    const has = (key) => Object.prototype.hasOwnProperty.call(appConfig, key);
    const app = {
      ...existing,
      id: appConfig.id,
      name: appConfig.name,
      command: appConfig.command,
      cwd: has('cwd') ? (appConfig.cwd || '') : (existing.cwd || ''),
      preferredPort: has('preferredPort') ? (appConfig.preferredPort || null) : (existing.preferredPort || null),
      fallbackRange: has('fallbackRange') ? (appConfig.fallbackRange || null) : (existing.fallbackRange || null),
      env: has('env') ? (appConfig.env || {}) : (existing.env || {}),
      autoStart: has('autoStart') ? !!appConfig.autoStart : !!existing.autoStart,
      isFavorite: has('isFavorite') ? !!appConfig.isFavorite : !!existing.isFavorite,
      group: has('group') ? (appConfig.group || null) : (existing.group || null),
      description: has('description') ? (appConfig.description || null) : (existing.description || null),
      startupDelay: has('startupDelay') ? appConfig.startupDelay : (existing.startupDelay ?? null),
      healthPath: has('healthPath') ? (appConfig.healthPath || null) : (existing.healthPath || null),
      reservePort: has('reservePort') ? !!appConfig.reservePort : !!existing.reservePort,
      // Worktree / branch awareness (Wave 3). All optional; null on plain apps.
      parentId: has('parentId') ? (appConfig.parentId || null) : (existing.parentId || null),
      branch: has('branch') ? (appConfig.branch || null) : (existing.branch || null),
      worktreePath: has('worktreePath') ? (appConfig.worktreePath || null) : (existing.worktreePath || null),
      colorSource: has('colorSource') ? (appConfig.colorSource || null) : (existing.colorSource || null),
      color: appConfig.color || existing.color || this.getRandomColor(),
      createdAt: existing.createdAt || appConfig.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    return app;
  }

  /**
   * Change some fields of one app, against the fresh file on disk. Use this
   * instead of getApp() + edit + saveApp(): the cached app can be older than
   * the file, and saving it back would undo another process's change.
   * `patch` is an object of fields, or a function (freshApp) => fields; a
   * function returning null leaves the app untouched. Returns the fresh app,
   * or null if no app has that ID.
   */
  patchApp(id, patch) {
    return this.update((config) => {
      const app = (config.apps || []).find(a => a.id === id);
      if (!app) return null;
      const fields = typeof patch === 'function' ? patch({ ...app }) : patch;
      if (fields) Object.assign(app, fields, { updatedAt: new Date().toISOString() });
      return app;
    });
  }

  /** Delete an app by ID */
  deleteApp(id) {
    return this.update((config) => {
      const initialLength = (config.apps || []).length;
      config.apps = (config.apps || []).filter(app => app.id !== id);
      return config.apps.length < initialLength;
    });
  }

  /** Remove every app; returns how many were removed */
  clearApps() {
    return this.update((config) => {
      const count = (config.apps || []).length;
      config.apps = [];
      return count;
    });
  }

  /**
   * Update apps order (for drag-and-drop reordering)
   * @param {Array<string>} appIds - Ordered array of app IDs
   */
  updateAppsOrder(appIds) {
    this.update((config) => {
      const apps = config.apps || [];
      const orderedApps = [];
      appIds.forEach(id => {
        const app = apps.find(a => a.id === id);
        if (app) orderedApps.push(app);
      });
      // Keep apps another process added that the caller's list doesn't know about
      apps.forEach(app => { if (!appIds.includes(app.id)) orderedApps.push(app); });
      config.apps = orderedApps;
    });
  }

  /** Get settings */
  getSettings() {
    return this.config.settings || {};
  }

  /** Update settings */
  updateSettings(newSettings) {
    return this.update((config) => {
      config.settings = { ...config.settings, ...newSettings };
      return config.settings;
    });
  }

  /**
   * Edit the discovery settings against the fresh file on disk. The mutator
   * edits the discovery object in place; its return value is returned.
   */
  updateDiscovery(mutator) {
    return this.update((config) => {
      if (!config.settings) config.settings = {};
      const discovery = { ...(config.settings.discovery || {}) };
      const result = mutator(discovery);
      config.settings.discovery = discovery;
      return result;
    });
  }

  /** Get all groups */
  getGroups() {
    return this.config.groups || [];
  }

  /** Add or update a group */
  saveGroup(groupConfig) {
    if (!groupConfig.name) throw new Error('Group must have a name');

    if (!groupConfig.id) {
      groupConfig.id = `group_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    const group = {
      id: groupConfig.id,
      name: groupConfig.name,
      expanded: groupConfig.expanded !== false,
      color: typeof groupConfig.color === 'string' ? groupConfig.color.slice(0, 20) : null
    };

    return this.update((config) => {
      if (!config.groups) config.groups = [];
      const existingIndex = config.groups.findIndex(g => g.id === groupConfig.id);
      if (existingIndex >= 0) {
        config.groups[existingIndex] = group;
      } else {
        config.groups.push(group);
      }
      return group;
    });
  }

  /** Delete a group and ungroup its apps */
  deleteGroup(groupId) {
    this.update((config) => {
      config.apps = (config.apps || []).map(app => {
        if (app.group === groupId) return { ...app, group: null };
        return app;
      });
      config.groups = (config.groups || []).filter(g => g.id !== groupId);
    });
  }

  /** Generate a random color for app identification */
  getRandomColor() {
    const colors = [
      '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6',
      '#EC4899', '#06B6D4', '#84CC16', '#F97316', '#6366F1'
    ];
    return colors[Math.floor(Math.random() * colors.length)];
  }

  /** Export config for backup */
  export() {
    return JSON.stringify(this.config, null, 2);
  }

  /**
   * Import config from backup. Returns false for input that is not a valid
   * config; throws if the file cannot be written (in-memory config unchanged).
   */
  import(jsonString) {
    let imported;
    try {
      imported = JSON.parse(jsonString);
      if (!imported || !imported.apps || !Array.isArray(imported.apps)) return false;

      // Sanitize each app: only keep known safe fields, enforce types
      imported.apps = imported.apps.map(app => ({
        id: typeof app.id === 'string' ? app.id.slice(0, 100) : undefined,
        name: typeof app.name === 'string' ? app.name.slice(0, 200) : 'Unnamed',
        command: typeof app.command === 'string' ? app.command.slice(0, 1000) : '',
        cwd: typeof app.cwd === 'string' ? app.cwd.slice(0, 500) : '',
        preferredPort: Number.isInteger(app.preferredPort) && app.preferredPort > 0 && app.preferredPort <= 65535 ? app.preferredPort : null,
        fallbackRange: app.fallbackRange || null,
        env: (app.env && typeof app.env === 'object' && !Array.isArray(app.env)) ? app.env : {},
        autoStart: Boolean(app.autoStart),
        isFavorite: Boolean(app.isFavorite),
        group: typeof app.group === 'string' ? app.group : null,
        parentId: typeof app.parentId === 'string' ? app.parentId.slice(0, 100) : null,
        branch: typeof app.branch === 'string' ? app.branch.slice(0, 200) : null,
        worktreePath: typeof app.worktreePath === 'string' ? app.worktreePath.slice(0, 500) : null,
        healthPath: typeof app.healthPath === 'string' ? app.healthPath.slice(0, 500) : null,
        reservePort: Boolean(app.reservePort),
        colorSource: ['peacock', 'manual', 'auto'].includes(app.colorSource) ? app.colorSource : null,
        color: typeof app.color === 'string' ? app.color : this.getRandomColor(),
        createdAt: app.createdAt || new Date().toISOString(),
        updatedAt: app.updatedAt || new Date().toISOString()
      })).filter(app => app.name && app.command);

      if (imported.groups && Array.isArray(imported.groups)) {
        imported.groups = imported.groups.map(g => ({
          id: typeof g.id === 'string' ? g.id.slice(0, 100) : undefined,
          name: typeof g.name === 'string' ? g.name.slice(0, 100) : 'Group',
          expanded: g.expanded !== false,
          color: typeof g.color === 'string' ? g.color.slice(0, 20) : null
        })).filter(g => g.name);
      }

    } catch (error) {
      console.error('Failed to import config:', error);
      return false;
    }

    // A restore replaces the whole file on purpose - no merge with disk.
    try {
      withLock(this.configPath, () => writeJsonAtomic(this.configPath, imported));
    } catch (error) {
      throw new Error(`Failed to save imported config: ${error.message}`);
    }
    this.config = imported;
    return true;
  }
}

module.exports = { ConfigStore };
