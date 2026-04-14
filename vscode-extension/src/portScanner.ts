import { execSync } from 'child_process';
import * as os from 'os';

export interface ActivePort {
  port: number;
  pid: number;
  processName: string;
}

export function scanPorts(): ActivePort[] {
  const platform = os.platform();
  const ports: ActivePort[] = [];

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
      const lines = output.split('\n').filter(l => l.trim());
      for (const line of lines.slice(1)) {
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
      let output: string;
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
            pid: pidMatch ? parseInt(pidMatch[1]) : 0,
            processName: 'Unknown'
          });
        }
      }
    }
  } catch (error) {
    console.error('PortPilot: Port scan error:', error);
  }

  const uniquePorts = [...new Map(ports.map(p => [p.port, p])).values()];
  return uniquePorts.sort((a, b) => a.port - b.port);
}

export function killPort(port: number): boolean {
  const platform = os.platform();
  try {
    if (platform === 'win32') {
      const output = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf-8' });
      const match = output.match(/LISTENING\s+(\d+)/);
      if (match) {
        execSync(`taskkill /F /PID ${match[1]}`);
        return true;
      }
    } else {
      const output = execSync(`lsof -ti :${port}`, { encoding: 'utf-8' });
      const pid = output.trim();
      if (pid) {
        execSync(`kill -9 ${pid}`);
        return true;
      }
    }
  } catch { /* ignore */ }
  return false;
}
