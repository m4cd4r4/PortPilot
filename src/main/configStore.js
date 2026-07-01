const fs = require('fs');
const path = require('path');
const { getConfigPath } = require('../core/configPath');

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
      this.save(); // Create initial config file
    }

    try {
      fs.watch(this.configPath, (eventType) => {
        if (eventType === 'change') {
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

  /** Load config from disk */
  load() {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, 'utf8');
        return JSON.parse(data);
      }
    } catch (error) {
      console.error('Failed to load config:', error);
    }

    // Default config
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
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
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

    const existingIndex = this.config.apps.findIndex(a => a.id === appConfig.id);
    const existing = existingIndex >= 0 ? this.config.apps[existingIndex] : {};

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
      // Worktree / branch awareness (Wave 3). All optional; null on plain apps.
      parentId: has('parentId') ? (appConfig.parentId || null) : (existing.parentId || null),
      branch: has('branch') ? (appConfig.branch || null) : (existing.branch || null),
      worktreePath: has('worktreePath') ? (appConfig.worktreePath || null) : (existing.worktreePath || null),
      colorSource: has('colorSource') ? (appConfig.colorSource || null) : (existing.colorSource || null),
      color: appConfig.color || existing.color || this.getRandomColor(),
      createdAt: existing.createdAt || appConfig.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (existingIndex >= 0) {
      this.config.apps[existingIndex] = app;
    } else {
      this.config.apps.push(app);
    }

    this.save();
    return app;
  }

  /** Delete an app by ID */
  deleteApp(id) {
    const initialLength = this.config.apps.length;
    this.config.apps = this.config.apps.filter(app => app.id !== id);

    if (this.config.apps.length < initialLength) {
      this.save();
      return true;
    }
    return false;
  }

  /**
   * Update apps order (for drag-and-drop reordering)
   * @param {Array<string>} appIds - Ordered array of app IDs
   */
  updateAppsOrder(appIds) {
    const orderedApps = [];
    appIds.forEach(id => {
      const app = this.config.apps.find(a => a.id === id);
      if (app) orderedApps.push(app);
    });
    this.config.apps = orderedApps;
    this.save();
  }

  /** Get settings */
  getSettings() {
    return this.config.settings || {};
  }

  /** Update settings */
  updateSettings(newSettings) {
    this.config.settings = { ...this.config.settings, ...newSettings };
    this.save();
    return this.config.settings;
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

    if (!this.config.groups) this.config.groups = [];

    const existingIndex = this.config.groups.findIndex(g => g.id === groupConfig.id);
    const group = {
      id: groupConfig.id,
      name: groupConfig.name,
      expanded: groupConfig.expanded !== false,
      color: typeof groupConfig.color === 'string' ? groupConfig.color.slice(0, 20) : null
    };

    if (existingIndex >= 0) {
      this.config.groups[existingIndex] = group;
    } else {
      this.config.groups.push(group);
    }

    this.save();
    return group;
  }

  /** Delete a group and ungroup its apps */
  deleteGroup(groupId) {
    this.config.apps = this.config.apps.map(app => {
      if (app.group === groupId) return { ...app, group: null };
      return app;
    });
    this.config.groups = (this.config.groups || []).filter(g => g.id !== groupId);
    this.save();
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

  /** Import config from backup */
  import(jsonString) {
    try {
      const imported = JSON.parse(jsonString);
      if (!imported.apps || !Array.isArray(imported.apps)) return false;

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

      this.config = imported;
      this.save();
      return true;
    } catch (error) {
      console.error('Failed to import config:', error);
      return false;
    }
  }
}

module.exports = { ConfigStore };
