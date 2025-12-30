const { exec } = require('child_process');
const os = require('os');

/**
 * Scan all listening TCP ports and return process information
 * @returns {Promise<Array>} Array of port info objects
 */
async function scanPorts() {
  const platform = os.platform();
  
  try {
    if (platform === 'win32') {
      return await scanPortsWindows();
    } else if (platform === 'darwin') {
      return await scanPortsMac();
    } else {
      return await scanPortsLinux();
    }
  } catch (error) {
    console.error('Port scan error:', error);
    return [];
  }
}

/** Windows port scanning using netstat */
function scanPortsWindows() {
  return new Promise((resolve, reject) => {
    exec('netstat -ano -p TCP | findstr LISTENING', { encoding: 'utf8' }, (error, stdout) => {
      if (error && !stdout) {
        resolve([]);
        return;
      }

      const lines = stdout.trim().split('\n').filter(Boolean);
      const portMap = new Map();

      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 5) {
          const localAddress = parts[1];
          const pid = parseInt(parts[4], 10);

          // Extract port from address (e.g., "0.0.0.0:3000" or "[::]:3000" or "[::1]:3000")
          const portMatch = localAddress.match(/:(\d+)$/);
          if (portMatch) {
            const port = parseInt(portMatch[1], 10);
            if (port > 0) {
              const existing = portMap.get(port);
              if (!existing) {
                // First occurrence of this port
                portMap.set(port, { port, pid, address: localAddress, bindings: [{ pid, address: localAddress }] });
              } else if (existing.pid !== pid) {
                // Different process on same port - mark as conflict
                existing.bindings.push({ pid, address: localAddress });
                existing.conflict = true;
              }
            }
          }
        }
      }

      // Get process names for all PIDs
      getProcessNames([...portMap.values()]).then(resolve).catch(() => resolve([...portMap.values()]));
    });
  });
}

/** macOS port scanning using lsof */
function scanPortsMac() {
  return new Promise((resolve, reject) => {
    exec('lsof -iTCP -sTCP:LISTEN -n -P', { encoding: 'utf8' }, (error, stdout) => {
      if (error && !stdout) {
        resolve([]);
        return;
      }

      const lines = stdout.trim().split('\n').slice(1); // Skip header
      const portMap = new Map();

      for (const line of lines) {
        const parts = line.split(/\s+/);
        if (parts.length >= 9) {
          const processName = parts[0];
          const pid = parseInt(parts[1], 10);
          const address = parts[8];
          
          const portMatch = address.match(/:(\d+)$/);
          if (portMatch) {
            const port = parseInt(portMatch[1], 10);
            if (!portMap.has(port)) {
              portMap.set(port, { port, pid, processName, address });
            }
          }
        }
      }

      resolve([...portMap.values()]);
    });
  });
}

/** Linux port scanning using ss */
function scanPortsLinux() {
  return new Promise((resolve, reject) => {
    exec('ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null', { encoding: 'utf8' }, (error, stdout) => {
      if (error && !stdout) {
        resolve([]);
        return;
      }

      const lines = stdout.trim().split('\n').slice(1);
      const portMap = new Map();

      for (const line of lines) {
        const parts = line.split(/\s+/);
        
        // ss format: State Recv-Q Send-Q Local:Port Peer:Port Process
        // netstat format: Proto Recv-Q Send-Q Local:Port Foreign:Port State PID/Program
        const localIdx = parts.findIndex(p => p.includes(':'));
        if (localIdx === -1) continue;

        const localAddress = parts[localIdx];
        const portMatch = localAddress.match(/:(\d+)$/);
        
        if (portMatch) {
          const port = parseInt(portMatch[1], 10);
          
          // Extract PID from process info
          const processInfo = parts.find(p => p.includes('pid=') || p.includes('/'));
          let pid = 0;
          let processName = 'unknown';

          if (processInfo) {
            const pidMatch = processInfo.match(/pid=(\d+)/) || processInfo.match(/^(\d+)\//);
            if (pidMatch) pid = parseInt(pidMatch[1], 10);
            
            const nameMatch = processInfo.match(/\/(.+?)(?:,|$)/);
            if (nameMatch) processName = nameMatch[1];
          }

          if (!portMap.has(port)) {
            portMap.set(port, { port, pid, processName, address: localAddress });
          }
        }
      }

      resolve([...portMap.values()]);
    });
  });
}

/** Get process names for Windows PIDs */
function getProcessNames(portInfos) {
  return new Promise((resolve) => {
    // Collect all PIDs including from bindings
    const allPids = new Set();
    for (const p of portInfos) {
      if (p.pid) allPids.add(p.pid);
      if (p.bindings) {
        for (const b of p.bindings) {
          if (b.pid) allPids.add(b.pid);
        }
      }
    }

    const pids = [...allPids];
    if (pids.length === 0) {
      resolve(portInfos);
      return;
    }

    exec(`wmic process where "ProcessId=${pids.join(' or ProcessId=')}" get ProcessId,Name,CommandLine /format:csv`,
      { encoding: 'utf8', maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        const pidToInfo = new Map();

        if (!error && stdout) {
          const lines = stdout.trim().split('\n').slice(1);
          for (const line of lines) {
            const parts = line.split(',');
            if (parts.length >= 3) {
              const cmdLine = parts.slice(1, -2).join(',').trim();
              const name = parts[parts.length - 2]?.trim();
              const pid = parseInt(parts[parts.length - 1]?.trim(), 10);
              if (pid) {
                pidToInfo.set(pid, { processName: name, commandLine: cmdLine });
              }
            }
          }
        }

        resolve(portInfos.map(info => {
          // Enrich bindings with process info
          if (info.bindings) {
            info.bindings = info.bindings.map(b => ({
              ...b,
              processName: pidToInfo.get(b.pid)?.processName || 'Unknown',
              commandLine: pidToInfo.get(b.pid)?.commandLine || ''
            }));
          }
          return {
            ...info,
            processName: pidToInfo.get(info.pid)?.processName || 'Unknown',
            commandLine: pidToInfo.get(info.pid)?.commandLine || ''
          };
        }));
      }
    );
  });
}

/**
 * Check if a specific port is in use
 * @param {number} port - Port number to check
 * @returns {Promise<Object|null>} Port info if in use, null otherwise
 */
async function checkPort(port) {
  const ports = await scanPorts();
  return ports.find(p => p.port === port) || null;
}

/**
 * Find next available port starting from a given port
 * @param {number} startPort - Port to start searching from
 * @param {number} endPort - Maximum port to check
 * @returns {Promise<number|null>} Available port or null
 */
async function findAvailablePort(startPort, endPort = startPort + 100) {
  const usedPorts = new Set((await scanPorts()).map(p => p.port));
  
  for (let port = startPort; port <= endPort; port++) {
    if (!usedPorts.has(port)) {
      return port;
    }
  }
  return null;
}

module.exports = { scanPorts, checkPort, findAvailablePort };
