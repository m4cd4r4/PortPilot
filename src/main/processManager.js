const { spawn, exec } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { recordStop, logPathFor, readFileTail } = require('../core/configFile');
const { isOwnPid } = require('../core/selfGuard');

// A kill aimed at PortPilot itself (Electron main, the MCP child, the in-process web agent):
// refused before any shell command runs. `taskkill /T` on the main pid would take every managed
// dev server down with it.
function refuseOwn(pid) {
  return { success: false, error: `Process ${pid} is PortPilot itself; it is never killed from here` };
}

// Track running child processes
const runningProcesses = new Map();

// An app's output goes to logs/<appId>.log beside the config (the file MCP starts write too), never
// through a pipe to this process: a server left running by quit (quitApps.js) would die on its first
// log line once the pipe's reader was gone (EPIPE, F92). The in-app log reads the file's tail.
let logConfigPath = null;
function setLogConfigPath(configPath) { logConfigPath = configPath || null; }
function logFileFor(appId) {
  if (logConfigPath) return logPathFor(logConfigPath, appId);
  const safe = String(appId).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 120);
  return path.join(os.tmpdir(), 'portpilot-logs', `${safe}.log`);
}
// A log over this size is moved to <id>.log.1 at Start (replacing the previous one).
const LOG_ROTATE_BYTES = 10 * 1024 * 1024;

/**
 * Open the app's log for the child to write, appending (F104): an older copy of the app may still
 * be running and writing it, and truncating under it fills the file with NULs. Over the size cap it
 * is rotated first. Returns { fd, from } (from = where this run's output starts), or null (output
 * discarded) when it cannot be opened.
 */
function openLog(file) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    let size = 0;
    try { size = fs.statSync(file).size; } catch { /* new file */ }
    if (size > LOG_ROTATE_BYTES) {
      try { fs.renameSync(file, `${file}.1`); size = 0; } catch { /* held without delete sharing: keep appending */ }
    }
    return { fd: fs.openSync(file, 'a'), from: size };
  } catch {
    return null;
  }
}

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

      // stdout and stderr go straight to the log file (no pipe, no maxBuffer kill).
      const logFile = logFileFor(id);
      const log = openLog(logFile);
      const fd = log ? log.fd : null;
      const out = fd == null ? 'ignore' : fd;
      let childProcess;
      try {
        childProcess = spawn(command, {
          cwd: cwd || process.cwd(),
          env: execEnv,
          windowsHide: true,
          stdio: ['ignore', out, out],
          shell: isWindows ? 'C:\\Windows\\System32\\cmd.exe' : '/bin/sh',
          // Unix: its own process group (pgid = the shell's pid), so Stop and quit can kill the
          // shell and the server under it together (F106). Windows uses taskkill /T instead.
          detached: !isWindows
        });
      } finally {
        if (fd != null) { try { fs.closeSync(fd); } catch { /* the child has its own handle */ } }
      }
      // This run's output only: the log may hold an earlier run's lines before `from`.
      const tail = (chars) => (fd == null ? '' : readFileTail(logFile, chars, log.from) || '');

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
            const errorTail = tail(2000) || null;
            emitCrash({ id, name, code, errorTail, pid: processInfo.pid, at: Date.now() });
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
        group: !isWindows, // leads its own process group (detached)
        logFile: fd == null ? null : logFile
      });

      // Give it a moment to start
      setTimeout(() => {
        if (childProcess.killed || childProcess.exitCode !== null) {
          runningProcesses.delete(id); // Clean up failed start
          const exited = childProcess.exitCode !== null;
          const said = tail(2000);
          resolve({
            success: false,
            error: said || 'Process exited immediately',
            exitCode: childProcess.exitCode,
            // Dead on arrival: the desktop Start handler turns this into a crash
            // (toast, Diagnose, Ask Claude) so it is not just a one-line error.
            exited,
            errorTail: exited ? (said || null) : null
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
 * @param {{configPath?: string}} [opts] - with configPath, an app an earlier session started (left
 *   running by a quit, adopted on relaunch) is stopped too, once adoptedApps proves the server is it (F42)
 * @returns {Promise<Object>} Result
 */
async function stopApp(appId, { configPath } = {}) {
  const processInfo = runningProcesses.get(appId);

  if (!processInfo || !processInfo.process) {
    if (configPath) return require('./adoptedApps').stopAdopted(configPath, appId);
    return { success: false, error: 'App not found or not running' };
  }

  processInfo.userStopped = true; // suppress the crash notification for a deliberate stop
  return killProcess(processInfo.pid);
}

/**
 * Does `pid` lead the process group of a tracked app that is still running? Only then may its
 * group be signalled: once the app's shell exited its pid (and so a group id) can be reused by an
 * unrelated process (F108). Never pid 1, never on Windows (taskkill /T there).
 */
function leadsLiveGroup(infos, pid, platform) {
  if (platform === 'win32' || !(pid > 1)) return false;
  for (const i of infos) {
    if (i.pid === pid && i.group && i.process && i.process.exitCode === null && i.process.signalCode === null) return true;
  }
  return false;
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
    if (isOwnPid(safePid)) {
      resolve(refuseOwn(safePid));
      return;
    }
    const isWindows = os.platform() === 'win32';
    // Unix: an app this session started leads its own process group; `kill -9 <shell>` alone left
    // the server under it running (F106), so the whole group goes.
    const leadsGroup = leadsLiveGroup(runningProcesses.values(), safePid, os.platform());
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

    if (leadsGroup && safePid > 1) {
      // Signal the group from here: the shell's `kill` builtin differs between dash and bash.
      try { process.kill(-safePid, 'SIGKILL'); return killed(); } catch { /* group gone: fall back to the pid */ }
    }

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
  if (isOwnPid(portInfo.pid)) return refuseOwn(portInfo.pid);

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

// When each app's crash was last dismissed: a crash handler still inside its
// delay must not stamp a crash the person has already dismissed.
const dismissedAt = new Map();

/** Forget a dead app's entry so it no longer reads crashed. A live one is kept. */
function forgetCrash(appId, { dismissed = false } = {}) {
  if (dismissed) dismissedAt.set(appId, Date.now());
  const info = runningProcesses.get(appId);
  if (!info || (info.running && info.process && !info.process.killed)) return false;
  runningProcesses.delete(appId);
  return true;
}

/** True when the app's crash was dismissed at or after `at`. */
function dismissedSince(appId, at) {
  const t = dismissedAt.get(appId);
  return t != null && t >= at;
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
      crashed: isCrashed(info)
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
  // An app this session did not start (adopted after a relaunch) still has its log file.
  const file = processInfo ? processInfo.logFile : logFileFor(appId);
  const stdout = file ? readFileTail(file, 10000) : null;
  if (!processInfo && stdout == null) {
    return { stdout: '', stderr: '', error: 'App not found' };
  }
  // One file holds both streams, in the order they were written.
  return { stdout: stdout || '', stderr: '' };
}

/**
 * Clean up all running processes (called on app quit)
 * @param {string} [configPath] - config file path; when given, each tracked
 *   app's runtime-sidecar entry is dropped so quitting leaves no ghosts
 * @returns {Promise<void>}
 */
async function cleanupAllProcesses(configPath) {
  const pids = [];
  const ids = [];

  for (const [id, info] of runningProcesses) {
    // A crashed app's run is already closed and its stamp must survive the quit; any other exit still gets its stop recorded.
    if (isCrashed(info)) continue;
    ids.push(id);
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
  emitCrash,
  forgetCrash,
  dismissedSince,
  isCrashed,
  setLogConfigPath,
  leadsLiveGroup
};
