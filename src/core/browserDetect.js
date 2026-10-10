/**
 * Chromium-family browser detection (plan row 26).
 *
 * Returns the installed browsers PortPilot can launch with --remote-debugging-port.
 * Firefox and Safari are out of scope. Pure apart from the `exists` probe, which
 * is injectable so tests run on any OS. Zero dependencies.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const BROWSERS = [
  { id: 'chrome', label: 'Google Chrome' },
  { id: 'edge', label: 'Microsoft Edge' },
  { id: 'brave', label: 'Brave' },
  { id: 'chromium', label: 'Chromium' },
  { id: 'opera', label: 'Opera' },
  { id: 'vivaldi', label: 'Vivaldi' },
];
const BROWSER_IDS = BROWSERS.map((b) => b.id);

// Windows: relative to each of %ProgramFiles%, %ProgramFiles(x86)%, %LOCALAPPDATA%.
const WIN = {
  chrome: ['Google\\Chrome\\Application\\chrome.exe'],
  edge: ['Microsoft\\Edge\\Application\\msedge.exe'],
  brave: ['BraveSoftware\\Brave-Browser\\Application\\brave.exe'],
  chromium: ['Chromium\\Application\\chrome.exe'],
  opera: ['Opera\\opera.exe', 'Programs\\Opera\\opera.exe'],
  vivaldi: ['Vivaldi\\Application\\vivaldi.exe'],
};

// macOS: relative to /Applications and ~/Applications.
const MAC = {
  chrome: ['Google Chrome.app/Contents/MacOS/Google Chrome'],
  edge: ['Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
  brave: ['Brave Browser.app/Contents/MacOS/Brave Browser'],
  chromium: ['Chromium.app/Contents/MacOS/Chromium'],
  opera: ['Opera.app/Contents/MacOS/Opera'],
  vivaldi: ['Vivaldi.app/Contents/MacOS/Vivaldi'],
};

// Linux: executable names searched on PATH, then a few fixed install dirs.
const LINUX = {
  chrome: ['google-chrome', 'google-chrome-stable'],
  edge: ['microsoft-edge', 'microsoft-edge-stable'],
  brave: ['brave-browser', 'brave', 'brave-browser-stable'],
  chromium: ['chromium', 'chromium-browser'],
  opera: ['opera'],
  vivaldi: ['vivaldi', 'vivaldi-stable'],
};
const LINUX_DIRS = ['/usr/bin', '/usr/local/bin', '/snap/bin', '/opt/google/chrome', '/opt/brave.com/brave',
  '/opt/microsoft/msedge', '/opt/vivaldi', '/opt/opera'];

function isFile(p) {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

function candidatesFor(id, platform, env, home) {
  if (platform === 'win32') {
    const roots = [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA].filter(Boolean);
    return roots.flatMap((r) => WIN[id].map((rel) => path.win32.join(r, rel)));
  }
  if (platform === 'darwin') {
    return ['/Applications', path.posix.join(home, 'Applications')]
      .flatMap((r) => MAC[id].map((rel) => path.posix.join(r, rel)));
  }
  const dirs = [...String(env.PATH || '').split(':').filter(Boolean), ...LINUX_DIRS];
  return dirs.flatMap((d) => LINUX[id].map((n) => path.posix.join(d, n)));
}

/**
 * Installed Chromium-family browsers, in BROWSERS order.
 * @param {object} [o] { platform, env, home, exists } - all injectable for tests
 * @returns {{ id, label, path }[]} first existing executable per browser
 */
function detectBrowsers(o = {}) {
  const platform = o.platform || process.platform;
  const env = o.env || process.env;
  const home = o.home || os.homedir();
  const exists = o.exists || isFile;
  const found = [];
  for (const b of BROWSERS) {
    const hit = candidatesFor(b.id, platform, env, home).find((p) => exists(p));
    if (hit) found.push({ id: b.id, label: b.label, path: hit });
  }
  return found;
}

/** Guess a browser id from an executable path (pool.json import). Falls back to 'chromium'. */
function browserIdFromPath(exePath) {
  const base = String(exePath || '').toLowerCase();
  if (base.includes('brave')) return 'brave';
  if (base.includes('msedge') || base.includes('microsoft edge') || base.includes('microsoft-edge')) return 'edge';
  if (base.includes('vivaldi')) return 'vivaldi';
  if (base.includes('opera')) return 'opera';
  if (base.includes('chrome') && !base.includes('chromium')) return 'chrome';
  return 'chromium';
}

module.exports = { BROWSERS, BROWSER_IDS, detectBrowsers, browserIdFromPath };
