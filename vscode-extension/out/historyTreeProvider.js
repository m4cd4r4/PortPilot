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
exports.HistoryTreeProvider = exports.HistoryRunItem = exports.HistoryGroupItem = void 0;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const config_1 = require("./config");
const historyModel_1 = require("./historyModel");
// Same vocabulary as the app rows (running / stopped / crashed); "ended unseen"
// is a run whose end PortPilot never saw. Shape carries the meaning, colour reinforces it.
const STATE_ICONS = {
    live: ['pass-filled', 'testing.iconPassed'],
    stopped: ['circle-outline', 'disabledForeground'],
    crashed: ['error', 'errorForeground'],
    unseen: ['debug-disconnect', 'charts.orange'],
};
class HistoryGroupItem extends vscode.TreeItem {
    group;
    children;
    constructor(group, children) {
        super(group.label, group.collapsed ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.Expanded);
        this.group = group;
        this.children = children;
        // A stable id keeps the user's expand/collapse choice across refreshes.
        this.id = `portpilot-history:${group.key}`;
        this.contextValue = 'history-group';
        this.description = String(group.entries.length);
    }
}
exports.HistoryGroupItem = HistoryGroupItem;
class HistoryRunItem extends vscode.TreeItem {
    entry;
    tooltipText;
    constructor(entry, folderExists) {
        super(entry.label, vscode.TreeItemCollapsibleState.None);
        this.entry = entry;
        const run = entry.run;
        const [icon, color] = STATE_ICONS[entry.state];
        this.id = `portpilot-run:${run.id}`;
        this.iconPath = new vscode.ThemeIcon(icon, new vscode.ThemeColor(color));
        this.description = [entry.time, entry.detected ? 'detected' : '', entry.pinned ? 'pinned' : ''].filter(Boolean).join(' · ');
        // Tokens, not one word: the menus match each with a regex (package.json "when").
        this.contextValue = [
            'hrun',
            entry.live ? 'hlive' : entry.cannotStart ? 'hnostart' : 'hstart',
            entry.pinned ? 'hpinned' : 'hunpinned',
            folderExists ? 'hfolder' : '',
            entry.url ? 'hurl' : '',
        ].filter(Boolean).join(' ');
        this.tooltipText = (0, historyModel_1.tooltipLines)(entry);
        this.tooltip = this.tooltipText.join('\n');
        // Click = the primary action: open it when live, else start it again.
        this.command = { command: 'portpilot.openHistoryRun', title: 'Open', arguments: [this] };
    }
}
exports.HistoryRunItem = HistoryRunItem;
class NoteItem extends vscode.TreeItem {
    constructor(label) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.contextValue = 'history-note';
        this.iconPath = new vscode.ThemeIcon('search');
    }
}
class HistoryTreeProvider {
    _onDidChangeTreeData = new vscode.EventEmitter();
    onDidChangeTreeData = this._onDidChangeTreeData.event;
    listening = new Set();
    query = '';
    /** What the tree last drew from; the 10s refresh only repaints when it moves. */
    drawn = '';
    getQuery() { return this.query; }
    setQuery(query) {
        this.query = query.trim();
        this.refresh();
    }
    /** The existing 10s refresh hands over the listening ports; repaint only if the view would differ. */
    update(ports) {
        this.listening = new Set(ports);
        const { key, runs } = (0, config_1.readRunsCached)();
        const live = [...(0, historyModel_1.liveRunIds)(runs.filter((r) => !!r && typeof r === 'object'), this.listening)].sort();
        const sig = `${key}|${live.join(',')}|${new Date().toDateString()}`;
        if (sig !== this.drawn)
            this.refresh();
    }
    refresh() {
        this.drawn = '';
        this._onDidChangeTreeData.fire(undefined);
    }
    getTreeItem(element) {
        return element;
    }
    getChildren(element) {
        if (element instanceof HistoryGroupItem)
            return element.children;
        if (element)
            return [];
        try {
            const { key, runs } = (0, config_1.readRunsCached)();
            const built = (0, historyModel_1.buildHistory)(runs, { query: this.query, listening: this.listening });
            const live = built.groups.flatMap(g => g.entries).filter(e => e.live).map(e => e.run.id).sort();
            this.drawn = `${key}|${live.join(',')}|${new Date().toDateString()}`;
            if (!built.groups.length)
                return this.query ? [new NoteItem(`No runs match "${this.query}"`)] : [];
            // A folder can be deleted after the run; one stat per distinct folder per paint.
            const folders = new Map();
            const exists = (cwd) => {
                if (!cwd)
                    return false;
                if (!folders.has(cwd))
                    folders.set(cwd, fs.existsSync(cwd));
                return folders.get(cwd);
            };
            return built.groups.map(g => new HistoryGroupItem(g, g.entries.map(e => new HistoryRunItem(e, exists(e.run.cwd)))));
        }
        catch {
            return []; // an unreadable history is an empty view, never an error toast
        }
    }
    /** Hover card: the page thumbnail above the usual lines (read lazily, never on refresh). */
    resolveTreeItem(item, element) {
        if (!(element instanceof HistoryRunItem))
            return item;
        const thumb = element.entry.run.page?.thumb;
        const uri = thumb ? (0, config_1.thumbDataUri)(thumb) : null;
        if (!uri)
            return item;
        const md = new vscode.MarkdownString();
        md.appendMarkdown(`![Page preview](${uri}|width=240)\n\n`);
        element.tooltipText.forEach((line, i) => {
            if (i)
                md.appendMarkdown('  \n');
            md.appendText(line);
        });
        item.tooltip = md;
        return item;
    }
}
exports.HistoryTreeProvider = HistoryTreeProvider;
//# sourceMappingURL=historyTreeProvider.js.map