/**
 * Browser profiles (plan row 26, slice 1): named, persistent, debuggable browsers.
 *
 * A profile is a name, a debug port, a browser (Chromium family), a mode
 * (headed | offscreen | headless), a start URL and a note. They live in the
 * shared PortPilot config under `browserProfiles`, written with
 * configFile.updateJson like every other config edit.
 *
 * Every profile gets its own user-data-dir under <configDir>/browser-profiles/<name>:
 * Chrome refuses a debug port on its default profile folder, and one dir is one
 * browser process. An imported profile may instead adopt an existing dir
 * (`userDataDir`, absolute) so logins made under another launcher survive.
 *
 * Launching and stopping is browserRun.js. Zero dependencies.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const configFile = require('./configFile');
const { BROWSER_IDS, browserIdFromPath } = require('./browserDetect');

const MODES = ['headed', 'offscreen', 'headless'];
const PORT_MIN = 1024;
const PORT_MAX = 65535;
// The name is also the folder name, so keep it portable: no separators, no leading dot, and no
// trailing dot (Windows drops it, so "shop." and "shop" would share one folder).
const NAME_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,62}[A-Za-z0-9_-])?$/;
// Windows device names, with or without an extension.
const RESERVED_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

class ProfileError extends Error {
  constructor(code, message) { super(message); this.name = 'ProfileError'; this.code = code; }
}

const emptyConfig = () => ({ apps: [], settings: {}, groups: [], browserProfiles: [] });
const lower = (s) => String(s).toLowerCase();
const goodName = (name) => NAME_RE.test(name) && !RESERVED_RE.test(name.split('.')[0]);
const samePath = (p) => path.resolve(p).replace(/[\\/]+$/, '').toLowerCase();

/** Profile folder root; sibling of the config so a config export never carries logins. */
const profilesRootFor = (configPath) => path.join(path.dirname(configPath), 'browser-profiles');

/**
 * The profile's user-data-dir. Re-checks what it is handed, because a hand-edited config can hold
 * anything: a default dir must come from a valid name and stay directly under the profiles root;
 * an adopted dir must be absolute and not a filesystem root, the home folder or PortPilot's own folders.
 */
function userDataDirFor(configPath, profile) {
  const root = profilesRootFor(configPath);
  if (profile.userDataDir) {
    const dir = path.resolve(String(profile.userDataDir));
    const banned = [path.parse(dir).root, os.homedir(), path.dirname(configPath), root].map(samePath);
    if (!path.isAbsolute(String(profile.userDataDir)) || banned.includes(samePath(dir))) {
      throw new ProfileError('BAD_DIR', `userDataDir "${profile.userDataDir}" is not a safe profile folder`);
    }
    return dir;
  }
  const name = String(profile.name);
  const dir = path.join(root, name);
  if (!goodName(name) || path.dirname(dir) !== root) {
    throw new ProfileError('BAD_NAME', `profile name "${name}" cannot be used as a folder name`);
  }
  return dir;
}

/** Each profile needs a folder of its own: no two resolve to the same one. Throws DUPLICATE_DIR. */
function assertDistinctDirs(configPath, profile, others) {
  const mine = samePath(userDataDirFor(configPath, profile));
  const clash = others.find((o) => samePath(userDataDirFor(configPath, o)) === mine);
  if (clash) throw new ProfileError('DUPLICATE_DIR', `profile "${clash.name}" already uses the folder ${mine}`);
}

/**
 * Validate and normalise profile fields against the profiles that already exist.
 * @param {object} fields  { name, port, browser?, mode?, url?, note?, userDataDir? }
 * @param {object[]} others profiles to stay unique against (exclude the one being edited)
 * @returns {object} the clean profile; throws ProfileError(code) otherwise
 */
function validateProfile(fields, others = []) {
  const f = fields || {};
  const name = typeof f.name === 'string' ? f.name.trim() : '';
  if (!goodName(name)) {
    throw new ProfileError('BAD_NAME', 'name must be 1-64 characters: letters, digits, dot, dash, underscore; starting with a letter or digit, not ending in a dot, not a Windows device name');
  }
  const port = Number(f.port);
  if (!Number.isInteger(port) || port < PORT_MIN || port > PORT_MAX) {
    throw new ProfileError('BAD_PORT', `port must be an integer from ${PORT_MIN} to ${PORT_MAX}`);
  }
  const browser = f.browser == null ? 'chrome' : lower(f.browser);
  if (!BROWSER_IDS.includes(browser)) {
    throw new ProfileError('BAD_BROWSER', `browser must be one of: ${BROWSER_IDS.join(', ')}`);
  }
  const mode = f.mode == null ? 'headed' : lower(f.mode);
  if (!MODES.includes(mode)) throw new ProfileError('BAD_MODE', `mode must be one of: ${MODES.join(', ')}`);

  const url = f.url == null ? '' : String(f.url).trim();
  if (url && !/^(https?|file):\/\//i.test(url) && url !== 'about:blank') {
    throw new ProfileError('BAD_URL', 'url must start with http://, https://, file:// or be about:blank');
  }
  const note = f.note == null ? '' : String(f.note).slice(0, 500);

  const clash = others.find((p) => lower(p.name) === lower(name));
  if (clash) throw new ProfileError('DUPLICATE_NAME', `a profile named "${clash.name}" already exists`);
  const portClash = others.find((p) => p.port === port);
  if (portClash) throw new ProfileError('DUPLICATE_PORT', `port ${port} is already used by profile "${portClash.name}"`);

  const out = { name, port, browser, mode, url, note };
  if (f.userDataDir != null && f.userDataDir !== '') {
    if (typeof f.userDataDir !== 'string' || !path.isAbsolute(f.userDataDir)) {
      throw new ProfileError('BAD_DIR', 'userDataDir must be an absolute path');
    }
    out.userDataDir = f.userDataDir;
  }
  return out;
}

