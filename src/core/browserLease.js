/**
 * Browser profile leases (plan row 26): the "do not interfere" rule between Claude sessions.
 *
 * The advisory claim (browserApi.js) already records who started a profile, with their session id.
 * A claim becomes a LEASE while the session that made it is alive: its heartbeat file
 * (<configDir>/sessions/<id>.json, written every 15 s by the plugin, read by configFile.liveSessions)
 * is under 45 s old. A lease whose owner has gone quiet is free again, so a closed session never
 * pins a browser.
 *
 * Only a caller that names its session is held to a lease. A caller with no session id (a person
 * in the desktop app, a harness without the plugin) is never refused, as before. `takeover` is the
 * deliberate override: the caller says it knows the profile is in use.
 *
 * Pure decisions over plain data (claims, the live id set, the clock), so tests need no browser.
 * Zero dependencies.
 */
const configFile = require('./configFile');

// A reservation written before a launch finishes counts as a lease for this long, so two sessions
// that ask for the same profile in the same second cannot both launch it.
const STARTING_MS = 45000;

// Same alphabet browserApi.callerOf lets through, so a heartbeat id and a claim id compare equal.
const cleanId = (s) => String(typeof s === 'string' ? s : '').replace(/[^A-Za-z0-9 ._-]/g, '').trim().slice(0, 100);
const shortId = (s) => cleanId(s).replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toLowerCase();

/** Set of the live sessions' ids (cleaned), from the heartbeat files. */
function liveSessionIds(configPath, now = Date.now()) {
  return new Set(configFile.liveSessions(configPath, now).map((s) => cleanId(s.sessionId)).filter(Boolean));
}

/**
 * The lease a claim amounts to, or null.
 * @param {object|null} claim  { by, sessionId?, at, pid?, starting? } as stored
 * @param {string} state       the profile's state now: 'up' | 'down' | 'blocked'
 * @param {Set<string>} live   liveSessionIds()
 * @returns {{ by, sessionId, short, since, starting }|null}
 */
function leaseOf(claim, state, live, now = Date.now()) {
  if (!claim || typeof claim.sessionId !== 'string' || !claim.sessionId) return null;
  const id = cleanId(claim.sessionId);
  if (!id || !live.has(id)) return null;
  const starting = claim.starting === true;
  if (state === 'up') return { by: claim.by, sessionId: id, short: shortId(id), since: claim.at, starting: false };
  // Down: a lease only while that session's launch is under way.
  const age = now - Date.parse(claim.at);
  if (state === 'down' && starting && Number.isFinite(age) && age < STARTING_MS) {
    return { by: claim.by, sessionId: id, short: shortId(id), since: claim.at, starting: true };
  }
  return null;
}

/**
 * What a caller may do with a leased profile.
 *   'free'      no lease
 *   'mine'      the caller holds it
 *   'takeover'  someone else holds it and the caller said takeover
 *   'ignored'   someone else holds it but the caller names no session: not held to leases
 *   'refused'   someone else holds it: IN_USE
 */
function decide(lease, callerSessionId, takeover) {
  if (!lease) return 'free';
  const me = cleanId(callerSessionId);
  if (me && me === lease.sessionId) return 'mine';
  if (!me) return 'ignored';
  return takeover ? 'takeover' : 'refused';
}

/**
 * Whether a session may pick this profile on its own (`start_browser` name "any", and the `free`
 * flag in list_browser_profiles): nobody holds it, and it is either stopped or running with a
 * claim whose owning session is gone. A profile somebody opened by hand, or a port another
 * program holds, is never free.
 * @param {object} st     { state, owner? }
 * @param {object|null} claim
 */
function isFree(st, claim, lease) {
  if (lease || st.state === 'blocked') return false;
  if (st.state === 'down') return true;
  return st.state === 'up' && st.owner === 'profile' && !!claim && typeof claim.sessionId === 'string' && !!claim.sessionId;
}

/**
 * Order the profiles a session could start for "any": the one it already holds, then stopped
 * profiles, then running ones whose owner is gone. `rows` are { name, state, mine, free }.
 */
function pickOrder(rows) {
  const rank = (r) => (r.mine ? 0 : r.free && r.state === 'down' ? 1 : r.free ? 2 : 9);
  return rows.map((r, i) => ({ r, i })).filter((x) => rank(x.r) < 9)
    .sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i).map((x) => x.r);
}

function ago(iso, now = Date.now()) {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (!Number.isFinite(s)) return 'earlier';
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

/** The one-sentence IN_USE error: who holds the profile and since when. */
function inUseSentence(profileName, lease, now = Date.now()) {
  const who = lease.short && !String(lease.by).includes(lease.short) ? `${lease.by} (session ${lease.short})` : lease.by;
  const when = lease.starting ? 'is starting it now' : `started it ${ago(lease.since, now)}${Number.isFinite(Date.parse(lease.since)) ? ` (${new Date(lease.since).toISOString()})` : ''}`;
  return `browser profile "${profileName}" is in use by ${who}, who ${when}`;
}

module.exports = { STARTING_MS, cleanId, shortId, liveSessionIds, leaseOf, decide, isFree, pickOrder, inUseSentence, ago };
