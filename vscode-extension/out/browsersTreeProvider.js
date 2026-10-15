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
exports.BrowsersTreeProvider = exports.BrowserTabItem = exports.BrowserProfileItem = void 0;
const vscode = __importStar(require("vscode"));
const config_1 = require("./config");
const browserModel_1 = require("./browserModel");
const browserProbe_1 = require("./browserProbe");
// Same vocabulary as the Apps rows: running / stopped / port held. Shape carries the
// meaning, colour reinforces it.
const STATE_ICONS = {
    running: ['pass-filled', 'testing.iconPassed'],
    stopped: ['circle-outline', 'disabledForeground'],
    held: ['warning', 'charts.orange'],
    unknown: ['circle-outline', 'disabledForeground'],
};
/** How often the slower, process-inspecting API read runs while nothing else changed. */
const FULL_EVERY_MS = 60_000;
class BrowserProfileItem extends vscode.TreeItem {
    row;
    constructor(row) {
        super(row.name, row.tabs.length ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
        this.row = row;
        const [icon, color] = STATE_ICONS[row.state];
        // A stable id keeps the user's expand/collapse choice across refreshes.
        this.id = `portpilot-browser:${row.name}`;
        this.iconPath = new vscode.ThemeIcon(icon, new vscode.ThemeColor(color));
        this.description = row.description;
        this.tooltip = row.tooltip.join('\n');
        // Tokens, not one word: the menus match each with a regex (package.json "when").
        this.contextValue = ['bprofile', row.state === 'running' ? 'bup' : row.state === 'held' ? 'bheld' : 'bdown'].join(' ');
    }
}
exports.BrowserProfileItem = BrowserProfileItem;
class BrowserTabItem extends vscode.TreeItem {
    profile;
    port;
    tab;
    constructor(profile, port, tab) {
        super((0, browserModel_1.tabLabel)(tab), vscode.TreeItemCollapsibleState.None);
        this.profile = profile;
        this.port = port;
        this.tab = tab;
        this.id = `portpilot-btab:${profile}:${tab.id}`;
        this.iconPath = new vscode.ThemeIcon('browser');
        this.description = tab.title ? tab.url : undefined;
        this.tooltip = [tab.title, tab.url].filter(Boolean).join('\n');
        this.contextValue = 'btab';
        // Click = bring the tab to the front.
        this.command = { command: 'portpilot.focusBrowserTab', title: 'Focus Tab', arguments: [this] };
    }
}
exports.BrowserTabItem = BrowserTabItem;
class MoreItem extends vscode.TreeItem {
    constructor(hidden) {
        super(`${hidden} more tab${hidden === 1 ? '' : 's'} not listed`, vscode.TreeItemCollapsibleState.None);
        this.contextValue = 'bnote';
    }
}
class BrowsersTreeProvider {
    call;
    _onDidChangeTreeData = new vscode.EventEmitter();
    onDidChangeTreeData = this._onDidChangeTreeData.event;
    visible = false;
    rows = [];
    /** What the tree last drew; a poll repaints only when it moves. */
    drawn = '';
    polling = false;
    again = false;
    full = new Map();
    fullAt = 0;
    lightSig = '';
    seenConfig = '';
    /** `call` runs the API's list; tests hand in a fake. */
    constructor(call = config_1.browserCall) {
        this.call = call;
    }
    /** The view's visibility. A hidden view does no polling at all; showing it reads straight away. */
    setVisible(visible) {
        if (visible === this.visible)
            return;
        this.visible = visible;
        if (visible)
            void this.poll(true);
    }
    /** The existing 10 s refresh calls this; it does nothing while the view is hidden. */
    async update() {
        if (this.visible)
            await this.poll(false);
    }
    /** Title-bar Refresh and after any action: look again and re-read the API. */
    refresh() {
        return this.poll(true);
    }
    getRows() {
        return this.rows;
    }
    getRow(name) {
        return this.rows.find(r => r.name === name);
    }
    getTreeItem(element) {
        return element;
    }
    getChildren(element) {
        if (element instanceof BrowserProfileItem) {
            const { row } = element;
            const tabs = row.tabs.map(t => new BrowserTabItem(row.name, row.port, t));
            return row.tabsHidden ? [...tabs, new MoreItem(row.tabsHidden)] : tabs;
        }
        if (element)
            return [];
        try {
            // Before the first look the profiles are listed with no state, so the view is never blank while it checks.
            if (!this.rows.length && !this.drawn) {
                const profiles = (0, browserModel_1.normaliseProfiles)((0, config_1.readBrowserProfilesCached)().profiles);
                return (0, browserModel_1.buildRows)(profiles, new Map()).map(r => new BrowserProfileItem(r));
            }
            return this.rows.map(r => new BrowserProfileItem(r));
        }
        catch {
            return []; // an unreadable config is an empty view, never an error toast
        }
    }
    async poll(force) {
        if (this.polling) {
            this.again = this.again || force;
            return;
        }
        this.polling = true;
        try {
            const cached = (0, config_1.readBrowserProfilesCached)();
            const profiles = (0, browserModel_1.normaliseProfiles)(cached.profiles);
            const configChanged = cached.key !== this.seenConfig;
            this.seenConfig = cached.key;
            const probes = new Map();
            await Promise.all(profiles.map(async (p) => { probes.set(p.name, await (0, browserProbe_1.probeProfile)(p.port)); }));
            // Up/held/down per profile, before the API refines it: a change here is what earns a fresh API read.
            const lightSig = profiles.map(p => {
                const pr = probes.get(p.name);
                return `${p.name}:${pr.up ? 'u' : pr.held ? 'h' : 'd'}`;
            }).join('|');
            const needFull = force || configChanged || lightSig !== this.lightSig || Date.now() - this.fullAt >= FULL_EVERY_MS;
            this.lightSig = lightSig;
            if (needFull && profiles.length)
                await this.readFull();
            const rows = (0, browserModel_1.buildRows)(profiles, probes, this.full);
            const sig = JSON.stringify(rows);
            if (sig !== this.drawn) {
                this.rows = rows;
                this.drawn = sig;
                this._onDidChangeTreeData.fire(undefined);
            }
        }
        catch {
            /* a failed look leaves the last drawing in place */
        }
        finally {
            this.polling = false;
            if (this.again) {
                this.again = false;
                void this.poll(true);
            }
        }
    }
    /** The API's own listing: claims, leases and who holds a blocked port. A failure keeps the last read. */
    async readFull() {
        let res;
        try {
            res = await this.call('list_browser_profiles');
        }
        catch {
            return;
        }
        this.fullAt = Date.now();
        if (!res.success || !Array.isArray(res.profiles))
            return;
        const next = new Map();
        for (const r of res.profiles) {
            if (r && typeof r === 'object' && typeof r.name === 'string')
                next.set(r.name.toLowerCase(), r);
        }
        this.full = next;
    }
    dispose() {
        this._onDidChangeTreeData.dispose();
    }
}
exports.BrowsersTreeProvider = BrowsersTreeProvider;
//# sourceMappingURL=browsersTreeProvider.js.map