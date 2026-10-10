/**
 * Duplicate a browser profile as a template (plan row 26, slice 2b).
 *
 * The new profile gets its own folder holding only the source's installed extensions, with their
 * toolbar state. Nothing else is copied: no cookies, saved passwords, history, site data, sessions,
 * and none of the rest of the browser's preferences (decided 2026-10-10: PortPilot never copies
 * logins between profiles; each profile signs in once).
 *
 * Two layers keep it that way. The folder copy is an ALLOWLIST (a file Chromium adds in a later
 * version stays out until someone decides it is safe; `Local State` is left out because it holds the
 * key that decrypts the cookie and password stores). And `Preferences` / `Secure Preferences` are
 * not copied whole: they also carry the signed-in account, every site visited (engagement scores),
 * per-site permissions and, on Brave, the wallet, so only the `extensions` and `protection` keys are
 * written to the copy. Zero dependencies.
 */
const fs = require('fs');
const path = require('path');
const profiles = require('./browserProfiles');
const run = require('./browserRun');

const { ProfileError } = profiles;

const PREFS_FILES = [path.join('Default', 'Preferences'), path.join('Default', 'Secure Preferences')];
const EXTENSIONS_DIR = path.join('Default', 'Extensions');
/** Top-level preference keys that are written to the copy. Everything else stays behind. */
const PREFS_KEEP = ['extensions', 'protection'];
const MAX_PREFS_BYTES = 16 * 1024 * 1024;

/** Paths under the user-data-dir that are copied (for the tests and the UI wording). */
const COPY_ALLOWLIST = [...PREFS_FILES, EXTENSIONS_DIR];

/** What the result tells the caller was left out, in words for the UI. */
const LEFT_OUT = 'sign-ins, saved passwords, history, site data, open sessions and the rest of the browser settings';

/** Never follow a link out of the source folder. */
const skipLinks = (src) => {
  try { return !fs.lstatSync(src).isSymbolicLink(); } catch { return false; }
};

/**
 * The real path of `file` when it stays inside the real source folder, else null. A junction or
 * symlink anywhere on the way (a linked `Default`, say) resolves outside and is refused.
 */
function realInside(realRoot, file) {
  let real;
  try { real = fs.realpathSync(file); } catch { return null; }
  const rel = path.relative(realRoot, real);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? real : null;
}

/** Write only PREFS_KEEP from a preferences file. False when it is missing, huge or not a JSON object. */
function copyPrefs(from, to) {
  let text;
  try {
    if (fs.statSync(from).size > MAX_PREFS_BYTES) return false;
    text = fs.readFileSync(from, 'utf8').replace(/^﻿/, '');
  } catch { return false; }
  let parsed;
  try { parsed = JSON.parse(text); } catch { return false; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
  const out = {};
  for (const key of PREFS_KEEP) if (Object.prototype.hasOwnProperty.call(parsed, key)) out[key] = parsed[key];
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.writeFileSync(to, JSON.stringify(out), { flag: 'wx' });
  return true;
}

async function copyAllowlisted(fromDir, toDir) {
  const copied = [];
  let realRoot;
  try { realRoot = fs.realpathSync(fromDir); } catch { return copied; } // no folder yet: nothing to copy
  for (const rel of PREFS_FILES) {
    const from = realInside(realRoot, path.join(fromDir, rel));
    if (from && fs.statSync(from).isFile() && copyPrefs(from, path.join(toDir, rel))) copied.push(rel.split(path.sep).join('/'));
  }
  const extFrom = realInside(realRoot, path.join(fromDir, EXTENSIONS_DIR));
  if (extFrom && fs.statSync(extFrom).isDirectory()) {
    const to = path.join(toDir, EXTENSIONS_DIR);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    // Async: a password manager can be tens of MB, and this runs in the app's main process.
    await fs.promises.cp(extFrom, to, { recursive: true, filter: skipLinks, errorOnExist: true, force: false });
    copied.push(EXTENSIONS_DIR.split(path.sep).join('/'));
  }
  return copied;
}

/** A raw filesystem error never reaches a caller: its message carries absolute paths. */
function copyFailure(err) {
  const why = {
    EPERM: 'the browser or another program is holding it',
    EBUSY: 'the browser or another program is holding it',
    EACCES: 'it is not readable',
    ENOSPC: 'the disk is full',
  }[err && err.code] || 'the folder could not be read or written';
  return new ProfileError('COPY_FAILED', `could not copy the profile folder: ${why}. Close any browser window using it and try again.`);
}

/**
 * @param {string} configPath
 * @param {string} sourceName the profile to copy from
 * @param {{name: string, port: number, note?: string}} fields the new profile
 * @param {object} [deps] browserRun deps (tests pass the fake spawner)
 * @returns {Promise<{profile: object, copied: string[], leftOut: string}>}
 */
async function duplicateProfile(configPath, sourceName, fields, deps = run.defaultDeps()) {
  const src = profiles.getProfile(configPath, sourceName);
  const st = await run.profileStatus(configPath, src, deps);
  if (st.state === 'up') {
    throw new ProfileError('SOURCE_RUNNING', `"${src.name}" is running. Stop it first: a running browser holds its files open.`);
  }

  const f = fields || {};
  const clean = profiles.validateProfile({
    name: f.name,
    port: f.port,
    browser: src.browser,
    mode: src.mode,
    url: src.url,
    note: f.note == null ? src.note : f.note,
  }, profiles.listProfiles(configPath));
  const toDir = profiles.userDataDirFor(configPath, clean);
  if (fs.existsSync(toDir)) {
    throw new ProfileError('DUPLICATE_DIR', `a folder for "${clean.name}" already exists. Pick another name, or remove that folder first.`);
  }
  const fromDir = profiles.userDataDirFor(configPath, src);

  let copied;
  try {
    // Not recursive: it fails if another process made the folder since the check above, so the
    // folder we clean up on failure is always one we created.
    fs.mkdirSync(path.dirname(toDir), { recursive: true });
    fs.mkdirSync(toDir);
  } catch (err) {
    throw err && err.code === 'EEXIST'
      ? new ProfileError('DUPLICATE_DIR', `a folder for "${clean.name}" already exists. Pick another name, or remove that folder first.`)
      : copyFailure(err);
  }
  try {
    copied = await copyAllowlisted(fromDir, toDir);
  } catch (err) {
    fs.rmSync(toDir, { recursive: true, force: true });
    throw copyFailure(err);
  }

  let profile;
  try {
    profile = profiles.addProfile(configPath, clean);
  } catch (err) {
    fs.rmSync(toDir, { recursive: true, force: true });
    throw err;
  }
  return { profile, copied, leftOut: LEFT_OUT };
}

module.exports = { duplicateProfile, COPY_ALLOWLIST, PREFS_KEEP, LEFT_OUT };
