const { spawn, exec } = require('child_process');
const os = require('os');
const path = require('path');

// Track running child processes
const runningProcesses = new Map();

/**
 * Start an application
 * @param {Object} appConfig - App configuration
 * @returns {Promise<Object>} Result with pid and port info
 */
async function startApp(appConfig) {
  const { id, name, command, cwd, env = {} } = appConfig;

  // Check if already running
  if (runningProcesses.has(id)) {
    const existing = runningProcesses.get(id);
    // Only block if process is still alive (not killed AND no exit code)
    if (existing.process && !existing.process.killed && existing.process.exitCode === null && existing.running) {
      return { success: false, error: 'App is already running', pid: existing.process.pid };
    }
    // Clean up dead process entry
    runningProcesses.delete(id);
  }

  return new Promise((resolve) => {
    try {
      const isWindows = os.platform() === 'win32';

      // Use exec with explicit ComSpec for Windows
      const execEnv = {
        ...process.env,
        ...env,
        ComSpec: process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe'
      };

      // Auto-set PORT environment variable if preferredPort is specified
      // This ensures apps like react-scripts, vite, etc. use the correct port
      if (appConfig.preferredPort && !execEnv.PORT) {
        execEnv.PORT = appConfig.preferredPort.toString();
      }

      const childProcess = exec(command, {
        cwd: cwd || process.cwd(),
        env: execEnv,
        windowsHide: true,
        maxBuffer: 10 * 1024 * 1024,
        shell: isWindows ? 'C:\\Windows\\System32\\cmd.exe' : '/bin/sh'
      });

      let output = '';
      let errorOutput = '';

      childProcess.stdout?.on('data', (data) => {
        output += data.toString();
        // Update stored output
        if (runningProcesses.has(id)) {
          runningProcesses.get(id).output = output.slice(-10000); // Keep last 10KB
        }
      });

      childProcess.stderr?.on('data', (data) => {
        errorOutput += data.toString();
        if (runningProcesses.has(id)) {
          runningProcesses.get(id).errorOutput = errorOutput.slice(-10000);
        }
      });

      childProcess.on('error', (err) => {
        runningProcesses.delete(id);
        resolve({ success: false, error: err.message });
      });

      childProcess.on('exit', (code) => {
        const processInfo = runningProcesses.get(id);
        if (processInfo) {
          processInfo.exitCode = code;
          processInfo.running = false;
        }
      });

      // Store process info
      runningProcesses.set(id, {
        process: childProcess,
        pid: childProcess.pid,
        name,
        command,
        cwd,
        startTime: new Date(),
        running: true,
        output: '',
        errorOutput: ''
      });

      // Give it a moment to start
      setTimeout(() => {
        if (childProcess.killed || childProcess.exitCode !== null) {
          runningProcesses.delete(id); // Clean up failed start
          resolve({
            success: false,
            error: errorOutput || 'Process exited immediately',
            exitCode: childProcess.exitCode
          });
        } else {
          resolve({
            success: true,
            pid: childProcess.pid,
            message: `Started ${name}`
          });
        }
      }, 500);

    } catch (err) {
      resolve({ success: false, error: err.message });
    }
  });
}

/**
 * Stop a running application by ID
 * @param {string} appId - App identifier
 * @returns {Promise<Object>} Result
 */
async function stopApp(appId) {
  const processInfo = runningProcesses.get(appId);
  
  if (!processInfo || !processInfo.process) {
    return { success: false, error: 'App not found or not running' };
  }

  return killProcess(processInfo.pid);
}

/**
 * Kill a process by PID
 * @param {number} pid - Process ID to kill
 * @returns {Promise<Object>} Result
 */
function killProcess(pid) {
  return new Promise((resolve) => {
    const isWindows = os.platform() === 'win32';
    const command = isWindows
      ? `taskkill /F /PID ${pid} /T`
      : `kill -9 ${pid}`;

    // Must specify shell explicitly - Git Bash/MSYS can interfere with Windows commands
    const execOptions = { shell: isWindows ? 'cmd.exe' : '/bin/sh' };

    exec(command, execOptions, (error) => {
      if (error) {
        // Try alternative methods
        if (isWindows) {
          exec(`wmic process where ProcessId=${pid} delete`, execOptions, (err2) => {
            resolve({
              success: !err2,
              error: err2 ? 'Failed to kill process' : null
            });
          });
        } else {
          resolve({ success: false, error: error.message });
        }
      } else {
        // Clean up from running processes map
        for (const [id, info] of runningProcesses) {
          if (info.pid === pid) {
            runningProcesses.delete(id);
            break;
          }
        }
        resolve({ success: true, message: `Killed process ${pid}` });
      }
    });
  });
}

/**
 * Kill process using a specific port
 * @param {number} port - Port number
 * @returns {Promise<Object>} Result
 */
async function killByPort(port) {
  const { checkPort } = require('./portScanner');
  const portInfo = await checkPort(port);
  
  if (!portInfo || !portInfo.pid) {
    return { success: false, error: `No process found on port ${port}` };
  }

  return killProcess(portInfo.pid);
}

/**
 * Get status of all managed processes
 * @returns {Array} Array of process status objects
 */
function getRunningApps() {
  const apps = [];
  
  for (const [id, info] of runningProcesses) {
    apps.push({
      id,
      pid: info.pid,
      name: info.name,
      command: info.command,
      cwd: info.cwd,
      running: info.running && info.process && !info.process.killed,
      startTime: info.startTime,
      exitCode: info.exitCode,
      outputTail: info.output?.slice(-500),
      errorTail: info.errorOutput?.slice(-500)
    });
  }
  
  return apps;
}

/**
 * Get logs for a specific app
 * @param {string} appId - App identifier
 * @returns {Object} Logs object
 */
function getAppLogs(appId) {
  const processInfo = runningProcesses.get(appId);
  
  if (!processInfo) {
    return { stdout: '', stderr: '', error: 'App not found' };
  }

  return {
    stdout: processInfo.output || '',
    stderr: processInfo.errorOutput || ''
  };
}

/**
 * Clean up all running processes (called on app quit)
 * @returns {Promise<void>}
 */
async function cleanupAllProcesses() {
  const pids = [];

  for (const [id, info] of runningProcesses) {
    if (info.process && !info.process.killed && info.pid) {
      pids.push(info.pid);
    }
  }

  // Kill all tracked processes
  await Promise.all(pids.map(pid => killProcess(pid)));
  runningProcesses.clear();
}

module.exports = {
  startApp,
  stopApp,
  killProcess,
  killByPort,
  getRunningApps,
  getAppLogs,
  cleanupAllProcesses
};
