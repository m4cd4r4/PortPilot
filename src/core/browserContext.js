/**
 * The session-start note that tells Claude which browser profiles the user has set up, so that
 * "access Google Search Console" needs no port and no explanation (plan row 26, purpose routing).
 *
 * `browserContextBlock(config)` reads the profiles out of a PortPilot config object and returns
 * the text for one context block, or '' when there is nothing to say. It is deliberately lossy:
 * it never carries a user-data-dir or any other path, never a URL query string or fragment, a
 * note only up to 80 characters, at most 25 profiles, and the whole block stays under 2 KB.
 * Everything in it comes from user-authored config, so it is flattened to plain single-line text.
 *
 * Pure, zero dependencies, no Node built-ins: bundled into the Claude Code plugin's hooks
 * (scripts/build-plugin.mjs -> plugin/hooks/lib/core.mjs). Never throws.
 */
'use strict';

const { normaliseHost } = require('./browserMatch');

const MAX_PROFILES = 25;
const MAX_BYTES = 2048;
const NOTE_MAX = 80;
const PURPOSE_MAX = 120;
const SITES_SHOWN = 6;
const NAME_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,62}[A-Za-z0-9_-])?$/;
const MODES = ['headed', 'offscreen', 'headless'];

const HEAD = 'PortPilot browser profiles (set up by the user; each owns its debug port and its logins):';
const RULES = [
  'For a task on one of these sites, call start_browser with `for` set to the site or the task, then connect to the cdpUrl it returns.',
  'Never launch a browser or pick a debug port yourself; name "any" is only for a throwaway browser with no logins.',
  'If no profile matches, tell the user which site has none and offer nothing else.',
];

/** UTF-8 length of a string without Buffer or TextEncoder. */
function byteLength(s) {
  let n = 0;
  for (const ch of String(s)) {
    const c = ch.codePointAt(0);
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  }
  return n;
}

/**
 * One line of plain text: no newlines or control characters, no URL query or fragment, no file
 * or UNC path, no markup that would read as an instruction block. Cut to `max` characters.
 */
function flat(value, max) {
  let t = String(value == null ? '' : value)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/(?:[^\s/?#@]*@)?([^\s/?#:]*)[^\s,;)]*/gi, '$1') // a URL keeps only its host
    .replace(/(?<![A-Za-z0-9])[A-Za-z]:[\\/][^\s,;)]*/g, '') // C:\dir\file, C:/dir/file
    .replace(/\\\\[^\s,;)]+/g, '')                    // \\server\share
    .replace(/(?:^|\s)(?:~|\.{1,2})?\/(?:[\w.~@+-]+\/)+[\w.~@+-]*/g, ' ') // /usr/local/x, ~/x
    .replace(/[?#][^\s,;)]*/g, '')                     // query strings and fragments
    .replace(/[`<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (t.length > max) t = `${t.slice(0, max - 3).trimEnd()}...`;
  return t;
}

function lineOf(p) {
  const name = typeof p.name === 'string' ? p.name : '';
  const port = Number(p.port);
  if (!NAME_RE.test(name) || !Number.isInteger(port) || port < 1024 || port > 65535) return null;
  const mode = MODES.includes(p.mode) ? p.mode : 'headed';
  const what = flat(p.purpose, PURPOSE_MAX) || flat(p.note, NOTE_MAX);
  const all = Array.isArray(p.sites) ? p.sites.map(normaliseHost).filter(Boolean) : [];
  const shown = all.slice(0, SITES_SHOWN);
  const sites = shown.length ? ` [${shown.join(', ')}${all.length > shown.length ? ', ...' : ''}]` : '';
  return `${name} :${port} ${mode}${what ? ` - ${what}` : ''}${sites}`;
}

/**
 * @param {object|null} config a parsed portpilot-config.json
 * @returns {string} the block text, or '' with no usable profiles
 */
function browserContextBlock(config) {
  try {
    const list = config && Array.isArray(config.browserProfiles) ? config.browserProfiles : [];
    const usable = list.filter((p) => p && typeof p === 'object');
    // Profiles that say what they are for come first: they are the ones a task can be routed to.
    const ranked = [...usable.filter((p) => p.purpose || (Array.isArray(p.sites) && p.sites.length)),
      ...usable.filter((p) => !(p.purpose || (Array.isArray(p.sites) && p.sites.length)))];
    const lines = [];
    for (const p of ranked.slice(0, 500)) {
      const l = lineOf(p);
      if (l) lines.push(l);
    }
    if (!lines.length) return '';

    const build = (n) => {
      const left = lines.length - n;
      return [HEAD, ...lines.slice(0, n), ...(left > 0 ? [`+${left} more: call list_browser_profiles`] : []), ...RULES].join('\n');
    };
    let n = Math.min(lines.length, MAX_PROFILES);
    let text = build(n);
    while (n > 0 && byteLength(text) > MAX_BYTES) { n -= 1; text = build(n); }
    return n > 0 ? text : '';
  } catch {
    return '';
  }
}

module.exports = { browserContextBlock, byteLength, flat, MAX_PROFILES, MAX_BYTES, NOTE_MAX };
