"use strict";
// Pure model for the Tiles view: which apps and browser profiles become tiles, in what order,
// and which pictures still need sending to the webview. No `vscode` import, so the root unit
// tests can require the compiled out/tilesModel.js (tests/vscode-tiles-model.test.cjs).
Object.defineProperty(exports, "__esModule", { value: true });
exports.ImageSync = exports.artImgKey = exports.appImgKey = exports.letterOf = void 0;
exports.buildAppTiles = buildAppTiles;
exports.buildBrowserTiles = buildBrowserTiles;
exports.thumbOf = thumbOf;
exports.imageKeys = imageKeys;
const treeModel_1 = require("./treeModel");
const LAMPS = {
    crashed: 'crashed',
    conflict: 'blocked',
    error: 'crashed',
    starting: 'starting',
    running: 'running',
    stopped: 'stopped',
};
/** First letter, upper-cased; a stand-in picture for a tile with none. */
const letterOf = (name) => (Array.from(name.trim())[0] ?? '?').toUpperCase();
exports.letterOf = letterOf;
/** Picture key for an app: the run's thumbnail path, so a new capture is a new key. */
const appImgKey = (thumb) => (thumb ? `run:${thumb}` : '');
exports.appImgKey = appImgKey;
/** Picture key for a browser: name plus the art file's mtime, so a changed picture is a new key. */
const artImgKey = (name, stamp) => (stamp ? `art:${name.toLowerCase()}@${stamp}` : '');
exports.artImgKey = artImgKey;
/**
 * Running and attention-needing apps become tiles, favourites first inside each state, then name
 * (the Apps tree's own order). Idle apps come back separately, in the same order, for the compact list.
 */
function buildAppTiles(apps, showPictures = true) {
    const keyOf = (a) => ({ state: a.state, name: a.name, favorite: a.favorite });
    const sorted = [...apps].sort((a, b) => (0, treeModel_1.compareKeys)(keyOf(a), keyOf(b)));
    const tile = (a) => {
        const running = a.state === 'running';
        return {
            id: a.id,
            name: a.name,
            port: a.port,
            lamp: LAMPS[a.state] ?? 'stopped',
            word: a.word,
            favorite: a.favorite,
            branch: a.branch || '',
            letter: (0, exports.letterOf)(a.name),
            img: showPictures && running ? (0, exports.appImgKey)(a.thumb) : '',
            canOpen: running && a.port != null,
            canStart: !running,
            canStop: running,
        };
    };
    return {
        live: sorted.filter(a => !(0, treeModel_1.isIdle)(keyOf(a))).map(tile),
        stopped: sorted.filter(a => (0, treeModel_1.isIdle)(keyOf(a))).map(tile),
    };
}
const BROWSER_LAMP = {
    running: 'running',
    held: 'blocked',
    stopped: 'stopped',
    unknown: 'stopped',
};
/** One tile per profile, in the Browsers tree's own order (running, held, then stopped; rows arrive sorted). */
function buildBrowserTiles(rows, artStamp) {
    return rows.map(r => ({
        name: r.name,
        port: r.port,
        lamp: BROWSER_LAMP[r.state],
        word: r.stateWord,
        letter: (0, exports.letterOf)(r.name),
        img: (0, exports.artImgKey)(r.name, artStamp(r.name)),
        canFocus: r.state === 'running' && r.tabs.some(t => /^https?:\/\//i.test(t.url)),
        canStart: r.state === 'stopped',
        canStop: r.state === 'running',
        leasedTo: r.leasedTo || '',
    }));
}
/** The thumbnail an app's tile may show: the Apps row's own rule (listening, runtime record, matching port). */
function thumbOf(byApp, appId, hasRuntimeRecord, livePort) {
    return (0, treeModel_1.previewFor)(byApp, appId, hasRuntimeRecord, livePort)?.thumb ?? null;
}
/**
 * Which pictures the webview still lacks. The webview keeps every picture it was sent, keyed;
 * a tile refers to one by key, so a ten-second repaint sends no image bytes twice.
 */
class ImageSync {
    sent = new Set();
    /** Keys in `wanted` not yet sent. They count as sent from now on. */
    pending(wanted) {
        const out = [];
        for (const k of wanted) {
            if (k && !this.sent.has(k)) {
                this.sent.add(k);
                out.push(k);
            }
        }
        return out;
    }
    /** A key whose file could not be read: forget it, so a later repaint tries again. */
    failed(key) {
        this.sent.delete(key);
    }
    /** The webview was recreated and holds nothing. */
    reset() {
        this.sent.clear();
    }
}
exports.ImageSync = ImageSync;
/** Every picture key a state refers to. */
function imageKeys(state) {
    return [...state.apps, ...state.stoppedApps].map(t => t.img).concat(state.browsers.map(t => t.img)).filter(Boolean);
}
//# sourceMappingURL=tilesModel.js.map