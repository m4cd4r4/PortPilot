/**
 * Read-only list of the extensions installed in a browser profile's folder (plan row 26, slice 2b).
 *
 * PortPilot never installs or edits extensions: a password manager is installed once, from the
 * browser's own store, in a headed start. This only reads what is there, so the panel can show it
 * and Duplicate can say what carried over. Chromium layout: <user-data-dir>/Default/Extensions/
 * <id>/<version>/manifest.json. Zero dependencies.
 */
const fs = require('fs');
const path = require('path');

const ID_RE = /^[a-p]{32}$/;
const LOCALE_RE = /^[A-Za-z]{2,3}([_-][A-Za-z0-9]{2,8})?$/;
const MAX_JSON_BYTES = 1024 * 1024;
const MAX_EXTENSIONS = 100;

function readJsonSmall(file) {
  try {
    if (fs.statSync(file).size > MAX_JSON_BYTES) return null;
    // Some manifests carry a byte-order mark.
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  } catch { return null; }
}

/** "1.10.2" sorts after "1.9.0": compare the numeric parts, not the characters. */
function compareVersions(a, b) {
  const pa = String(a).split(/[._-]/).map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split(/[._-]/).map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

/** A manifest name is often "__MSG_appName__", which lives in _locales/<lang>/messages.json. */
function resolveName(manifest, versionDir, id) {
  const raw = typeof manifest.name === 'string' ? manifest.name.trim() : '';
  const m = /^__MSG_(.+)__$/.exec(raw);
  if (!m) return raw || id;
  // default_locale becomes a folder name: only a plain locale code may, never a path.
  const own = typeof manifest.default_locale === 'string' && LOCALE_RE.test(manifest.default_locale) ? manifest.default_locale : null;
  const langs = [own, 'en', 'en_US', 'en_GB'].filter(Boolean);
  for (const lang of langs) {
    const messages = readJsonSmall(path.join(versionDir, '_locales', String(lang), 'messages.json'));
    if (!messages) continue;
    const key = Object.keys(messages).find((k) => k.toLowerCase() === m[1].toLowerCase());
    const text = key && messages[key] && typeof messages[key].message === 'string' ? messages[key].message.trim() : '';
    if (text) return text;
  }
  return id;
}

/**
 * @param {string} userDataDir the profile's folder
 * @returns {{id: string, name: string, version: string}[]} sorted by name; [] when none or unreadable
 */
function listExtensions(userDataDir) {
  const root = path.join(userDataDir, 'Default', 'Extensions');
  let ids;
  try { ids = fs.readdirSync(root); } catch { return []; }
  const out = [];
  for (const id of ids) {
    if (!ID_RE.test(id)) continue; // skips "Temp" and anything a hand edit left behind
    let versions;
    try { versions = fs.readdirSync(path.join(root, id)); } catch { continue; }
    versions.sort(compareVersions);
    const version = versions[versions.length - 1];
    if (!version) continue;
    const versionDir = path.join(root, id, version);
    const manifest = readJsonSmall(path.join(versionDir, 'manifest.json'));
    if (!manifest || typeof manifest !== 'object') continue;
    out.push({ id, name: resolveName(manifest, versionDir, id), version: String(manifest.version || version.replace(/_\d+$/, '')) });
    if (out.length >= MAX_EXTENSIONS) break;
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = { listExtensions };
