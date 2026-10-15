"use strict";
// Pure model for the Browsers view: profile rows, state mapping, the tab list,
// leased text, URL validation and API-failure wording. No `vscode` import, so the
// root unit tests can require the compiled out/browserModel.js directly
// (tests/vscode-browsers-model.test.cjs). Mode labels, the claim line and the
// plain-language next steps are the desktop Browsers tab's own (core/browserView.js).
Object.defineProperty(exports, "__esModule", { value: true });
exports.isRefusal = exports.tabLabel = exports.descriptionOf = exports.isTabId = exports.cdpUrlFor = exports.isValidPort = exports.PORT_MAX = exports.PORT_MIN = exports.TAB_CAP = exports.MODES = void 0;
exports.suggestPort = suggestPort;
exports.nameProblem = nameProblem;
exports.portProblem = portProblem;
exports.normaliseProfiles = normaliseProfiles;
exports.looksLikeCdpList = looksLikeCdpList;
exports.shapeTabs = shapeTabs;
exports.stateOf = stateOf;
exports.leasedText = leasedText;
exports.buildRows = buildRows;
exports.validateOpenUrl = validateOpenUrl;
exports.failureMessage = failureMessage;
// The packaged extension carries runtime/core (scripts/copy-runtime.js); a source
// checkout, where the unit tests run, has not built it and reads src/core directly.
function loadBrowserView() {
    for (const rel of ['../runtime/core/browserView.js', '../../src/core/browserView.js']) {
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            return require(rel);
        }
        catch (err) {
            if (err.code !== 'MODULE_NOT_FOUND')
                throw err;
        }
    }
    throw new Error('browserModel: browserView.js not found');
}
const browserView = loadBrowserView();
exports.MODES = browserView.MODES;
/** Tabs listed under one running profile. */
exports.TAB_CAP = 30;
exports.PORT_MIN = 1024;
exports.PORT_MAX = 65535;
const STATE_WORDS = {
    running: 'Running',
    stopped: 'Stopped',
    held: 'Port held by another process',
    unknown: 'Checking',
};
const lower = (s) => s.toLowerCase();
const str = (v, max) => (typeof v === 'string' ? v.replace(/[\r\n\t]+/g, ' ').trim().slice(0, max) : '');
const isValidPort = (p) => Number.isInteger(p) && p >= exports.PORT_MIN && p <= exports.PORT_MAX;
exports.isValidPort = isValidPort;
/**
 * The next debug port for a new profile: first free from 9231 up, skipping the ports other
 * profiles use, ports something else holds, and 9240 (the usual hand-made pool is 9222-9230 and 9240).
 * Same rule as the desktop's Add profile.
 */
function suggestPort(used, held = []) {
    const taken = new Set([...used, ...held]);
    let port = 9231;
    while (taken.has(port) || port === 9240)
        port += 1;
    return port;
}
const NAME_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,62}[A-Za-z0-9_-])?$/;
/** Why a profile name cannot be used, or undefined. The core re-checks; this only saves a round trip. */
function nameProblem(name, existing) {
    const n = name.trim();
    if (!n)
        return 'Give the profile a name.';
    if (!NAME_RE.test(n))
        return 'Use letters, digits, dot, dash or underscore; start with a letter or digit.';
    if (existing.some(e => lower(e) === lower(n)))
        return `A profile named "${n}" already exists.`;
    return undefined;
}
/** Why a port cannot be used, or undefined. `usedBy` maps a port to the profile that has it. */
function portProblem(raw, usedBy) {
    const t = raw.trim();
    if (!/^\d+$/.test(t))
        return 'Enter a port number.';
    const port = Number(t);
    if (!(0, exports.isValidPort)(port))
        return `Use a port from ${exports.PORT_MIN} to ${exports.PORT_MAX}.`;
    const owner = usedBy.get(port);
    return owner ? `:${port} already belongs to "${owner}".` : undefined;
}
/** The CDP endpoint, always loopback. */
const cdpUrlFor = (port) => `http://127.0.0.1:${port}`;
exports.cdpUrlFor = cdpUrlFor;
/**
 * The profiles in the shared config's `browserProfiles`, made safe to draw:
 * anything without a name and a usable port is dropped, a repeated name keeps the first.
 */
function normaliseProfiles(raw) {
    const seen = new Set();
    const out = [];
    for (const p of Array.isArray(raw) ? raw : []) {
        if (!p || typeof p !== 'object')
            continue;
        const r = p;
        const name = str(r.name, 64);
        if (!name || !(0, exports.isValidPort)(r.port) || seen.has(lower(name)))
            continue;
        seen.add(lower(name));
        out.push({
            name,
            port: r.port,
            browser: str(r.browser, 20) || 'chrome',
            mode: exports.MODES.some(m => m.id === r.mode) ? r.mode : 'headed',
            url: str(r.url, 500),
            note: str(r.note, 500),
            userDataDir: str(r.userDataDir, 500),
        });
    }
    return out;
}
/** A page target id as CDP writes it (hex or uuid). Anything else never reaches a URL. */
const isTabId = (id) => typeof id === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(id);
exports.isTabId = isTabId;
/**
 * True when `raw` is a CDP target list: a non-empty array of objects with a `type`.
 * An empty list is not proof (any JSON server could return []): the caller confirms with /json/version.
 */
