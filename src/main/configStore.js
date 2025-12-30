const fs = require('fs');
const path = require('path');
const { app } = require('electron');

/**
 * ConfigStore - Manages persistent app configurations
 */
class ConfigStore {
  constructor() {
    this.configPath = path.join(
      app?.getPath('userData') || path.join(process.cwd(), 'data'),
      'portpilot-config.json'
    );
    this.config = this.load();
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
      settings: {
        startMinimized: false,
        autoScan: true,
        scanInterval: 5000,
        theme: 'dark'
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
    
    const app = {
      id: appConfig.id,
      name: appConfig.name,
      command: appConfig.command,
      cwd: appConfig.cwd || '',
      preferredPort: appConfig.preferredPort || null,
      fallbackRange: appConfig.fallbackRange || null,
      env: appConfig.env || {},
      autoStart: appConfig.autoStart || false,
      color: appConfig.color || this.getRandomColor(),
      createdAt: appConfig.createdAt || new Date().toISOString(),
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
      if (imported.apps && Array.isArray(imported.apps)) {
        this.config = imported;
        this.save();
        return true;
      }
      return false;
    } catch (error) {
      console.error('Failed to import config:', error);
      return false;
    }
  }
}

module.exports = { ConfigStore };
