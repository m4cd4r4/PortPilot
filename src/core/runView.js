/**
 * Pure view logic for the History tab: filtering, state words, formatting.
 * Loaded as a browser global (window.PortPilotRunView) by the renderer, which
 * runs without Node, and as a CommonJS module by tests. Filter semantics mirror
 * findRuns in mcp-server/index.js (the MCP tool Claude uses on the same data).
 */
(function (root, factory) {
  const api = factory(typeof require === 'function' ? require('./status') : root.PortPilotStatus);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.PortPilotRunView = api;
})(typeof self !== 'undefined' ? self : this, function (Status) {
  'use strict';

  const lower = (v) => String(v || '').toLowerCase();

  // A date-only bound is a LOCAL calendar day: from = its first moment, to = its last.
  function dayBound(v, endOfDay) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || '').trim());
    if (!m) return null;
    const day = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (endOfDay) day.setDate(day.getDate() + 1);
    return day.getTime() - (endOfDay ? 1 : 0);
  }

  const textOf = (r) => lower([
    r.appName, r.command, r.git && r.git.branch, r.git && r.git.subject,
    r.page && r.page.title, ...((r.git && r.git.files) || []),
  ].join('\n'));

  /**
   * Newest first. Filters: query (every word must hit; a sha matches from its
   * start), app (id), branch (exact), from / to (YYYY-MM-DD), dirtyOnly.
   */
  function filterRuns(runs, f = {}) {
    const terms = lower(f.query).split(/\s+/).filter(Boolean);
    const from = dayBound(f.from, false);
    const to = dayBound(f.to, true);
    const out = (runs || []).filter((r) => {
      const started = Date.parse(r.startedAt);
      if ((from !== null || to !== null) && Number.isNaN(started)) return false;
      if (f.app && r.appId !== f.app) return false;
      if (f.branch && (r.git && r.git.branch) !== f.branch) return false;
      if (from !== null && started < from) return false;
      if (to !== null && started > to) return false;
      if (f.dirtyOnly && !(r.git && r.git.dirty)) return false;
      if (terms.length) {
        const text = textOf(r);
        const sha = lower(r.git && r.git.sha);
        if (!terms.every((t) => text.includes(t) || (sha && sha.startsWith(t)))) return false;
      }
      return true;
    });
    return out.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  }

  /** Distinct apps and branches present in the runs, for the filter dropdowns. */
  function facets(runs) {
    const apps = new Map();
    const branches = new Set();
    for (const r of runs || []) {
      if (r.appId && !apps.has(r.appId)) apps.set(r.appId, r.appName || r.appId);
      if (r.git && r.git.branch) branches.add(r.git.branch);
    }
    const byName = (a, b) => a.name.localeCompare(b.name);
    return {
      apps: [...apps].map(([id, name]) => ({ id, name })).sort(byName),
      branches: [...branches].sort((a, b) => a.localeCompare(b)),
    };
  }

  /**
   * The state cell for a run, through the same words as the app rows.
   * `live` = the run is open and its app is running on its port right now.
   */
  function runStateOf(run, live) {
    const crashed = run.endedBy === 'crash';
    const s = Status.rowStateOf({ running: !!live, crashed, exitCode: run.exitCode, startedBy: run.startedBy });
    let reason = s.reason;
    if (s.state === 'stopped' && run.endedBy === 'unknown') reason = 'end not seen';
    return { ...s, reason, text: [`${s.glyph} ${s.word}`, reason].filter(Boolean).join(' · ') };
  }

  /** "claude b71c" / "you" for who started the run (the app rows' wording). */
  function startedByWord(run) {
    const p = Status.provenanceOf(run.startedBy);
    return p.kind === 'external' ? 'external' : p.word;
  }

  const DAY = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  const CLOCK = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });

  /** "Mon 5 Oct, 09:12 - 11:40" (open run: "09:12 -"). Local time. */
  function formatWhen(run) {
    const a = new Date(run.startedAt);
    if (Number.isNaN(a.getTime())) return '';
    const head = `${DAY.format(a).replace(/,/g, '')}, ${CLOCK.format(a)}`;
    if (!run.stoppedAt) return `${head} -`;
    const b = new Date(run.stoppedAt);
    if (Number.isNaN(b.getTime())) return `${head} -`;
    const sameDay = a.toDateString() === b.toDateString();
    return `${head} - ${sameDay ? '' : DAY.format(b).replace(/,/g, '') + ', '}${CLOCK.format(b)}`;
  }

  function formatBytes(n) {
    const b = Number(n) || 0;
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
    const mb = b / 1024 / 1024;
    return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  }

  /** Footer line: "312 runs · 41 MB of 150 MB". */
  function footerText(stats) {
    const s = stats || {};
    const n = s.runs || 0;
    return `${n} run${n === 1 ? '' : 's'} · ${formatBytes(s.bytes)} of ${Math.round((s.maxBytes || 0) / 1024 / 1024)} MB`;
  }

  /** "branch @ 9c41e0a +2" / "no git" for the card's git line. */
  function gitLine(run) {
    const g = run.git;
    if (!g || !g.sha) return 'no git';
    const dirty = g.dirty ? ` +${(g.files || []).length || 1}` : '';
    return `${g.branch || 'detached'} @ ${g.sha.slice(0, 7)}${dirty}`;
  }

  /**
   * The thumbnail each Apps row may show: per app, its newest OPEN run, and only
   * when that run already has a page.thumb. A newer run still waiting for its
   * capture hides the older run's page rather than showing the wrong one.
   * Returns { [appId]: { id, thumb, port } }.
   */
  function rowThumbs(runs) {
    const newest = new Map();
    for (const r of runs || []) {
      if (!r || !r.appId || r.stoppedAt) continue;
      const t = Date.parse(r.startedAt) || 0;
      const cur = newest.get(r.appId);
      if (!cur || t >= cur.t) newest.set(r.appId, { t, run: r });
    }
    const out = {};
    for (const [appId, { run }] of newest) {
      if (run.page && run.page.thumb) out[appId] = { id: run.id, thumb: run.page.thumb, port: run.port ?? null };
    }
    return out;
  }

  return { filterRuns, facets, runStateOf, startedByWord, formatWhen, formatBytes, footerText, gitLine, rowThumbs };
});
