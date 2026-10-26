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
exports.BrowserPreviewView = exports.SETTING = void 0;
const vscode = __importStar(require("vscode"));
const crypto = __importStar(require("crypto"));
const browsersTreeProvider_1 = require("./browsersTreeProvider");
const browserCapture_1 = require("./browserCapture");
const previewModel_1 = require("./previewModel");
exports.SETTING = 'browserPreviews';
const TICK_MS = 10_000;
const AGE_MS = 5_000;
/**
 * The Browsers previews view: one card per profile the user switched previews on for, with a small
 * picture of that browser's front web page. Pictures are taken over the profile's own debug port
 * (see browserCapture.ts), at most one per profile every 30 s, and only while this view is on screen.
 * They are held in memory only and never written to disk or sent anywhere.
 */
class BrowserPreviewView {
    browsers;
    capture;
    static viewId = 'portpilot.browserPreviews';
    view;
    shots = new Map();
    errors = new Map();
    pending = new Set();
    gate = new previewModel_1.CaptureGate();
    timers = [];
    subs = [];
    running = false;
    constructor(browsers, capture = browserCapture_1.captureTab) {
        this.browsers = browsers;
        this.capture = capture;
        this.subs.push(this.browsers.onDidChangeRows(() => void this.tick(false)), vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration(`portpilot.${exports.SETTING}`)) {
                this.syncContext();
                void this.tick(false);
            }
        }));
        this.syncContext();
    }
    static names() {
        return (0, previewModel_1.parsePreviewNames)(vscode.workspace.getConfiguration('portpilot').get(exports.SETTING));
    }
    /** The view is listed only once a profile has previews on (package.json "when"). */
    syncContext() {
        void vscode.commands.executeCommand('setContext', 'portpilot.hasBrowserPreviews', BrowserPreviewView.names().length > 0);
    }
    static async setPreview(profile, on) {
        const next = (0, previewModel_1.withPreview)(BrowserPreviewView.names(), profile, on);
        await vscode.workspace.getConfiguration('portpilot').update(exports.SETTING, next, vscode.ConfigurationTarget.Global);
    }
    resolveWebviewView(view) {
        this.view = view;
        view.webview.options = { enableScripts: true };
        view.webview.html = html(crypto.randomBytes(16).toString('base64'));
        view.onDidDispose(() => { this.view = undefined; this.stopTimers(); this.browsers.setPreviewing(false); });
        view.onDidChangeVisibility(() => this.visibilityChanged());
        view.webview.onDidReceiveMessage((m) => void this.onMessage(m));
        this.visibilityChanged();
    }
    visibilityChanged() {
        const on = !!this.view?.visible;
        this.browsers.setPreviewing(on);
        this.stopTimers();
        if (on) {
            this.timers = [setInterval(() => void this.tick(false), TICK_MS), setInterval(() => this.post(), AGE_MS)];
            void this.tick(false);
        }
    }
    stopTimers() {
        this.timers.forEach(clearInterval);
        this.timers = [];
    }
    /** Looks at every enabled, running profile once; the gate keeps each to one capture per 30 s. */
    async tick(force) {
        if (!this.view?.visible || this.running) {
            this.post();
            return;
        }
        this.running = true;
        try {
            const names = BrowserPreviewView.names();
            for (const row of this.browsers.getRows()) {
                if (!(0, previewModel_1.hasPreview)(names, row.name) || row.state !== 'running')
                    continue;
                const tab = (0, browserCapture_1.pickPreviewTab)(row.tabs);
                if (!tab) {
                    this.errors.set(row.name, 'No web page is open.');
                    continue;
                }
                if (force)
                    this.gate.forget(row.name);
                if (this.gate.enter(row.name, Date.now()) !== 'go')
                    continue;
                this.pending.add(row.name);
                this.post();
                try {
                    this.shots.set(row.name, await this.capture(row.port, tab));
                    this.errors.delete(row.name);
                }
                catch (err) {
                    this.errors.set(row.name, err.message || 'The preview failed.');
                }
                finally {
                    this.pending.delete(row.name);
                    this.gate.done();
                }
                this.post();
            }
        }
        finally {
            this.running = false;
            this.post();
        }
    }
    cards() {
        const names = BrowserPreviewView.names();
        const now = Date.now();
        // Running profiles first, then in the Browsers tree's own order.
        const rows = this.browsers.getRows().filter(r => (0, previewModel_1.hasPreview)(names, r.name));
        rows.sort((a, b) => Number(b.state === 'running') - Number(a.state === 'running'));
        return rows.map(r => {
            const shot = this.shots.get(r.name);
            const err = this.errors.get(r.name);
            const running = r.state === 'running';
            return {
                name: r.name,
                port: r.port,
                state: r.state,
                img: shot ? `data:image/jpeg;base64,${shot.jpeg}` : null,
                title: shot?.title || '',
                age: shot ? (0, previewModel_1.ageLabel)(shot.at, now) : '',
                note: !running ? (r.state === 'held' ? 'Port held by another program' : 'Stopped')
                    : err && !shot ? err
                        : this.pending.has(r.name) && !shot ? 'Taking a picture (up to 10 s if the window is covered)' : '',
                canOpen: running && !!(0, browserCapture_1.pickPreviewTab)(r.tabs),
            };
        });
    }
    post() {
        if (!this.view)
            return;
        void this.view.webview.postMessage({ type: 'cards', cards: this.cards(), empty: BrowserPreviewView.names().length === 0 });
    }
    async onMessage(m) {
        if (m.type === 'ready') {
            this.post();
            void this.tick(false);
            return;
        }
        // The name comes from the page; only act on a profile that is in the Browsers list.
        const row = this.browsers.getRow(typeof m.name === 'string' ? m.name : '');
        if (!row)
            return;
        if (m.type === 'start')
            await vscode.commands.executeCommand('portpilot.startBrowser', new browsersTreeProvider_1.BrowserProfileItem(row));
        else if (m.type === 'stop')
            await vscode.commands.executeCommand('portpilot.stopBrowser', new browsersTreeProvider_1.BrowserProfileItem(row));
        else if (m.type === 'refresh')
            await this.tick(true);
        else if (m.type === 'hide') {
            await BrowserPreviewView.setPreview(row.name, false);
            this.shots.delete(row.name);
        }
        else if (m.type === 'open') {
            const tab = (0, browserCapture_1.pickPreviewTab)(row.tabs);
            if (tab)
                await vscode.commands.executeCommand('portpilot.focusBrowserTab', new browsersTreeProvider_1.BrowserTabItem(row.name, row.port, tab));
        }
    }
    dispose() {
        this.stopTimers();
        this.subs.forEach(s => s.dispose());
    }
}
exports.BrowserPreviewView = BrowserPreviewView;
function html(nonce) {
    return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style nonce="${nonce}">
  body { margin: 0; padding: 8px; color: var(--vscode-foreground); font: var(--vscode-font-size) var(--vscode-font-family); }
  #grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 190px)); gap: 8px; }
  .card { border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); border-radius: 6px; overflow: hidden; background: var(--vscode-editor-background); display: flex; flex-direction: column; }
  .shot { position: relative; aspect-ratio: 16 / 9; background: var(--vscode-editorWidget-background); display: flex; align-items: center; justify-content: center; color: var(--vscode-descriptionForeground); font-size: 11px; text-align: center; padding: 4px; }
  .shot img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: top; cursor: pointer; }
  .card.stopped .shot img { opacity: 0.45; }
  .meta { padding: 5px 7px 2px; display: flex; gap: 6px; align-items: baseline; }
  .meta b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dot { width: 8px; height: 8px; border-radius: 50%; flex: none; background: var(--vscode-disabledForeground); align-self: center; }
  .running .dot { background: var(--vscode-testing-iconPassed); }
  .held .dot { background: var(--vscode-charts-orange); }
  .sub { padding: 0 7px 5px; color: var(--vscode-descriptionForeground); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .acts { display: flex; gap: 4px; padding: 0 6px 6px; }
  button { font: inherit; font-size: 11px; color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); border: 0; border-radius: 3px; padding: 2px 8px; cursor: pointer; }
  button:hover { background: var(--vscode-button-secondaryHoverBackground); }
  button.primary { color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
  button.primary:hover { background: var(--vscode-button-hoverBackground); }
  #empty { color: var(--vscode-descriptionForeground); padding: 4px; }
</style></head><body>
<div id="empty" hidden>No previews on. Right-click a browser profile and choose Show Preview.</div>
<div id="grid"></div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const grid = document.getElementById('grid'), empty = document.getElementById('empty');
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
  const send = (type, name) => vscode.postMessage({ type, name });
  window.addEventListener('message', (ev) => {
    if (!ev.data || ev.data.type !== 'cards') return;
    empty.hidden = !ev.data.empty;
    grid.replaceChildren(...ev.data.cards.map((c) => {
      const card = el('div', 'card ' + (c.state === 'running' ? 'running' : c.state === 'held' ? 'held' : 'stopped'));
      const shot = el('div', 'shot', c.img ? '' : (c.note || 'No picture yet'));
      if (c.img) {
        const img = el('img'); img.src = c.img; img.alt = c.title || c.name; img.title = c.title || c.name;
        if (c.canOpen) img.addEventListener('click', () => send('open', c.name));
        shot.append(img);
      }
      const meta = el('div', 'meta'); meta.append(el('span', 'dot'), el('b', '', c.name), el('span', 'sub', ':' + c.port));
      const sub = el('div', 'sub', c.img ? (c.state === 'running' ? c.age : 'Stopped, last seen ' + c.age) : '');
      if (c.img && c.state === 'running' && c.note) sub.textContent = c.age + ' - ' + c.note;
      const acts = el('div', 'acts');
      const btn = (label, type, primary) => { const b = el('button', primary ? 'primary' : '', label); b.addEventListener('click', () => send(type, c.name)); acts.append(b); };
      if (c.state === 'running') { btn('Refresh', 'refresh'); btn('Stop', 'stop'); } else if (c.state === 'stopped') btn('Start', 'start', true);
      btn('Hide', 'hide');
      card.append(shot, meta, sub, acts);
      return card;
    }));
  });
  vscode.postMessage({ type: 'ready' });
</script></body></html>`;
}
//# sourceMappingURL=browserPreviewView.js.map