function listProfiles(configPath) {
  const config = configFile.readJson(configPath, emptyConfig);
  return Array.isArray(config.browserProfiles) ? config.browserProfiles : [];
}

/** The stored profile, re-validated: a hand-edited config must not reach a launch argument. */
function getProfile(configPath, name) {
  const p = listProfiles(configPath).find((x) => lower(x.name) === lower(name || ''));
  if (!p) throw new ProfileError('NOT_FOUND', `no browser profile named "${name}"`);
  const clean = validateProfile(p, []);
  userDataDirFor(configPath, clean); // throws BAD_DIR / BAD_NAME on an unsafe folder
  return clean;
}

function mutateProfiles(configPath, fn) {
  return configFile.updateJson(configPath, (config) => {
    if (!Array.isArray(config.browserProfiles)) config.browserProfiles = [];
    return fn(config.browserProfiles);
  }, emptyConfig).result;
}

function addProfile(configPath, fields) {
  return mutateProfiles(configPath, (list) => {
    const p = validateProfile(fields, list);
    assertDistinctDirs(configPath, p, list);
    list.push(p);
    return p;
  });
}

/** Change fields of a profile; `name` is the key and cannot change (its folder is named after it). */
function updateProfile(configPath, name, changes) {
  return mutateProfiles(configPath, (list) => {
    const i = list.findIndex((x) => lower(x.name) === lower(name || ''));
    if (i === -1) throw new ProfileError('NOT_FOUND', `no browser profile named "${name}"`);
    const others = list.filter((_, j) => j !== i);
    const merged = validateProfile({ ...list[i], ...changes, name: list[i].name }, others);
    assertDistinctDirs(configPath, merged, others);
    list[i] = merged;
    return merged;
  });
}

/** Remove a profile. The folder (and its logins) is kept unless `purge`; an adopted dir is never deleted. */
function removeProfile(configPath, name, { purge = false } = {}) {
  // Delete the folder first: if the browser still holds it open the delete throws and the profile stays listed.
  let purged = false;
  if (purge) {
    const p = getProfile(configPath, name);
    if (!p.userDataDir) {
      fs.rmSync(userDataDirFor(configPath, p), { recursive: true, force: true });
      purged = true;
    }
  }
  const removed = mutateProfiles(configPath, (list) => {
    const i = list.findIndex((x) => lower(x.name) === lower(name || ''));
    if (i === -1) throw new ProfileError('NOT_FOUND', `no browser profile named "${name}"`);
    return list.splice(i, 1)[0];
  });
  return { removed, purged };
}

/**
 * One-time import from a launcher's pool.json. Never called automatically.
 *
 * Reads { bravePath?, profileRoot?, profiles: [{ name, port, mode, url, description }] }.
 * `description` becomes the profile's note. Entries that fail validation or clash with an
 * existing profile are skipped and reported, never partially imported.
 * @param {object} [o] { adoptDirs } keep using <profileRoot>/<name> when that folder exists
 *   (a relative profileRoot is read relative to the pool file)
 * @returns {{ imported: object[], skipped: { name, reason }[] }}
 */
function importPool(configPath, poolPath, { adoptDirs = false } = {}) {
  let pool;
  try {
    pool = JSON.parse(fs.readFileSync(poolPath, 'utf8'));
  } catch (err) {
    throw new ProfileError('BAD_POOL', `cannot read ${poolPath}: ${err.message}`);
  }
  if (!pool || !Array.isArray(pool.profiles)) throw new ProfileError('BAD_POOL', `${poolPath} has no "profiles" array`);
  const browser = browserIdFromPath(pool.bravePath || 'brave');

  const imported = [];
  const skipped = [];
  mutateProfiles(configPath, (list) => {
    for (const entry of pool.profiles) {
      const e = entry || {};
      const fields = { name: e.name, port: e.port, mode: e.mode, url: e.url, note: e.description, browser };
      if (adoptDirs && pool.profileRoot && typeof e.name === 'string') {
        const dir = path.resolve(path.dirname(poolPath), pool.profileRoot, e.name);
        if (fs.existsSync(dir)) fields.userDataDir = dir;
      }
      try {
        const p = validateProfile(fields, list);
        assertDistinctDirs(configPath, p, list);
        list.push(p);
        imported.push(p);
      } catch (err) {
        if (!(err instanceof ProfileError)) throw err;
        skipped.push({ name: String(e.name), reason: err.message });
      }
    }
  });
  return { imported, skipped };
}

module.exports = {
  MODES, PORT_MIN, PORT_MAX, ProfileError,
  profilesRootFor, userDataDirFor, assertDistinctDirs, validateProfile,
  listProfiles, getProfile, addProfile, updateProfile, removeProfile, importPool,
};