function looksLikeCdpList(raw) {
    return Array.isArray(raw) && raw.length > 0 && raw.every(t => !!t && typeof t === 'object' && typeof t.type === 'string');
}
/** Page tabs only, titles and URLs only, capped. Never reads tab content. */
function shapeTabs(raw, cap = exports.TAB_CAP) {
    const pages = (Array.isArray(raw) ? raw : []).filter((t) => !!t && typeof t === 'object' && t.type === 'page' && (0, exports.isTabId)(t.id));
    return {
        tabs: pages.slice(0, cap).map(t => ({ id: t.id, title: str(t.title, 200), url: str(t.url, 500) })),
        total: pages.length,
    };
}
/** Row state from the 10 s look, refined by the last full API read (which can name who holds the port). */
function stateOf(probe, full) {
    if (!probe)
        return 'unknown';
    // CDP answers, but the API found the holder is not this profile's own browser.
    if (probe.up)
        return full && full.state === 'blocked' ? 'held' : 'running';
    return probe.held ? 'held' : 'stopped';
}
/** "claude 4a2f" from a lease that may be a string or an object; null when there is none. */
function leasedText(leasedTo) {
    if (typeof leasedTo === 'string')
        return str(leasedTo, 80) || null;
    if (leasedTo && typeof leasedTo === 'object') {
        const o = leasedTo;
        return str(o.label, 80) || str(o.by, 80) || str(o.sessionId, 80) || null;
    }
    return null;
}
const folderName = (p) => p.userDataDir ? (p.userDataDir.split(/[\\/]+/).filter(Boolean).pop() ?? p.userDataDir) : p.name;
const descriptionOf = (p, state) => [`:${p.port}`, p.mode, p.browser, state === 'held' ? 'port held' : ''].filter(Boolean).join(' · ');
exports.descriptionOf = descriptionOf;
function tooltipOf(p, state, probe, full, leased) {
    const free = full && typeof full.free === 'boolean' ? full.free : null;
    return [
        `${p.name} · ${STATE_WORDS[state]}`,
        ...(state === 'held' && full && str(full.warning, 300) ? [str(full.warning, 300)] : []),
        `CDP: ${(0, exports.cdpUrlFor)(p.port)}`,
        ...(p.note ? [`Note: ${p.note}`] : []),
        ...(p.url ? [`Start URL: ${p.url}`] : []),
        `Profile folder: ${folderName(p)}`,
        ...(state === 'running' && probe ? [`Tabs: ${probe.tabCount}${probe.tabCount > exports.TAB_CAP ? ` (first ${exports.TAB_CAP} listed)` : ''}`] : []),
        ...(leased ? [`Leased to ${leased}`] : []),
        ...(!leased && state === 'running' && full && full.claim && full.claim.by ? [browserView.claimLine(full.claim)] : []),
        ...(free !== null ? [`Free: ${free ? 'yes' : 'no'}`] : []),
    ];
}
/** Running first, then port held, then stopped; by name inside each group (the desktop tab's order). */
const ORDER = { running: 0, held: 1, unknown: 2, stopped: 3 };
function buildRows(profiles, probes, full = new Map()) {
    const rows = profiles.map((p) => {
        const probe = probes.get(p.name);
        const f = full.get(lower(p.name));
        const state = stateOf(probe, f);
        const leased = leasedText(f?.leasedTo);
        return {
            name: p.name,
            port: p.port,
            mode: p.mode,
            browser: p.browser,
            state,
            stateWord: STATE_WORDS[state],
            cdpUrl: (0, exports.cdpUrlFor)(p.port),
            description: (0, exports.descriptionOf)(p, state),
            tooltip: tooltipOf(p, state, probe, f, leased),
            leasedTo: leased,
            tabs: state === 'running' && probe ? probe.tabs.slice(0, exports.TAB_CAP) : [],
            tabsHidden: state === 'running' && probe ? Math.max(0, probe.tabCount - exports.TAB_CAP) : 0,
        };
    });
    return rows.sort((a, b) => ORDER[a.state] - ORDER[b.state] || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}
/** A tab row's label: its title, else its URL. */
const tabLabel = (t) => t.title || t.url || 'Untitled';
exports.tabLabel = tabLabel;
/** Only http and https pages can be opened from the view; the result is the normalised URL. */
function validateOpenUrl(input) {
    const text = (input ?? '').trim();
    if (!text)
        return { ok: false, reason: 'Enter a URL.' };
    if (/\s/.test(text))
        return { ok: false, reason: 'A URL cannot contain spaces.' };
    let u;
    try {
        u = new URL(text);
    }
    catch {
        return { ok: false, reason: 'That is not a full URL. Start with http:// or https://.' };
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:')
        return { ok: false, reason: 'Only http:// and https:// pages can be opened.' };
    if (!u.hostname)
        return { ok: false, reason: 'That URL has no host.' };
    return { ok: true, url: u.href };
}
/** Failures the API raises on purpose (it will not touch what PortPilot did not start): information, not a malfunction. */
const isRefusal = (code) => code === 'NOT_OURS' || code === 'NOT_VERIFIED' || code === 'PORT_HELD';
exports.isRefusal = isRefusal;
/**
 * The API's `error`, then what to do next. The desktop's plain-language next step when it has one
 * for this code, else the API's own `action`. Never a stack: only those two strings are read.
 */
function failureMessage(res) {
    if (!res)
        return 'Something went wrong.';
    const withNext = browserView.failureText(res);
    const bare = browserView.failureText({ error: res.error });
    const action = str(res.action, 300);
    if (withNext !== bare || !action)
        return withNext;
    return `${bare.replace(/[.\s]+$/, '')}. ${action}`;
}
//# sourceMappingURL=browserModel.js.map