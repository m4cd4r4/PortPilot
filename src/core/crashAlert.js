/**
 * The desktop crash toast (A4): what it says and which Claude session its
 * Ask Claude button hands the crash to. Pure, so tests/crash-alert.test.cjs
 * runs it without Electron; main.js gathers the inputs and sends the payload.
 *
 * Ask Claude is shown only when a session is live (configFile.liveSessions):
 * the session that started the dead run, else one working in the app's
 * folder, else the most recent. The request carries only { appId, at }; the
 * session's PortPilot mod builds the prompt itself.
 */
const { shortSession } = require('./status');

const REPEAT_WINDOW_MS = 5 * 60 * 1000;
const TAIL_LINE_COUNT = 3;
const TAIL_LINE_CHARS = 160;

const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

/** True when one folder is the other or holds it. */
function sameTree(a, b) {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  return x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`);
}

/** The live session to ask, or null. `sessions` newest first, as liveSessions returns. */
function pickSession(sessions, { ownerSessionId = null, cwd = null } = {}) {
  const list = Array.isArray(sessions) ? sessions : [];
  if (!list.length) return null;
  const owner = ownerSessionId && list.find((s) => s.sessionId === ownerSessionId);
  if (owner) return { ...owner, reason: 'owner' };
  const near = cwd && list.find((s) => sameTree(s.cwd, cwd));
  if (near) return { ...near, reason: 'folder' };
  return { ...list[0], reason: 'recent' };
}

/** The last few non-empty lines of the output, each cut to fit. */
function tailLines(text, n = TAIL_LINE_COUNT) {
  return String(text || '').split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l.trim())
    .slice(-n).map((l) => (l.length > TAIL_LINE_CHARS ? `${l.slice(0, TAIL_LINE_CHARS - 1)}…` : l));
}

/** Counts each app's crashes in the last five minutes. */
function createCrashHistory(windowMs = REPEAT_WINDOW_MS) {
  const seen = new Map();
  return {
    note(appId, now = Date.now()) {
      const recent = (seen.get(appId) || []).filter((t) => now - t < windowMs);
      recent.push(now);
      seen.set(appId, recent);
      return recent.length;
    },
  };
}

/** The toast payload main.js sends the renderer on its `crash-toast` channel. */
function buildCrashAlert({ id, name, code = null, port = null, errorTail = null, count = 1, session = null, at = Date.now() }) {
  const title = count > 1
    ? `${name} crashed ${count}x in 5m`
    : `${name} crashed`;
  const meta = [port ? `:${port}` : null, code != null ? `exit ${code}` : null].filter(Boolean).join(' · ');
  return {
    appId: id,
    name,
    title,
    meta,
    lines: tailLines(errorTail),
    count,
    at,
    session: session
      ? { id: session.sessionId, short: shortSession(session.sessionId), reason: session.reason }
      : null,
  };
}

module.exports = { pickSession, tailLines, createCrashHistory, buildCrashAlert, sameTree, REPEAT_WINDOW_MS };
