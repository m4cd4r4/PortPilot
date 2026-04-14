#!/usr/bin/env node
/**
 * PortPilot MCP Server v2.0
 *
 * Manage local development servers and ports via any MCP-compatible AI assistant.
 * Uses the high-level McpServer API from @modelcontextprotocol/sdk 1.x.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { execSync, exec } from 'child_process';
import os from 'os';

// =============================================================================
// CONFIG
// =============================================================================

function getConfigPath() {
  const platform = os.platform();
  let configDir;
  if (platform === 'win32') {
    configDir = path.join(process.env.APPDATA || '', 'PortPilot');
  } else if (platform === 'darwin') {
    configDir = path.join(os.homedir(), 'Library', 'Application Support', 'PortPilot');
  } else {
    configDir = path.join(os.homedir(), '.config', 'PortPilot');
  }
  return path.join(configDir, 'portpilot-config.json');
}

function readConfig() {
  try {
    const data = fs.readFileSync(getConfigPath(), 'utf-8');
    return JSON.parse(data);
  } catch {
    return { apps: [], settings: {}, groups: [] };
  }
}

function writeConfig(config) {
  const configPath = getConfigPath();
  const configDir = path.dirname(configPath);
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

function generateId() {
  return `app_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

// =============================================================================
// PORT SCANNING
// =============================================================================

function scanPorts() {
  const platform = os.platform();
  const ports = [];

  try {
    if (platform === 'win32') {
      const output = execSync('netstat -ano', { encoding: 'utf-8', timeout: 15000 });
      const lines = output.split('\n').filter(l => /^\s*TCP\b/i.test(l));

      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 5) continue;
        const localPart = parts[1];
        const foreignPart = parts[2];
        const pid = parseInt(parts[4], 10);
        if (!foreignPart || !foreignPart.match(/:0$/)) continue;
        const portMatch = localPart.match(/:(\d+)$/);
        if (!portMatch) continue;
        const port = parseInt(portMatch[1]);
        if (port >= 1024 && port <= 65535) {
          let processName = 'Unknown';
          try {
            const wmicOutput = execSync(
              `wmic process where ProcessId=${pid} get Name /value`,
              { encoding: 'utf-8', timeout: 5000 }
            );
            const nameMatch = wmicOutput.match(/Name=(.+)/);
            if (nameMatch) processName = nameMatch[1].trim();
          } catch { /* ignore */ }
          ports.push({ port, pid, processName });
        }
      }
    } else if (platform === 'darwin') {
      const output = execSync('lsof -iTCP -sTCP:LISTEN -n -P', { encoding: 'utf-8', timeout: 10000 });
      for (const line of output.split('\n').slice(1)) {
        const parts = line.split(/\s+/);
        if (parts.length >= 9) {
          const portMatch = parts[8]?.match(/:(\d+)$/);
          if (portMatch) {
            ports.push({ port: parseInt(portMatch[1]), pid: parseInt(parts[1]), processName: parts[0] });
          }
        }
      }
    } else {
      let output;
      try { output = execSync('ss -tlnp', { encoding: 'utf-8', timeout: 10000 }); }
      catch { output = execSync('netstat -tlnp', { encoding: 'utf-8', timeout: 10000 }); }
      for (const line of output.split('\n')) {
        const portMatch = line.match(/:(\d+)\s/);
        const pidMatch = line.match(/pid=(\d+)/);
        if (portMatch) {
          ports.push({ port: parseInt(portMatch[1]), pid: pidMatch ? parseInt(pidMatch[1]) : null, processName: 'Unknown' });
        }
      }
    }
  } catch (error) {
    console.error('Port scan error:', error.message);
  }

  return [...new Map(ports.map(p => [p.port, p])).values()].sort((a, b) => a.port - b.port);
}

function checkPort(port) {
  const all = scanPorts();
  return all.find(p => p.port === port) || null;
}

