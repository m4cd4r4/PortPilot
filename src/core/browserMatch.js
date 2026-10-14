/**
 * Which browser profile is for this? (plan row 26, purpose routing)
 *
 * `matchProfiles(profiles, query)` ranks profiles against free text ("google search console",
 * "facebook") or a URL, using only what the profile itself says: its `sites`, name, `purpose`,
 * note and start-URL host. There is no built-in knowledge of any site: "gsc" finds a profile only
 * when the user wrote "gsc" in its purpose or name. When the two best profiles score too close to
 * call it refuses to pick one and says so.
 *
 * Also the one place that knows what a valid hostname is (`normaliseHost`), so profile validation
 * and the session-start context read the same rule.
 *
 * Pure, zero dependencies, no Node built-ins: it is bundled into the Claude Code plugin's hooks.
 */
'use strict';

/** Scores. A site match outranks any amount of word overlap. */
const SCORE = {
  SITE_EXACT: 100,        // the query host is the profile's site
  SITE_UNDER: 90,        // the query host is a subdomain of the profile's site
  SITE_RELATED: 50,      // same registrable domain, or the profile's site is below the query host
  URL_HOST_EXACT: 60,    // the profile's start URL is on the query host (weaker than a declared site)
  URL_HOST_RELATED: 30,
  NAME_EXACT: 200,       // the query IS the profile name
  PURPOSE_WORD: 10,
  NAME_WORD: 8,
  SITE_LABEL: 6,         // "facebook" from facebook.com
  URL_LABEL: 4,
  NOTE_WORD: 5,
  PHRASE: 10,            // the whole query appears in the purpose, in order
};
/** A profile needs at least this much to count as a match at all. */
const MIN_SCORE = 5;
/** The runner-up is "close" at this share of the best score: the caller must not guess. */
const AMBIGUITY_RATIO = 0.75;

// Words that say what the caller wants to DO, not which profile: dropped from the query.
const STOP_WORDS = new Set((
  'a an the for to of on in at and or my our your with from via by into onto this that these those it its is are be '
  + 'use using used open access go check visit start launch get need want run do does please can could would should '
  + 'me i we you us up out about as any one some '
  + 'browser profile port portpilot claude site website web page pages tab tabs login log sign signin'
).split(/\s+/));

const HOST_RE = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;
const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'gov', 'edu', 'ac', 'or', 'ne', 'go']);

/**
 * A clean lowercase hostname from `value`, or null. Accepts only a bare host: no scheme, path,
 * port, query, credentials, wildcard or spaces. Case is folded; a trailing dot is dropped.
 */
function normaliseHost(value) {
  if (typeof value !== 'string') return null;
  const h = value.trim().toLowerCase().replace(/\.$/, '');
  if (!h || h.length > 253 || !HOST_RE.test(h)) return null;
  return h;
}

/** example.com for www.example.com, example.co.uk for a.b.example.co.uk, the host itself otherwise. */
function registrable(host) {
  const labels = host.split('.');
  if (labels.length <= 2) return host;
  const tld = labels[labels.length - 1];
  const second = labels[labels.length - 2];
  const keep = tld.length === 2 && SECOND_LEVEL.has(second) ? 3 : 2;
  return labels.slice(-keep).join('.');
}

const stripWww = (h) => h.replace(/^www\./, '');
const isUnder = (host, parent) => host !== parent && host.endsWith(`.${parent}`);

