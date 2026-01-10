#!/usr/bin/env node
/**
 * PortPilot MCP Server
 *
 * Provides Claude with tools to manage local development servers via PortPilot.
 *
 * Tools:
 * - list_apps: List all registered apps
 * - get_app: Get details of a specific app
 * - list_running: List currently running apps with port info
 * - scan_ports: Scan for active ports on the system
 * - start_app: Start an app by ID or name
 * - stop_app: Stop an app by ID or name
 * - add_app: Register a new app
 * - update_app: Update an existing app
 * - delete_app: Remove an app from PortPilot
 * - kill_port: Kill process on a specific port
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import fs from 'fs';
import path from 'path';
import { execSync, exec } from 'child_process';
import os from 'os';

// =============================================================================
// CONFIG PATHS
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

// =============================================================================
// CONFIG OPERATIONS
// =============================================================================

function readConfig() {
  const configPath = getConfigPath();
  try {
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error reading config:', error);
  }
  return { apps: [], settings: {} };
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
  return `app_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// =============================================================================
// PORT SCANNING
// =============================================================================

function scanPorts() {
  const platform = os.platform();
  const ports = [];

  try {
    let output;

    if (platform === 'win32') {
      output = execSync('netstat -ano | findstr LISTENING', { encoding: 'utf-8', timeout: 10000 });
      const lines = output.split('\n').filter(l => l.trim());

      for (const line of lines) {
        const match = line.match(/:(\d+)\s+.*LISTENING\s+(\d+)/);
        if (match) {
          const port = parseInt(match[1]);
          const pid = parseInt(match[2]);
          if (port >= 1024 && port <= 65535) {
            // Get process name
            let processName = 'Unknown';
            try {
              const wmicOutput = execSync(`wmic process where ProcessId=${pid} get Name /value`, { encoding: 'utf-8', timeout: 5000 });
              const nameMatch = wmicOutput.match(/Name=(.+)/);
              if (nameMatch) processName = nameMatch[1].trim();
            } catch {}

            ports.push({ port, pid, processName });
          }
        }
      }
    } else if (platform === 'darwin') {
      output = execSync('lsof -iTCP -sTCP:LISTEN -n -P', { encoding: 'utf-8', timeout: 10000 });
      const lines = output.split('\n').filter(l => l.trim());

      for (const line of lines.slice(1)) { // Skip header
        const parts = line.split(/\s+/);
        if (parts.length >= 9) {
          const processName = parts[0];
          const pid = parseInt(parts[1]);
          const portMatch = parts[8]?.match(/:(\d+)$/);
          if (portMatch) {
            ports.push({ port: parseInt(portMatch[1]), pid, processName });
          }
        }
      }
    } else {
      // Linux
      try {
        output = execSync('ss -tlnp', { encoding: 'utf-8', timeout: 10000 });
      } catch {
        output = execSync('netstat -tlnp', { encoding: 'utf-8', timeout: 10000 });
      }

      const lines = output.split('\n').filter(l => l.trim());
      for (const line of lines) {
        const portMatch = line.match(/:(\d+)\s/);
        const pidMatch = line.match(/pid=(\d+)/);
        if (portMatch) {
          ports.push({
            port: parseInt(portMatch[1]),
            pid: pidMatch ? parseInt(pidMatch[1]) : null,
            processName: 'Unknown'
          });
        }
      }
    }
  } catch (error) {
    console.error('Port scan error:', error.message);
  }

  // Deduplicate by port
  const uniquePorts = [...new Map(ports.map(p => [p.port, p])).values()];
  return uniquePorts.sort((a, b) => a.port - b.port);
}

function killPort(port) {
  const platform = os.platform();

  try {
    if (platform === 'win32') {
      // Find PID
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

function findAppByIdOrName(apps, identifier) {
  return apps.find(app =>
    app.id === identifier ||
    app.name.toLowerCase() === identifier.toLowerCase()
  );
}

function matchAppsToports(apps, activePorts) {
  const running = [];

  for (const app of apps) {
    // Check if app's preferred port is active
    if (app.preferredPort) {
      const portInfo = activePorts.find(p => p.port === app.preferredPort);
      if (portInfo) {
        running.push({
          ...app,
          port: portInfo.port,
          pid: portInfo.pid,
          processName: portInfo.processName,
          status: 'running'
        });
        continue;
      }
    }

    // Check if any port's process matches the app's command
    for (const portInfo of activePorts) {
      if (app.cwd && portInfo.processName) {
        const cwdName = path.basename(app.cwd).toLowerCase();
        if (portInfo.processName.toLowerCase().includes(cwdName)) {
          running.push({
            ...app,
            port: portInfo.port,
            pid: portInfo.pid,
            processName: portInfo.processName,
            status: 'running'
          });
          break;
        }
      }
    }
  }

  return running;
}

function startApp(app) {
  const platform = os.platform();

  try {
    const env = { ...process.env, ...app.env };
    if (app.preferredPort) {
      env.PORT = String(app.preferredPort);
    }

    const options = {
      cwd: app.cwd,
      env,
      detached: true,
      stdio: 'ignore',
      shell: true
    };

    if (platform === 'win32') {
      // Use start command to detach
      exec(`start /B cmd /c "${app.command}"`, options);
    } else {
      exec(`nohup ${app.command} &`, options);
    }

    return { success: true, message: `Started ${app.name}` };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function stopApp(app, activePorts) {
  // Find the app's running process
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

  // Try killing by port
  if (app.preferredPort) {
    return killPort(app.preferredPort);
  }

  return { success: false, error: 'Could not find running process' };
}

// =============================================================================
// MCP SERVER
// =============================================================================

const server = new Server(
  {
    name: 'portpilot-mcp-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'list_apps',
        description: 'List all apps registered in PortPilot',
        inputSchema: {
          type: 'object',
          properties: {
            favorites_only: {
              type: 'boolean',
              description: 'Only show favorite apps'
            }
          }
        }
      },
      {
        name: 'get_app',
        description: 'Get details of a specific app by ID or name',
        inputSchema: {
          type: 'object',
          properties: {
            identifier: {
              type: 'string',
              description: 'App ID or name'
            }
          },
          required: ['identifier']
        }
      },
      {
        name: 'list_running',
        description: 'List currently running apps with their ports',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'scan_ports',
        description: 'Scan for all active ports on the system',
        inputSchema: {
          type: 'object',
          properties: {
            min_port: {
              type: 'number',
              description: 'Minimum port number (default: 1024)'
            },
            max_port: {
              type: 'number',
              description: 'Maximum port number (default: 65535)'
            }
          }
        }
      },
      {
        name: 'start_app',
        description: 'Start an app by ID or name',
        inputSchema: {
          type: 'object',
          properties: {
            identifier: {
              type: 'string',
              description: 'App ID or name'
            }
          },
          required: ['identifier']
        }
      },
      {
        name: 'stop_app',
        description: 'Stop an app by ID or name',
        inputSchema: {
          type: 'object',
          properties: {
            identifier: {
              type: 'string',
              description: 'App ID or name'
            }
          },
          required: ['identifier']
        }
      },
      {
        name: 'add_app',
        description: 'Register a new app in PortPilot',
        inputSchema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'App display name'
            },
            command: {
              type: 'string',
              description: 'Shell command to start the app (e.g., "npm run dev")'
            },
            cwd: {
              type: 'string',
              description: 'Working directory path'
            },
            preferredPort: {
              type: 'number',
              description: 'Preferred port number'
            },
            isFavorite: {
              type: 'boolean',
              description: 'Mark as favorite'
            },
            autoStart: {
              type: 'boolean',
              description: 'Auto-start on PortPilot launch'
            }
          },
          required: ['name', 'command', 'cwd']
        }
      },
      {
        name: 'update_app',
        description: 'Update an existing app configuration',
        inputSchema: {
          type: 'object',
          properties: {
            identifier: {
              type: 'string',
              description: 'App ID or name to update'
            },
            name: { type: 'string' },
            command: { type: 'string' },
            cwd: { type: 'string' },
            preferredPort: { type: 'number' },
            isFavorite: { type: 'boolean' },
            autoStart: { type: 'boolean' }
          },
          required: ['identifier']
        }
      },
      {
        name: 'delete_app',
        description: 'Remove an app from PortPilot',
        inputSchema: {
          type: 'object',
          properties: {
            identifier: {
              type: 'string',
              description: 'App ID or name to delete'
            }
          },
          required: ['identifier']
        }
      },
      {
        name: 'kill_port',
        description: 'Kill the process running on a specific port',
        inputSchema: {
          type: 'object',
          properties: {
            port: {
              type: 'number',
              description: 'Port number to kill'
            }
          },
          required: ['port']
        }
      },
      {
        name: 'toggle_favorite',
        description: 'Toggle favorite status of an app',
        inputSchema: {
          type: 'object',
          properties: {
            identifier: {
              type: 'string',
              description: 'App ID or name'
            }
          },
          required: ['identifier']
        }
      },
      {
        name: 'delete_all_apps',
        description: 'Delete ALL apps from PortPilot. Use with caution!',
        inputSchema: {
          type: 'object',
          properties: {
            confirm: {
              type: 'boolean',
              description: 'Must be true to confirm deletion of all apps'
            }
          },
          required: ['confirm']
        }
      }
    ]
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'list_apps': {
        const config = readConfig();
        let apps = config.apps || [];

        if (args?.favorites_only) {
          apps = apps.filter(a => a.isFavorite);
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              count: apps.length,
              apps: apps.map(a => ({
                id: a.id,
                name: a.name,
                command: a.command,
                cwd: a.cwd,
                preferredPort: a.preferredPort,
                isFavorite: a.isFavorite,
                autoStart: a.autoStart
              }))
            }, null, 2)
          }]
        };
      }

      case 'get_app': {
        const config = readConfig();
        const app = findAppByIdOrName(config.apps || [], args.identifier);

        if (!app) {
          return {
            content: [{ type: 'text', text: `App not found: ${args.identifier}` }],
            isError: true
          };
        }

        return {
          content: [{ type: 'text', text: JSON.stringify(app, null, 2) }]
        };
      }

      case 'list_running': {
        const config = readConfig();
        const activePorts = scanPorts();
        const running = matchAppsToports(config.apps || [], activePorts);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              count: running.length,
              apps: running.map(a => ({
                name: a.name,
                port: a.port,
                pid: a.pid,
                processName: a.processName,
                cwd: a.cwd
              }))
            }, null, 2)
          }]
        };
      }

      case 'scan_ports': {
        let ports = scanPorts();
        const minPort = args?.min_port || 1024;
        const maxPort = args?.max_port || 65535;

        ports = ports.filter(p => p.port >= minPort && p.port <= maxPort);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              count: ports.length,
              ports
            }, null, 2)
          }]
        };
      }

      case 'start_app': {
        const config = readConfig();
        const app = findAppByIdOrName(config.apps || [], args.identifier);

        if (!app) {
          return {
            content: [{ type: 'text', text: `App not found: ${args.identifier}` }],
            isError: true
          };
        }

        const result = startApp(app);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          isError: !result.success
        };
      }

      case 'stop_app': {
        const config = readConfig();
        const app = findAppByIdOrName(config.apps || [], args.identifier);

        if (!app) {
          return {
            content: [{ type: 'text', text: `App not found: ${args.identifier}` }],
            isError: true
          };
        }

        const activePorts = scanPorts();
        const result = stopApp(app, activePorts);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          isError: !result.success
        };
      }

      case 'add_app': {
        const config = readConfig();
        if (!config.apps) config.apps = [];

        // Check for duplicate name
        if (config.apps.some(a => a.name.toLowerCase() === args.name.toLowerCase())) {
          return {
            content: [{ type: 'text', text: `App with name "${args.name}" already exists` }],
            isError: true
          };
        }

        const newApp = {
          id: generateId(),
          name: args.name,
          command: args.command,
          cwd: args.cwd,
          preferredPort: args.preferredPort || null,
          fallbackRange: null,
          env: {},
          autoStart: args.autoStart || false,
          isFavorite: args.isFavorite || false,
          color: '#3B82F6',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };

        config.apps.push(newApp);
        writeConfig(config);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: `Added app: ${newApp.name}`,
              app: newApp
            }, null, 2)
          }]
        };
      }

      case 'update_app': {
        const config = readConfig();
        const appIndex = (config.apps || []).findIndex(a =>
          a.id === args.identifier ||
          a.name.toLowerCase() === args.identifier.toLowerCase()
        );

        if (appIndex === -1) {
          return {
            content: [{ type: 'text', text: `App not found: ${args.identifier}` }],
            isError: true
          };
        }

        const app = config.apps[appIndex];
        const updates = { ...args };
        delete updates.identifier;

        config.apps[appIndex] = {
          ...app,
          ...updates,
          updatedAt: new Date().toISOString()
        };

        writeConfig(config);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: `Updated app: ${config.apps[appIndex].name}`,
              app: config.apps[appIndex]
            }, null, 2)
          }]
        };
      }

      case 'delete_app': {
        const config = readConfig();
        const appIndex = (config.apps || []).findIndex(a =>
          a.id === args.identifier ||
          a.name.toLowerCase() === args.identifier.toLowerCase()
        );

        if (appIndex === -1) {
          return {
            content: [{ type: 'text', text: `App not found: ${args.identifier}` }],
            isError: true
          };
        }

        const deletedApp = config.apps.splice(appIndex, 1)[0];
        writeConfig(config);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: `Deleted app: ${deletedApp.name}`
            }, null, 2)
          }]
        };
      }

      case 'kill_port': {
        const result = killPort(args.port);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          isError: !result.success
        };
      }

      case 'toggle_favorite': {
        const config = readConfig();
        const app = findAppByIdOrName(config.apps || [], args.identifier);

        if (!app) {
          return {
            content: [{ type: 'text', text: `App not found: ${args.identifier}` }],
            isError: true
          };
        }

        app.isFavorite = !app.isFavorite;
        app.updatedAt = new Date().toISOString();
        writeConfig(config);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: `${app.name} is ${app.isFavorite ? 'now' : 'no longer'} a favorite`
            }, null, 2)
          }]
        };
      }

      case 'delete_all_apps': {
        if (!args.confirm) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: false,
                message: 'Must pass confirm: true to delete all apps'
              }, null, 2)
            }],
            isError: true
          };
        }

        const config = readConfig();
        const count = (config.apps || []).length;
        const deletedNames = (config.apps || []).map(a => a.name);
        config.apps = [];
        writeConfig(config);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: `Deleted all ${count} apps from PortPilot`,
              deleted: deletedNames
            }, null, 2)
          }]
        };
      }

      default:
        return {
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
          isError: true
        };
    }
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Error: ${error.message}` }],
      isError: true
    };
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('PortPilot MCP Server running');
}

main().catch(console.error);
