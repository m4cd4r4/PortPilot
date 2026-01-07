/**
 * Cross-platform test helpers for Windows and Linux (WSL)
 */
const { execSync } = require('child_process');
const os = require('os');

const isWindows = os.platform() === 'win32';
const isLinux = os.platform() === 'linux';

/**
 * Check if a port is listening (cross-platform)
 */
function isPortListening(port) {
  try {
    let output;
    if (isWindows) {
      output = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf-8' });
      return output.includes('LISTENING');
    } else {
      // Linux/WSL - use ss or netstat
      try {
        output = execSync(`ss -tlnp 2>/dev/null | grep :${port}`, { encoding: 'utf-8' });
      } catch {
        output = execSync(`netstat -tlnp 2>/dev/null | grep :${port}`, { encoding: 'utf-8' });
      }
      return output.includes('LISTEN');
    }
  } catch {
    return false;
  }
}

/**
 * Get PID for a listening port (cross-platform)
 */
function getPidForPort(port) {
  try {
    let output;
    if (isWindows) {
      output = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf-8' });
      const lines = output.split('\n');
      for (const line of lines) {
        if (line.includes('LISTENING')) {
          const parts = line.trim().split(/\s+/);
          return parseInt(parts[parts.length - 1]);
        }
      }
    } else {
      // Linux/WSL - use ss first (modern), fallback to netstat
      try {
        output = execSync(`ss -tlnp 2>/dev/null | grep :${port}`, { encoding: 'utf-8' });
      } catch {
        output = execSync(`netstat -tlnp 2>/dev/null | grep :${port}`, { encoding: 'utf-8' });
      }

      // Extract PID from output
      // ss format: users:(("node",pid=12345,fd=19))
      // netstat format: PID/Program
      const pidMatch = output.match(/pid=(\d+)/) || output.match(/(\d+)\/\w+/);
      if (pidMatch) {
        return parseInt(pidMatch[1]);
      }
    }
  } catch {
    return null;
  }
}

/**
 * Kill a process by PID (cross-platform)
 */
function killProcess(pid) {
  try {
    if (isWindows) {
      execSync(`taskkill /F /PID ${pid}`, { encoding: 'utf-8' });
    } else {
      execSync(`kill -9 ${pid}`, { encoding: 'utf-8' });
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Get platform-specific test server command
 */
function getTestServerCommand() {
  // Node.js works the same on all platforms
  return 'node';
}

/**
 * Platform info for logging
 */
function getPlatformInfo() {
  return {
    platform: os.platform(),
    arch: os.arch(),
    isWindows,
    isLinux,
    isMac: os.platform() === 'darwin',
    isWSL: isLinux && process.env.WSL_DISTRO_NAME !== undefined
  };
}

module.exports = {
  isPortListening,
  getPidForPort,
  killProcess,
  getTestServerCommand,
  getPlatformInfo,
  isWindows,
  isLinux
};