/** Lowercase words of `text`: splits on anything that is not a letter or digit, and on camelCase. */
function wordsOf(text) {
  return String(text == null ? '' : text)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** "pages" and "page" meet: one trailing s is folded. */
const fold = (w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w);

/** The host of a URL-looking or host-looking token, or null. */
function hostOfToken(token) {
  const t = token.replace(/^[("'<\[]+|[)"'>\],.;:!?]+$/g, '');
  const m = t.match(/^(?:[a-z][a-z0-9+.-]*:\/\/)?(?:[^@/\s]*@)?([^/?#:\s]+)(?::\d+)?(?:[/?#]|$)/i);
  if (!m) return null;
  const host = normaliseHost(m[1]);
  // A bare word is not a host; "localhost" and anything with a dot (and a letter TLD) is.
  if (!host) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) return stripWww(host);
  return /\.[a-z]{2,}$/.test(host) || host === 'localhost' ? stripWww(host) : null;
}

/**
 * What the query asks about: hosts found in it, and the words left once hosts, stop words and
 * URL paths are set aside. URL paths and query strings are never read (they hold ids, not intent).
 * @returns {{ hosts: string[], words: string[] }}
 */
function parseQuery(query) {
  const raw = String(query == null ? '' : query).trim().toLowerCase().slice(0, 500);
  const hosts = [];
  const rest = [];
  for (const token of raw.split(/\s+/).filter(Boolean)) {
    const host = hostOfToken(token);
    if (host) {
      if (!hosts.includes(host)) hosts.push(host);
      continue;
    }
    rest.push(token);
  }
  const words = [];
  const add = (w) => { if (w.length >= 2 && !STOP_WORDS.has(w) && !words.includes(w)) words.push(w); };
  for (const w of wordsOf(rest.join(' '))) add(w);
  // A host also speaks in words: "facebook" from facebook.com finds a profile named facebook.
  for (const h of hosts) for (const w of h.split('.').slice(0, -1)) if (w !== 'www') add(w);
  return { hosts, words };
}

function hostScore(queryHost, siteHost, tier) {
  if (queryHost === siteHost) return tier.exact;
  if (isUnder(queryHost, siteHost)) return tier.under;
  if (isUnder(siteHost, queryHost) || registrable(queryHost) === registrable(siteHost)) return tier.related;
  return 0;
}

const SITE_TIER = { exact: SCORE.SITE_EXACT, under: SCORE.SITE_UNDER, related: SCORE.SITE_RELATED };
const URL_TIER = { exact: SCORE.URL_HOST_EXACT, under: SCORE.URL_HOST_EXACT, related: SCORE.URL_HOST_RELATED };

function startUrlHost(url) {
  try {
    const u = new URL(String(url));
    return u.protocol === 'http:' || u.protocol === 'https:' ? stripWww(u.hostname.toLowerCase()) : null;
  } catch { return null; }
}

/** The words a profile offers in one field, folded for comparison. */
const folded = (text) => new Set(wordsOf(text).map(fold));

function scoreOne(profile, q, rawQuery) {
  const p = profile || {};
  const reasons = [];
  let score = 0;

  if (String(rawQuery).trim().toLowerCase() === String(p.name).toLowerCase()) {
    return { score: SCORE.NAME_EXACT, reason: `name is "${p.name}"` };
  }

  // Sites: the best host pairing counts once.
  let site = { score: 0, text: '' };
  const sites = Array.isArray(p.sites) ? p.sites : [];
  for (const qh of q.hosts) {
    for (const s of sites) {
      const sh = normaliseHost(s);
      if (!sh) continue;
      const sc = hostScore(qh, stripWww(sh), SITE_TIER);
      if (sc > site.score) site = { score: sc, text: `${sc >= SCORE.SITE_UNDER ? 'site' : 'a related site'} ${sh}` };
    }
  }
  if (site.score) { score += site.score; reasons.push(site.text); }

  // The start URL's host, only when no declared site already matched.
  if (!site.score) {
    const uh = startUrlHost(p.url);
    if (uh) {
      let best = 0;
      for (const qh of q.hosts) best = Math.max(best, hostScore(qh, uh, URL_TIER));
      if (best) { score += best; reasons.push(`start URL on ${uh}`); }
    }
  }

  // Words, each query word counted once at the field that values it most.
  const purpose = folded(p.purpose);
  const name = folded(p.name);
  const note = folded(p.note);
  const labels = new Set();
  for (const s of sites) {
    const sh = normaliseHost(s);
    if (sh) for (const w of sh.split('.').slice(0, -1)) if (w !== 'www') labels.add(fold(w));
  }
  const urlLabels = new Set();
  const uh = startUrlHost(p.url);
  if (uh) for (const w of uh.split('.').slice(0, -1)) urlLabels.add(fold(w));

  const hits = { purpose: [], name: [], note: [], site: [], url: [] };
  for (const w of q.words) {
    const f = fold(w);
    if (purpose.has(f)) { score += SCORE.PURPOSE_WORD; hits.purpose.push(w); }
    else if (name.has(f)) { score += SCORE.NAME_WORD; hits.name.push(w); }
    else if (labels.has(f)) { score += SCORE.SITE_LABEL; hits.site.push(w); }
    else if (note.has(f)) { score += SCORE.NOTE_WORD; hits.note.push(w); }
    else if (urlLabels.has(f)) { score += SCORE.URL_LABEL; hits.url.push(w); }
  }
  if (hits.purpose.length) reasons.push(`purpose has ${hits.purpose.join(', ')}`);
  if (hits.name.length) reasons.push(`name has ${hits.name.join(', ')}`);
  if (hits.site.length) reasons.push(`sites include ${hits.site.join(', ')}`);
  if (hits.note.length) reasons.push(`note has ${hits.note.join(', ')}`);
  if (hits.url.length) reasons.push(`start URL has ${hits.url.join(', ')}`);

  // The whole question, in order, inside the purpose: a stronger signal than scattered words.
  if (q.words.length > 1 && p.purpose) {
    const flat = wordsOf(p.purpose).map(fold).join(' ');
    if (flat.includes(q.words.map(fold).join(' '))) { score += SCORE.PHRASE; reasons.push('purpose says it in these words'); }
  }
  return { score, reason: reasons.join('; ') };
}

/**
 * Rank `profiles` for `query`.
 * @param {object[]} profiles stored profiles ({ name, sites?, purpose?, note?, url? })
 * @param {string} query free text, or a URL, or both
 * @returns {{
 *   status: 'match' | 'ambiguous' | 'none',
 *   matches: { name: string, score: number, reason: string }[],   best first; only profiles over MIN_SCORE
 *   best: string | null,                                           the profile to use; null unless status is 'match'
 *   candidates: { name: string, score: number, reason: string }[]  the profiles too close to call (ambiguous only)
 * }}
 */
function matchProfiles(profiles, query) {
  const list = Array.isArray(profiles) ? profiles.filter((p) => p && typeof p.name === 'string') : [];
  const q = parseQuery(query);
  const empty = { status: 'none', matches: [], best: null, candidates: [] };
  if (!q.hosts.length && !q.words.length) return empty;

  const matches = list
    .map((p) => ({ name: p.name, ...scoreOne(p, q, query) }))
    .filter((m) => m.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  if (!matches.length) return empty;

  const [top, second] = matches;
  if (second && second.score >= top.score * AMBIGUITY_RATIO) {
    const candidates = matches.filter((m) => m.score >= top.score * AMBIGUITY_RATIO);
    return { status: 'ambiguous', matches, best: null, candidates };
  }
  return { status: 'match', matches, best: top.name, candidates: [] };
}

module.exports = { SCORE, MIN_SCORE, AMBIGUITY_RATIO, STOP_WORDS, normaliseHost, registrable, parseQuery, matchProfiles };
