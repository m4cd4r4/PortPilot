const { spawn, exec } = require('child_process');
const os = require('os');
const path = require('path');
const { recordStop } = require('../core/configFile');

// Track running child processes
const runningProcesses = new Map();

// Listeners notified when an app that was running exits unexpectedly (i.e. not
// via stopApp). The Electron main process registers one to raise an OS
// notification; the web agent can register one to push a toast over SSE.
const crashListeners = new Set();
function onAppCrash(cb) { crashListeners.add(cb); return () => crashListeners.delete(cb); }
function emitCrash(info) {
  for (const cb of crashListeners) { try { cb(info); } catch { /* ignore */ } }
}

// A crash: the process exited after it had started successfully (announced)
// and the user did not ask to stop it (userStopped).
function isCrashed(info) {
  return !!info && info.running === false && !!info.announced && !info.userStopped;
}

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
          if (isCrashed(processInfo)) {
            // Tail taken at exit: stderr, else stdout (many dev servers print
            // their fatal error there).
            const errorTail = (processInfo.errorOutput || processInfo.output || '').slice(-2000) || null;
            emitCrash({ id, name, code, errorTail });
          }
        }
      });

      // Store process info
      runningProcesses.set(id, {
        process: childProcess,
        pid: childProcess.pid,
        name,
        port: appConfig.preferredPort || null,
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
          const info = runningProcesses.get(id);
          if (info) info.announced = true; // eligible for crash notification from now on
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

  processInfo.userStopped = true; // suppress the crash notification for a deliberate stop
  return killProcess(processInfo.pid);
}

/**
 * Kill a process by PID
 * @param {number} pid - Process ID to kill
 * @returns {Promise<Object>} Result
 */
function killProcess(pid) {
  return new Promise((resolve) => {
    // pid is interpolated into a shell command: accept only a positive integer.
    const safePid = Number(pid);
    if (!Number.isInteger(safePid) || safePid < 1 || safePid > 4194304) {
      resolve({ success: false, error: 'Invalid PID' });
      return;
    }
    const isWindows = os.platform() === 'win32';
    const command = isWindows
      ? `taskkill /F /PID ${safePid} /T`
      : `kill -9 ${safePid}`;

    // Must specify shell explicitly - Git Bash/MSYS can interfere with Windows commands
    const execOptions = { shell: isWindows ? 'cmd.exe' : '/bin/sh', windowsHide: true };

    // A kill PortPilot performs (stop, port kill, quit cleanup) is deliberate:
    // mark the managed entry so its exit is not reported or stamped as a crash.
    for (const info of runningProcesses.values()) {
      if (info.pid === safePid) info.userStopped = true;
    }

    const killed = () => {
      // Clean up from running processes map
      for (const [id, info] of runningProcesses) {
        if (info.pid === safePid) {
          runningProcesses.delete(id);
          break;
        }
      }
      resolve({ success: true, message: `Killed process ${safePid}` });
    };

    exec(command, execOptions, (error) => {
      if (!error) return killed();
      if (!isWindows) return resolve({ success: false, error: error.message });
      // taskkill failed: retry with Stop-Process (`wmic` is removed on recent Windows 11).
      const ps = `powershell -NoProfile -NonInteractive -Command "Stop-Process -Id ${safePid} -Force -ErrorAction Stop"`;
      exec(ps, execOptions, (err2) => {
        if (err2) resolve({ success: false, error: 'Failed to kill process' });
        else killed();
      });
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

  // The tracked pid is the shell's, not the server's, so killProcess's pid
  // match misses it. Match the managed app by the port it was started on too.
  const marked = [];
  for (const info of runningProcesses.values()) {
    if (!info.userStopped && (info.pid === portInfo.pid || (info.port && Number(info.port) === Number(port)))) {
      info.userStopped = true;
      marked.push(info);
    }
  }
  const result = await killProcess(portInfo.pid);
  // A failed kill leaves the app running: a later real crash must still count.
  if (!result.success) for (const info of marked) info.userStopped = false;
  return result;
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
      crashed: isCrashed(info),
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
 * @param {string} [configPath] - config file path; when given, each tracked
 *   app's runtime-sidecar entry is dropped so quitting leaves no ghosts
 * @returns {Promise<void>}
 */
async function cleanupAllProcesses(configPath) {
  const pids = [];
  const ids = [...runningProcesses.keys()];

  for (const [id, info] of runningProcesses) {
    if (info.process && !info.process.killed && info.pid) {
      pids.push(info.pid);
    }
  }

  // Kill all tracked processes
  await Promise.all(pids.map(pid => killProcess(pid)));
  runningProcesses.clear();
  if (configPath) for (const id of ids) recordStop(configPath, id);
}

module.exports = {
  startApp,
  stopApp,
  killProcess,
  killByPort,
  getRunningApps,
  getAppLogs,
  cleanupAllProcesses,
  onAppCrash,
  isCrashed
};
