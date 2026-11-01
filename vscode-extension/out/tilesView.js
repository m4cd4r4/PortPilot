"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.TilesView = exports.TILES_SETTING = void 0;
const vscode = __importStar(require("vscode"));
const crypto = __importStar(require("crypto"));
const config_1 = require("./config");
const appsTreeProvider_1 = require("./appsTreeProvider");
const browsersTreeProvider_1 = require("./browsersTreeProvider");
const browserCapture_1 = require("./browserCapture");
const tilesModel_1 = require("./tilesModel");
const tilesHtml_1 = require("./tilesHtml");
exports.TILES_SETTING = 'tilesView';
/**
 * The Tiles view: localhost apps as small tiles (a page picture each, from the run history the
 * desktop writes), then one tile per dedicated browser profile (its cached brand art). It reads the
 * same data as the Apps and Browsers trees, which stay below it for the keyboard and right-click menus.
 * Pictures are read from local files and handed to the webview as data URIs; nothing is fetched,
 * written or sent anywhere.
 */
class TilesView {
    apps;
    browsers;
    static viewId = 'portpilot.tiles';
    view;
    sync = new tilesModel_1.ImageSync();
    subs = [];
    drawn = '';
    state = { apps: [], stoppedApps: [], browsers: [] };
    constructor(apps, browsers) {
        this.apps = apps;
        this.browsers = browsers;
        this.subs.push(this.apps.onDidChangeTreeData(() => this.post()), this.browsers.onDidChangeRows(() => this.post()), vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('portpilot.rowPreviews'))
                this.post();
        }));
    }
    resolveWebviewView(view) {
        this.view = view;
        view.webview.options = { enableScripts: true };
        view.webview.html = (0, tilesHtml_1.tilesHtml)(crypto.randomBytes(16).toString('base64'));
        view.onDidDispose(() => { this.view = undefined; this.browsers.setTiling(false); });
        view.onDidChangeVisibility(() => this.visibilityChanged());
        view.webview.onDidReceiveMessage((m) => void this.onMessage(m));
        this.visibilityChanged();
    }
    visibilityChanged() {
        const on = !!this.view?.visible;
        this.browsers.setTiling(on);
        if (on)
            this.post(true);
    }
    /** Everything the tiles show, from the same sources as the trees. */
    compute() {
        const config = (0, config_1.readConfig)();
        const runtime = (0, config_1.readRuntimeApps)();
        const running = this.apps.getRunningByAppId();
        const pictures = this.apps.rowPreviews;
        const thumbs = pictures ? (0, config_1.readRowThumbs)() : {};
        const inputs = config.apps.map(a => {
            const active = running.get(a.id);
            const row = (0, appsTreeProvider_1.appRowState)(active, runtime[a.id]);
            return {
                id: a.id,
                name: a.name,
                port: active?.port ?? a.preferredPort ?? null,
                state: row.state,
                word: row.word,
                favorite: !!a.isFavorite,
                branch: a.branch || null,
                thumb: active ? (0, tilesModel_1.thumbOf)(thumbs, a.id, !!runtime[a.id], active.port) : null,
            };
        });
        const { live, stopped } = (0, tilesModel_1.buildAppTiles)(inputs, pictures);
        return { apps: live, stoppedApps: stopped, browsers: (0, tilesModel_1.buildBrowserTiles)(this.browsers.getRows(), config_1.browserArtStamp) };
    }
    /** The bytes behind a picture key, or null when the file is gone. */
    load(key) {
        if (key.startsWith('run:'))
            return (0, config_1.thumbDataUri)(key.slice(4));
        const m = /^art:(.+)@\d+$/.exec(key);
        return m ? (0, config_1.browserArtDataUri)(m[1]) : null;
    }
    post(force = false) {
        if (!this.view?.visible)
            return;
        try {
            this.state = this.compute();
            const sig = JSON.stringify(this.state);
            const images = {};
            for (const key of this.sync.pending((0, tilesModel_1.imageKeys)(this.state))) {
                const uri = this.load(key);
                if (uri)
                    images[key] = uri;
                else
                    this.sync.failed(key);
            }
            if (!force && sig === this.drawn && !Object.keys(images).length)
                return;
            this.drawn = sig;
            void this.view.webview.postMessage({ type: 'state', state: this.state, images });
        }
        catch {
            /* an unreadable config leaves the last drawing in place */
        }
    }
    async onMessage(m) {
        if (m.type === 'ready') {
            this.sync.reset();
            this.drawn = '';
            this.post(true);
            return;
        }
        if (m.type === 'app') {
            // The id comes from the page; only act on an app in the config.
            const app = (0, config_1.readConfig)().apps.find(a => a.id === (typeof m.id === 'string' ? m.id : ''));
            if (!app)
                return;
            const active = this.apps.getRunningByAppId().get(app.id);
            if (m.action === 'open') {
                const port = active?.port ?? app.preferredPort;
                if (active && port)
                    await vscode.env.openExternal(vscode.Uri.parse(`http://localhost:${port}`));
            }
            else if (m.action === 'start' && !active) {
                await vscode.commands.executeCommand('portpilot.startApp', new appsTreeProvider_1.AppTreeItem(app, undefined));
            }
            else if (m.action === 'stop' && active) {
                await vscode.commands.executeCommand('portpilot.stopApp', new appsTreeProvider_1.AppTreeItem(app, active));
            }
            return;
        }
        if (m.type === 'browser') {
            // The name comes from the page; only act on a profile that is in the Browsers list.
            const row = this.browsers.getRow(typeof m.name === 'string' ? m.name : '');
            if (!row)
                return;
            if (m.action === 'start')
                await vscode.commands.executeCommand('portpilot.startBrowser', new browsersTreeProvider_1.BrowserProfileItem(row));
            else if (m.action === 'stop')
                await vscode.commands.executeCommand('portpilot.stopBrowser', new browsersTreeProvider_1.BrowserProfileItem(row));
            else if (m.action === 'focus') {
                const tab = (0, browserCapture_1.pickPreviewTab)(row.tabs);
                if (tab)
                    await vscode.commands.executeCommand('portpilot.focusBrowserTab', new browsersTreeProvider_1.BrowserTabItem(row.name, row.port, tab));
            }
        }
    }
    dispose() {
        this.subs.forEach(s => s.dispose());
    }
}
exports.TilesView = TilesView;
//# sourceMappingURL=tilesView.js.map