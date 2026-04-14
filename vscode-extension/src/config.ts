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

  if (platform === 'win32') {
    configDir = path.join(process.env.APPDATA || '', 'PortPilot');
  } else if (platform === 'darwin') {
    configDir = path.join(os.homedir(), 'Library', 'Application Support', 'PortPilot');
  } else {
    configDir = path.join(os.homedir(), '.config', 'PortPilot');
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

export function writeConfig(config: PortPilotConfig): void {
  const configPath = getConfigPath();
  const configDir = path.dirname(configPath);
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

export function generateId(): string {
  return `app-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
