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
    // Run netstat without findstr so the output is not filtered by locale-specific
    // state strings (e.g. German "ABHÖREN", French "EN ÉCOUTE", Spanish "ESCUCHANDO").
    // Instead we identify LISTENING sockets in JS: they always have a foreign address
    // of "0.0.0.0:0" or "[::]:0" (port :0 = no remote connection), which is
    // locale-independent on every Windows installation.
    exec('netstat -ano', { encoding: 'utf8', timeout: 15000 }, (error, stdout) => {
      if (error && !stdout) {
        resolve([]);
        return;
      }

      const lines = stdout.trim().split('\n')
        .filter(l => /^\s*TCP\b/i.test(l));  // TCP lines only
      const portMap = new Map();

      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 5) {
          const localAddress = parts[1];
          const foreignAddress = parts[2];
          const pid = parseInt(parts[4], 10);

          // Only listening sockets have foreign port 0 - locale-independent check
          if (!foreignAddress || !foreignAddress.match(/:0$/)) continue;

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

/** Get process names + command lines for Windows PIDs (batched, one spawn) */
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

    // Only keep numeric PIDs to prevent query injection
    const pids = [...allPids].filter(p => Number.isInteger(p) && p > 0 && p <= 4194304);
    if (pids.length === 0) {
      resolve(portInfos);
      return;
    }

    queryWindowsProcessInfo(pids).then((pidToInfo) => {
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
    });
  });
}

/**
 * Resolve PID -> { processName, commandLine } on Windows.
 * Primary: PowerShell Get-CimInstance. Fallback: `tasklist`, which gives image
 * names but no command line. (`wmic` is not used: it is removed on recent
 * Windows 11 builds.) PIDs are pre-validated as integers by the caller, so WQL
 * injection isn't possible.
 */
function queryWindowsProcessInfo(pids) {
  return new Promise((resolve) => {
    const filter = pids.map(p => `ProcessId=${p}`).join(' or ');
    const psCmd =
      `powershell -NoProfile -NonInteractive -Command ` +
      `"Get-CimInstance Win32_Process -Filter '${filter}' | ` +
      `Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress"`;

    exec(psCmd, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 15000, windowsHide: true },
      (error, stdout) => {
        const map = new Map();
        if (!error && stdout && stdout.trim()) {
          try {
            let data = JSON.parse(stdout);
            if (!Array.isArray(data)) data = [data];
            for (const proc of data) {
              const pid = parseInt(proc.ProcessId, 10);
              if (pid) {
                map.set(pid, {
                  processName: (proc.Name || 'Unknown').trim(),
                  commandLine: (proc.CommandLine || '').trim()
                });
              }
            }
          } catch { /* malformed JSON -> fall through to tasklist */ }
        }

        if (map.size > 0) {
          resolve(map);
        } else {
          queryWindowsProcessInfoTasklist(pids).then(resolve);
        }
      }
    );
  });
}

/**
 * Parse `tasklist /fo csv /nh` output into Map<pid, { name, memoryKb }>.
 * Columns: "Image Name","PID","Session Name","Session#","Mem Usage". Mem Usage
 * is locale-formatted ("12,345 K", "12.345 K"), so only its digits are kept.
 * @param {string} stdout
 * @param {Iterable<number>} [wantedPids] keep only these PIDs (default: all)
 */
function parseTasklistCsv(stdout, wantedPids) {
  const wanted = wantedPids ? new Set(wantedPids) : null;
  const map = new Map();
  for (const line of String(stdout || '').split(/\r?\n/)) {
    const m = line.match(/^"([^"]*)","(\d+)"(?:,"[^"]*","[^"]*","([^"]*)")?/);
    if (!m) continue;
    const pid = parseInt(m[2], 10);
    if (wanted && !wanted.has(pid)) continue;
    const digits = (m[3] || '').replace(/\D/g, '');
    map.set(pid, { name: m[1].trim(), memoryKb: digits ? parseInt(digits, 10) : null });
  }
  return map;
}

/** Fallback when PowerShell/CIM is unavailable: image names via `tasklist`. */
function queryWindowsProcessInfoTasklist(pids) {
  return new Promise((resolve) => {
    exec('tasklist /fo csv /nh', { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 10000, windowsHide: true },
      (error, stdout) => {
        const map = new Map();
        if (!error) {
          for (const [pid, info] of parseTasklistCsv(stdout, pids)) {
            map.set(pid, { processName: info.name || 'Unknown', commandLine: '' });
          }
        }
        resolve(map);
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

module.exports = { scanPorts, checkPort, findAvailablePort, parseTasklistCsv };
