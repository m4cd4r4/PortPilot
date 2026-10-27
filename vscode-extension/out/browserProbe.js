"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.probeProfile = probeProfile;
exports.activateTab = activateTab;
exports.openUrlInProfile = openUrlInProfile;
const portWait_1 = require("./portWait");
const browserModel_1 = require("./browserModel");
// Everything here talks to 127.0.0.1 on a profile's own debug port and nothing else.
// It reads target titles and URLs from /json; it never opens a tab's websocket, so no
// page content is read. The only writes are the two explicit commands below.
// Page content is read in one place only: browserCapture.ts, for profiles with previews switched on.
const PROBE_MS = 1200;
const MAX_BODY = 2_000_000;
const HOST = '127.0.0.1';
const down = { up: false, held: false, tabs: [], tabCount: 0 };
async function getText(port, route, method = 'GET') {
    try {
        const r = await fetch(`http://${HOST}:${port}${route}`, { method, signal: AbortSignal.timeout(PROBE_MS) });
        const body = await r.text();
        return { status: r.status, body: body.length > MAX_BODY ? '' : body };
    }
    catch {
        return null;
    }
}
/** One cheap look at a debug port: is a browser answering CDP there, is something else holding it, or is it free. */
async function probeProfile(port) {
    if (!(0, browserModel_1.isValidPort)(port))
        return down;
    try {
        const res = await getText(port, '/json');
        if (res && res.status === 200) {
            let list = null;
            try {
                list = JSON.parse(res.body);
            }
            catch { /* not JSON: not CDP */ }
            let cdp = (0, browserModel_1.looksLikeCdpList)(list);
            if (!cdp && Array.isArray(list) && list.length === 0) {
                // A browser with no pages is up; any other JSON server could also answer []. /json/version tells them apart.
                const v = await getText(port, '/json/version');
                try {
                    cdp = !!v && v.status === 200 && typeof JSON.parse(v.body).Browser === 'string';
                }
                catch {
                    cdp = false;
                }
            }
            if (cdp) {
                const { tabs, total } = (0, browserModel_1.shapeTabs)(list);
                return { up: true, held: false, tabs, tabCount: total };
            }
        }
        return { up: false, held: await (0, portWait_1.portAnswers)(port), tabs: [], tabCount: 0 };
    }
    catch {
        return down;
    }
}
/** Bring a tab to the front inside its browser window (CDP /json/activate). */
async function activateTab(port, id) {
    if (!(0, browserModel_1.isValidPort)(port) || !(0, browserModel_1.isTabId)(id))
        return { ok: false, reason: 'That tab can no longer be reached.' };
    const res = await getText(port, `/json/activate/${id}`);
    if (!res)
        return { ok: false, reason: 'The browser did not answer.' };
    return res.status === 200 ? { ok: true } : { ok: false, reason: 'That tab is gone.' };
}
/** Open `url` (already validated http/https) in a new tab of the profile's own browser (CDP /json/new). */
async function openUrlInProfile(port, url) {
    if (!(0, browserModel_1.isValidPort)(port) || !/^https?:\/\//i.test(url))
        return { ok: false, reason: 'Only http and https pages can be opened.' };
    // Chromium 111+ requires PUT; older builds only answer GET.
    let res = await getText(port, `/json/new?${url}`, 'PUT');
    if (res && res.status === 405)
        res = await getText(port, `/json/new?${url}`, 'GET');
    if (!res)
        return { ok: false, reason: 'The browser did not answer.' };
    return res.status === 200 ? { ok: true } : { ok: false, reason: `The browser refused (HTTP ${res.status}).` };
}
//# sourceMappingURL=browserProbe.js.map