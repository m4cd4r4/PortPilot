"use strict";
// Pure ordering and bookkeeping for the sidebar trees. No `vscode` import, so
// the root unit tests can require the compiled out/treeModel.js directly
// (tests/vscode-tree-model.test.cjs).
Object.defineProperty(exports, "__esModule", { value: true });
exports.STATE_WEIGHT = void 0;
exports.effectiveWeight = effectiveWeight;
exports.isIdle = isIdle;
exports.compareKeys = compareKeys;
exports.arrange = arrange;
exports.appIdByPort = appIdByPort;
exports.previewFor = previewFor;
exports.newCrashes = newCrashes;
// Lower sorts first: the rows that need attention, then live ones, then idle.
exports.STATE_WEIGHT = {
    crashed: 0,
    conflict: 1,
    error: 2,
    starting: 3,
    running: 4,
    stopped: 5,
};
/** A parent with an active child sorts as that child: min weight of self and children. */
function effectiveWeight(k) {
    let w = exports.STATE_WEIGHT[k.state] ?? exports.STATE_WEIGHT.stopped;
    for (const s of k.childStates ?? [])
        w = Math.min(w, exports.STATE_WEIGHT[s] ?? exports.STATE_WEIGHT.stopped);
    return w;
}
function isIdle(k) {
    return effectiveWeight(k) === exports.STATE_WEIGHT.stopped;
}
/** State weight, then favourites, then name. */
function compareKeys(a, b) {
    const w = effectiveWeight(a) - effectiveWeight(b);
    if (w !== 0)
        return w;
    if (a.favorite !== b.favorite)
        return a.favorite ? -1 : 1;
    return a.name.localeCompare(b.name);
}
/**
 * Sort a sibling list and, when `fold` is on, split off the idle ones so the
 * caller can tuck them under a collapsed "Stopped (N)" node at the end.
 */
function arrange(items, keyOf, fold) {
    const sorted = [...items].sort((a, b) => compareKeys(keyOf(a), keyOf(b)));
    if (!fold)
        return { visible: sorted, stopped: [] };
    return {
        visible: sorted.filter(t => !isIdle(keyOf(t))),
        stopped: sorted.filter(t => isIdle(keyOf(t))),
    };
}
/** Invert appId -> live port into port -> appId (first app wins on a shared port). */
function appIdByPort(running) {
    const out = new Map();
    for (const [appId, p] of running)
        if (!out.has(p.port))
            out.set(p.port, appId);
    return out;
}
/**
 * The preview an Apps row may show, by the desktop's rule (rowThumbs.js): the app
 * must be listening, have a runtime record, and the live port must match the open
 * run's port. A stop outside PortPilot leaves a run open, so an open run alone
 * does not prove its server is the one on screen.
 */
function previewFor(byApp, appId, hasRuntimeRecord, livePort) {
    const cur = byApp[appId];
    if (!cur || !hasRuntimeRecord || livePort == null)
        return null;
    return cur.port == null || cur.port === livePort ? cur : null;
}
/**
 * Crash stamps newer than `since`, oldest first, skipping apps that are
 * listening again. Returns the new high-water mark to pass next time.
 */
function newCrashes(runtime, running, since) {
    const crashes = [];
    let latest = since;
    for (const [appId, entry] of Object.entries(runtime)) {
        const stamp = entry?.crashed;
        if (!stamp || typeof stamp.at !== 'number')
            continue;
        if (stamp.at > latest)
            latest = stamp.at;
        if (stamp.at > since && !running.has(appId))
            crashes.push({ appId, stamp });
    }
    crashes.sort((a, b) => a.stamp.at - b.stamp.at);
    return { crashes, latest };
}
//# sourceMappingURL=treeModel.js.map