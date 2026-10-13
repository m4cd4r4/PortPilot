"use strict";
// Pure model for the History view: day buckets, ordering, state, search. No
// `vscode` import, so the root unit tests can require the compiled
// out/historyModel.js directly (tests/vscode-history-model.test.cjs). Filtering,
// state words and the "when" wording are the desktop's own (runtime/core/runView.js).
Object.defineProperty(exports, "__esModule", { value: true });
exports.HISTORY_CAP = void 0;
exports.bucketOf = bucketOf;
exports.urlOf = urlOf;
exports.cannotStart = cannotStart;
exports.liveRunIds = liveRunIds;
exports.matchesQuery = matchesQuery;
exports.buildHistory = buildHistory;
exports.tooltipLines = tooltipLines;
// The packaged extension carries runtime/core (scripts/copy-runtime.js); a source
// checkout, where the unit tests run, has not built it and reads src/core directly.
function loadRunView() {
    for (const rel of ['../runtime/core/runView.js', '../../src/core/runView.js']) {
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            return require(rel);
        }
        catch (err) {
            if (err.code !== 'MODULE_NOT_FOUND')
                throw err;
        }
    }
    throw new Error('historyModel: runView.js not found');
}
const runView = loadRunView();
exports.HISTORY_CAP = 200;
/** Days after yesterday that still get their own weekday + date bucket. */
const DATED_DAYS = 7;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n) => String(n).padStart(2, '0');
/** Whole local calendar days since the epoch: immune to 23h and 25h days. */
function dayNumber(d) {
    return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
}
/** The day bucket a start time falls in, by local calendar day (not by 24h spans). */
function bucketOf(started, now) {
    if (Number.isNaN(started.getTime()))
        return { key: 'earlier', label: 'Earlier', collapsed: true };
    const ago = dayNumber(now) - dayNumber(started);
    if (ago <= 0)
        return { key: 'today', label: 'Today', collapsed: false }; // a future stamp is clock skew
    if (ago === 1)
        return { key: 'yesterday', label: 'Yesterday', collapsed: false };
    if (ago <= 1 + DATED_DAYS) {
        const date = `${started.getFullYear()}-${pad(started.getMonth() + 1)}-${pad(started.getDate())}`;
        return { key: date, label: `${WEEKDAYS[started.getDay()]} ${started.getDate()} ${MONTHS[started.getMonth()]}`, collapsed: false };
    }
    return { key: 'earlier', label: 'Earlier', collapsed: true };
}
const text = (v) => (typeof v === 'string' && v.trim() ? v : null);
const portOf = (r) => (Number.isInteger(r.port) && r.port > 0 ? r.port : null);
const startedMs = (r) => {
    const t = Date.parse(r.startedAt ?? '');
    return Number.isNaN(t) ? -Infinity : t;
};
/** URL to open: the recorded one, else localhost on the run's port. */
function urlOf(r) {
    const port = portOf(r);
    return text(r.url) ?? (port ? `http://localhost:${port}/` : null);
}
/** Null when "Start again" can work, else the reason, in words for a message box. */
function cannotStart(r) {
    if (!text(r.cwd))
        return 'PortPilot did not record which folder this server ran in.';
    // A detected run's `command` is whatever process was found listening, not something to type.
    const how = r.detected ? text(r.startCommand) : (text(r.startCommand) ?? text(r.command));
    if (!how)
        return 'PortPilot saw this server but not the command that started it.';
    return null;
}
/** Open runs only, and only the newest per port: an older open run on the same port was superseded. */
function liveRunIds(runs, listening) {
    const up = new Set(listening);
    const newest = new Map();
    for (const r of runs) {
        const port = portOf(r);
        if (r.stoppedAt || !port || !up.has(port))
            continue;
        const cur = newest.get(port);
        if (!cur || startedMs(r) >= startedMs(cur))
            newest.set(port, r);
    }
    return new Set([...newest.values()].map(r => r.id));
}
/** Every word hits the run's name, command, title, branch, sha or files (runView) or its port. */
function matchesQuery(run, query) {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const port = portOf(run);
    return terms.every(t => {
        const digits = t.replace(/^:/, '');
        if (port && /^\d+$/.test(digits) && String(port).includes(digits))
            return true;
        return runView.filterRuns([run], { query: t }).length > 0;
    });
}
function entryOf(run, live) {
    const s = runView.runStateOf(run, live);
    const unseen = s.state === 'stopped' && (!run.stoppedAt || run.endedBy === 'unknown');
    const state = s.state === 'running' ? 'live' : s.state === 'crashed' ? 'crashed' : unseen ? 'unseen' : 'stopped';
    const port = portOf(run);
    const when = new Date(run.startedAt ?? '');
    const clock = Number.isNaN(when.getTime()) ? '' : `${pad(when.getHours())}:${pad(when.getMinutes())}`;
    return {
        run,
        label: text(run.appName) ?? (port ? `localhost:${port}` : 'localhost'),
        time: [clock, port ? `:${port}` : ''].filter(Boolean).join(' · '),
        state,
        stateWord: s.word,
        stateText: state === 'unseen' ? `${s.word} · end not seen` : s.text.replace(/^\S+ /, ''),
        live,
        detected: run.detected === true,
        pinned: run.pinned === true,
        url: urlOf(run),
        cannotStart: cannotStart(run),
    };
}
/**
 * The grouped, newest-first view of runs.json. Anything that is not a run
 * object with an id is dropped, so a hand-edited or half-written file shows what
 * is readable and never throws. `shown` is the count after the cap.
 */
function buildHistory(raw, opts = {}) {
    const now = opts.now ?? new Date();
    const all = (Array.isArray(raw) ? raw : []).filter((r) => !!r && typeof r === 'object' && typeof r.id === 'string');
    const live = liveRunIds(all, opts.listening ?? []);
    const query = (opts.query ?? '').trim();
    const kept = (query ? all.filter(r => matchesQuery(r, query)) : all)
        .sort((a, b) => startedMs(b) - startedMs(a));
    const shownRuns = kept.slice(0, opts.cap ?? exports.HISTORY_CAP);
    const groups = [];
    for (const run of shownRuns) {
        const b = bucketOf(new Date(run.startedAt ?? ''), now);
        let g = groups[groups.length - 1];
        if (!g || g.key !== b.key) {
            g = { ...b, entries: [] };
            groups.push(g);
        }
        g.entries.push(entryOf(run, live.has(run.id)));
    }
    return { groups, shown: shownRuns.length, matched: kept.length };
}
/** Plain tooltip lines for a run, under the preview image when it has one. */
function tooltipLines(e) {
    const r = e.run;
    const sha = r.git?.sha ? runView.gitLine(r) : '';
    return [
        e.label,
        ...(text(r.page?.title) ? [`Title: ${r.page.title}`] : []),
        ...(e.url ? [`URL: ${e.url}`] : []),
        `When: ${runView.formatWhen(r) || 'unknown'}`,
        `Status: ${e.stateText}`,
        ...(sha ? [`Git: ${sha}`] : []),
        ...(e.detected ? ['Found by PortPilot, not registered as an app'] : []),
        ...(text(r.cwd) ? [`Folder: ${r.cwd}`] : []),
    ];
}
//# sourceMappingURL=historyModel.js.map