function killPort(port) {
  const platform = os.platform();
  try {
    if (platform === 'win32') {
      const output = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf-8' });
      const match = output.match(/LISTENING\s+(\d+)/);
      if (match) {
        execSync(`taskkill /F /PID ${match[1]}`);
        return { success: true, pid: parseInt(match[1]) };
      }
    } else {
      execSync(`lsof -ti:${port} | xargs kill -9`);
      return { success: true };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
  return { success: false, error: 'Port not found' };
}

// =============================================================================
// APP OPERATIONS
// =============================================================================

function findApp(apps, identifier) {
  return apps.find(a => a.id === identifier || a.name.toLowerCase() === identifier.toLowerCase());
}

function getRunningStatus(apps, activePorts) {
  return apps.map(app => {
    const portInfo = app.preferredPort ? activePorts.find(p => p.port === app.preferredPort) : null;
    return {
      id: app.id,
      name: app.name,
      command: app.command,
      cwd: app.cwd,
      preferredPort: app.preferredPort,
      isFavorite: app.isFavorite,
      autoStart: app.autoStart,
      group: app.group || null,
      description: app.description || null,
      running: !!portInfo,
      pid: portInfo?.pid || null,
      processName: portInfo?.processName || null
    };
  });
}

function startApp(app) {
  try {
    const env = { ...process.env, ...app.env };
    if (app.preferredPort) env.PORT = String(app.preferredPort);

    const options = { cwd: app.cwd, env, detached: true, stdio: 'ignore', shell: true };
    if (os.platform() === 'win32') {
      exec(`start /B cmd /c "${app.command}"`, options);
    } else {
      exec(`nohup ${app.command} &`, options);
    }
    return { success: true, message: `Started ${app.name}` };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function stopApp(app) {
  const activePorts = scanPorts();
  const portInfo = activePorts.find(p => p.port === app.preferredPort);

  if (portInfo?.pid) {
    try {
      if (os.platform() === 'win32') {
        execSync(`taskkill /F /PID ${portInfo.pid}`);
      } else {
        execSync(`kill -9 ${portInfo.pid}`);
      }
      return { success: true, message: `Stopped ${app.name} (PID: ${portInfo.pid})` };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  if (app.preferredPort) return killPort(app.preferredPort);
  return { success: false, error: 'Could not find running process' };
}

// =============================================================================
// MCP SERVER
// =============================================================================

const server = new McpServer({
  name: 'portpilot',
  version: '2.0.0',
});

// --- Status ---

server.tool(
  'get_status',
  'Get a quick summary: how many apps registered, how many running, how many ports active',
  {},
  async () => {
    const config = readConfig();
    const ports = scanPorts();
    const apps = config.apps || [];
    const running = apps.filter(a => a.preferredPort && ports.some(p => p.port === a.preferredPort));
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          registeredApps: apps.length,
          runningApps: running.length,
          activePorts: ports.length,
          favorites: apps.filter(a => a.isFavorite).length,
          groups: (config.groups || []).length
        }, null, 2)
      }]
    };
  }
);

// --- List Apps ---

server.tool(
  'list_apps',
  'List all apps registered in PortPilot, with their running status',
  {
    favorites_only: z.boolean().optional().describe('Only show favorite apps'),
    group: z.string().optional().describe('Filter by group name')
  },
  async ({ favorites_only, group }) => {
    const config = readConfig();
    const ports = scanPorts();
    let apps = getRunningStatus(config.apps || [], ports);

    if (favorites_only) apps = apps.filter(a => a.isFavorite);
    if (group) apps = apps.filter(a => a.group === group);

    return {
      content: [{ type: 'text', text: JSON.stringify({ count: apps.length, apps }, null, 2) }]
    };
  }
);

// --- Get App ---

server.tool(
  'get_app',
  'Get full details of a specific app by ID or name, including running status',
  { identifier: z.string().describe('App ID or name') },
  async ({ identifier }) => {
    const config = readConfig();
    const app = findApp(config.apps || [], identifier);
    if (!app) return { content: [{ type: 'text', text: `App not found: ${identifier}` }], isError: true };

    const ports = scanPorts();
    const status = getRunningStatus([app], ports)[0];
    return { content: [{ type: 'text', text: JSON.stringify(status, null, 2) }] };
  }
);

// --- Scan Ports ---

server.tool(
  'scan_ports',
  'Scan for all active listening ports on the system',
  {
    min_port: z.number().optional().describe('Minimum port (default 1024)'),
    max_port: z.number().optional().describe('Maximum port (default 65535)')
  },
  async ({ min_port, max_port }) => {
    let ports = scanPorts();
    ports = ports.filter(p => p.port >= (min_port || 1024) && p.port <= (max_port || 65535));
    return { content: [{ type: 'text', text: JSON.stringify({ count: ports.length, ports }, null, 2) }] };
  }
);

// --- Check Port ---

server.tool(
  'check_port',
  'Check if a specific port is in use and by what process',
  { port: z.number().describe('Port number to check') },
  async ({ port }) => {
    const info = checkPort(port);
    if (!info) {
      return { content: [{ type: 'text', text: JSON.stringify({ port, inUse: false }, null, 2) }] };
    }
    return { content: [{ type: 'text', text: JSON.stringify({ port, inUse: true, ...info }, null, 2) }] };
  }
);

// --- Start App ---

server.tool(
  'start_app',
  'Start an app by ID or name',
  { identifier: z.string().describe('App ID or name') },
  async ({ identifier }) => {
    const config = readConfig();
    const app = findApp(config.apps || [], identifier);
    if (!app) return { content: [{ type: 'text', text: `App not found: ${identifier}` }], isError: true };
    const result = startApp(app);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError: !result.success };
  }
);

