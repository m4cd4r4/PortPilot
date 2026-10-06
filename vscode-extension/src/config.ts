import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface PortPilotApp {
  id: string;
  name: string;
  command: string;
  cwd: string;
  preferredPort: number | null;
  fallbackRange: { start: number; end: number } | null;
  env: Record<string, string>;
  autoStart: boolean;
  isFavorite: boolean;
  color: string;
  description?: string;
  group?: string | null;
  // Worktree / branch awareness (Wave 3). Optional; absent on plain apps.
  parentId?: string | null;
  branch?: string | null;
  worktreePath?: string | null;
  colorSource?: 'peacock' | 'manual' | 'auto' | null;
  createdAt: string;
  updatedAt: string;
}

export interface PortPilotGroup {
  id: string;
  name: string;
  expanded: boolean;
  color?: string;
}

export interface PortPilotConfig {
  apps: PortPilotApp[];
  settings: Record<string, unknown>;
  groups: PortPilotGroup[];
}

export function getConfigPath(): string {
  const platform = os.platform();
  let configDir: string;

  // NOTE: must match Electron's app.getPath('userData'), which is derived from
  // the lowercase package.json "name" ("portpilot"). Using "PortPilot" (capital)
  // works on case-insensitive Windows but reads a DIFFERENT file on Linux/macOS,
  // so the extension would never see the desktop app's config.
  if (platform === 'win32') {
    configDir = path.join(process.env.APPDATA || '', 'portpilot');
  } else if (platform === 'darwin') {
    configDir = path.join(os.homedir(), 'Library', 'Application Support', 'portpilot');
  } else {
    configDir = path.join(os.homedir(), '.config', 'portpilot');
  }

  return path.join(configDir, 'portpilot-config.json');
}

export function readConfig(): PortPilotConfig {
  const configPath = getConfigPath();
  try {
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('PortPilot: Error reading config:', error);
  }
  return { apps: [], settings: {}, groups: [] };
}

// Lock + atomic-write helpers shared with the desktop app, agent and MCP server.
// scripts/copy-runtime.js copies src/core/configFile.js into runtime/ at build.
interface ConfigFileApi {
  updateJson<T>(file: string, mutator: (config: PortPilotConfig) => T, fallback: () => PortPilotConfig): { config: PortPilotConfig; result: T };
}
// eslint-disable-next-line @typescript-eslint/no-var-requires
const configFile: ConfigFileApi = require(path.join(__dirname, '..', 'runtime', 'core', 'configFile.js'));

/**
 * Locked read-modify-write against the file on disk. Do any user prompting
 * BEFORE calling this: the mutator must be synchronous, and a config object
 * held across a prompt would overwrite whatever other processes wrote meanwhile.
 */
export function updateConfig<T>(mutator: (config: PortPilotConfig) => T): T {
  return configFile.updateJson(getConfigPath(), (config) => {
    if (!config.apps) config.apps = [];
    return mutator(config);
  }, () => ({ apps: [], settings: {}, groups: [] })).result;
}

export function generateId(): string {
  return `app-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