// --- Stop App ---

server.tool(
  'stop_app',
  'Stop an app by ID or name',
  { identifier: z.string().describe('App ID or name') },
  async ({ identifier }) => {
    const config = readConfig();
    const app = findApp(config.apps || [], identifier);
    if (!app) return { content: [{ type: 'text', text: `App not found: ${identifier}` }], isError: true };
    const result = stopApp(app);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError: !result.success };
  }
);

// --- Bulk Start ---

server.tool(
  'bulk_start',
  'Start multiple apps at once by group name, or all favorites',
  {
    group: z.string().optional().describe('Start all apps in this group'),
    favorites: z.boolean().optional().describe('Start all favorite apps')
  },
  async ({ group, favorites }) => {
    const config = readConfig();
    let apps = config.apps || [];

    if (group) apps = apps.filter(a => a.group === group);
    else if (favorites) apps = apps.filter(a => a.isFavorite);
    else return { content: [{ type: 'text', text: 'Specify group or favorites: true' }], isError: true };

    const results = apps.map(a => ({ name: a.name, ...startApp(a) }));
    return { content: [{ type: 'text', text: JSON.stringify({ started: results.length, results }, null, 2) }] };
  }
);

// --- Bulk Stop ---

server.tool(
  'bulk_stop',
  'Stop multiple apps at once by group name, or all favorites, or all running',
  {
    group: z.string().optional().describe('Stop all apps in this group'),
    favorites: z.boolean().optional().describe('Stop all favorite apps'),
    all: z.boolean().optional().describe('Stop ALL running apps')
  },
  async ({ group, favorites, all }) => {
    const config = readConfig();
    let apps = config.apps || [];

    if (group) apps = apps.filter(a => a.group === group);
    else if (favorites) apps = apps.filter(a => a.isFavorite);
    else if (!all) return { content: [{ type: 'text', text: 'Specify group, favorites: true, or all: true' }], isError: true };

    const ports = scanPorts();
    const running = apps.filter(a => a.preferredPort && ports.some(p => p.port === a.preferredPort));
    const results = running.map(a => ({ name: a.name, ...stopApp(a) }));
    return { content: [{ type: 'text', text: JSON.stringify({ stopped: results.length, results }, null, 2) }] };
  }
);

// --- Add App ---

server.tool(
  'add_app',
  'Register a new app in PortPilot',
  {
    name: z.string().describe('App display name'),
    command: z.string().describe('Shell command to start (e.g. "npm run dev")'),
    cwd: z.string().describe('Working directory path'),
    preferredPort: z.number().optional().describe('Preferred port number'),
    isFavorite: z.boolean().optional().describe('Mark as favorite'),
    autoStart: z.boolean().optional().describe('Auto-start on launch'),
    group: z.string().optional().describe('Group name to assign to'),
    description: z.string().optional().describe('Short description')
  },
  async ({ name, command, cwd, preferredPort, isFavorite, autoStart, group, description }) => {
    const config = readConfig();
    if (!config.apps) config.apps = [];

    if (config.apps.some(a => a.name.toLowerCase() === name.toLowerCase())) {
      return { content: [{ type: 'text', text: `App "${name}" already exists` }], isError: true };
    }

    const now = new Date().toISOString();
    const newApp = {
      id: generateId(), name, command, cwd,
      preferredPort: preferredPort || null,
      fallbackRange: null, env: {},
      autoStart: autoStart || false,
      isFavorite: isFavorite || false,
      group: group || null,
      description: description || null,
      color: '#4fc3f7',
      createdAt: now, updatedAt: now
    };

    config.apps.push(newApp);
    writeConfig(config);
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, message: `Added "${name}"`, app: newApp }, null, 2) }] };
  }
);

// --- Update App ---

server.tool(
  'update_app',
  'Update an existing app configuration',
  {
    identifier: z.string().describe('App ID or name to update'),
    name: z.string().optional(),
    command: z.string().optional(),
    cwd: z.string().optional(),
    preferredPort: z.number().optional(),
    isFavorite: z.boolean().optional(),
    autoStart: z.boolean().optional(),
    group: z.string().optional(),
    description: z.string().optional()
  },
  async ({ identifier, ...updates }) => {
    const config = readConfig();
    const idx = (config.apps || []).findIndex(a => a.id === identifier || a.name.toLowerCase() === identifier.toLowerCase());
    if (idx === -1) return { content: [{ type: 'text', text: `App not found: ${identifier}` }], isError: true };

    // Remove undefined values
    const clean = Object.fromEntries(Object.entries(updates).filter(([, v]) => v !== undefined));
    config.apps[idx] = { ...config.apps[idx], ...clean, updatedAt: new Date().toISOString() };
    writeConfig(config);
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, app: config.apps[idx] }, null, 2) }] };
  }
);

// --- Delete App ---

server.tool(
  'delete_app',
  'Remove an app from PortPilot',
  { identifier: z.string().describe('App ID or name to delete') },
  async ({ identifier }) => {
    const config = readConfig();
    const idx = (config.apps || []).findIndex(a => a.id === identifier || a.name.toLowerCase() === identifier.toLowerCase());
    if (idx === -1) return { content: [{ type: 'text', text: `App not found: ${identifier}` }], isError: true };
    const deleted = config.apps.splice(idx, 1)[0];
    writeConfig(config);
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, deleted: deleted.name }, null, 2) }] };
  }
);

// --- Delete All Apps ---

server.tool(
  'delete_all_apps',
  'Delete ALL apps from PortPilot. Requires confirm: true.',
  { confirm: z.boolean().describe('Must be true to confirm') },
  async ({ confirm }) => {
    if (!confirm) return { content: [{ type: 'text', text: 'Pass confirm: true to delete all apps' }], isError: true };
    const config = readConfig();
    const count = (config.apps || []).length;
    const names = (config.apps || []).map(a => a.name);
    config.apps = [];
    writeConfig(config);
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, deleted: count, names }, null, 2) }] };
  }
);

// --- Kill Port ---

server.tool(
  'kill_port',
  'Kill the process running on a specific port',
  { port: z.number().describe('Port number') },
  async ({ port }) => {
    const result = killPort(port);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError: !result.success };
  }
);

// --- Toggle Favorite ---

server.tool(
  'toggle_favorite',
  'Toggle favorite status of an app',
  { identifier: z.string().describe('App ID or name') },
  async ({ identifier }) => {
    const config = readConfig();
    const app = findApp(config.apps || [], identifier);
    if (!app) return { content: [{ type: 'text', text: `App not found: ${identifier}` }], isError: true };
    app.isFavorite = !app.isFavorite;
    app.updatedAt = new Date().toISOString();
    writeConfig(config);
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, name: app.name, isFavorite: app.isFavorite }, null, 2) }] };
  }
);

// --- List Groups ---

server.tool(
  'list_groups',
  'List all app groups and how many apps are in each',
  {},
  async () => {
    const config = readConfig();
    const groups = config.groups || [];
    const apps = config.apps || [];

    const result = groups.map(g => ({
      id: g.id,
      name: g.name,
      color: g.color,
      appCount: apps.filter(a => a.group === g.id).length
    }));

    // Count ungrouped
    const ungrouped = apps.filter(a => !a.group).length;
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ groups: result, ungroupedApps: ungrouped }, null, 2)
      }]
    };
  }
);

// --- Move to Group ---

server.tool(
  'move_to_group',
  'Move an app to a group (or remove from group by passing null)',
  {
    identifier: z.string().describe('App ID or name'),
    group: z.string().nullable().describe('Group ID or name, or null to ungroup')
  },
  async ({ identifier, group }) => {
    const config = readConfig();
    const app = findApp(config.apps || [], identifier);
    if (!app) return { content: [{ type: 'text', text: `App not found: ${identifier}` }], isError: true };

    if (group) {
      // Resolve group by name if not an ID
      const resolved = (config.groups || []).find(g => g.id === group || g.name.toLowerCase() === group.toLowerCase());
      if (!resolved) return { content: [{ type: 'text', text: `Group not found: ${group}` }], isError: true };
      app.group = resolved.id;
    } else {
      app.group = null;
    }

    app.updatedAt = new Date().toISOString();
    writeConfig(config);
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, name: app.name, group: app.group }, null, 2) }] };
  }
);

// --- List Running (convenience) ---

server.tool(
  'list_running',
  'List only currently running apps with their port and process info',
  {},
  async () => {
    const config = readConfig();
    const ports = scanPorts();
    const all = getRunningStatus(config.apps || [], ports);
    const running = all.filter(a => a.running);
    return { content: [{ type: 'text', text: JSON.stringify({ count: running.length, apps: running }, null, 2) }] };
  }
);

// =============================================================================
// START
// =============================================================================

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('PortPilot MCP Server v2.0 running');
}

main().catch(console.error);
