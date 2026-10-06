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
exports.AppsTreeProvider = exports.AppTreeItem = exports.GroupTreeItem = void 0;
exports.appRowState = appRowState;
const vscode = __importStar(require("vscode"));
const config_1 = require("./config");
const portScanner_1 = require("./portScanner");
class GroupTreeItem extends vscode.TreeItem {
    group;
    apps;
    constructor(group, apps) {
        super(group.name, vscode.TreeItemCollapsibleState.Expanded);
        this.group = group;
        this.apps = apps;
        this.contextValue = 'group';
        this.iconPath = new vscode.ThemeIcon('folder', new vscode.ThemeColor('charts.yellow'));
        this.description = `${apps.length} apps`;
    }
}
exports.GroupTreeItem = GroupTreeItem;
// A TreeView can't paint a row an arbitrary hex, but it can colour an icon with
// a registered ThemeColor. Map a branch's colour (the window's Peacock colour)
// to the nearest charts.* palette entry by hue so the branch icon is colour-coded
// roughly in step with the VS Code window.
function chartColorForHex(hex) {
    if (!hex || !/^#?[0-9a-fA-F]{6}$/.test(hex))
        return undefined;
    const h = hex.replace('#', '');
    const r = parseInt(h.slice(0, 2), 16) / 255;
    const g = parseInt(h.slice(2, 4), 16) / 255;
    const b = parseInt(h.slice(4, 6), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let hue = 0;
    if (d !== 0) {
        if (max === r)
            hue = ((g - b) / d) % 6;
        else if (max === g)
            hue = (b - r) / d + 2;
        else
            hue = (r - g) / d + 4;
        hue = hue * 60;
        if (hue < 0)
            hue += 360;
    }
    const id = hue < 25 || hue >= 330 ? 'charts.red' :
        hue < 45 ? 'charts.orange' :
            hue < 70 ? 'charts.yellow' :
                hue < 170 ? 'charts.green' :
                    hue < 260 ? 'charts.blue' :
                        'charts.purple';
    return new vscode.ThemeColor(id);
}
// Same vocabulary as the desktop row state cell (status.js rowStateOf); the
// icon stands in for the glyph. Colour only reinforces the shape (D5).
const STATE_ICONS = {
    running: ['pass-filled', 'testing.iconPassed'],
    starting: ['loading~spin', 'charts.yellow'],
    error: ['warning', 'testing.iconFailed'],
    conflict: ['warning', 'charts.orange'],
    crashed: ['error', 'errorForeground'],
    stopped: ['circle-outline', 'disabledForeground'],
};
/** Row state for an app from the port scan plus its runtime entry. */
function appRowState(activePort, entry) {
    // The runtime entry describes the last start; trust it for a live app only
    // when it matches the live process (port or pid), per configFile's contract.
    const matches = !!activePort && !!entry &&
        ((entry.port != null && entry.port === activePort.port) || (entry.pid != null && entry.pid === activePort.pid));
    const startedAt = matches && entry.startedBy ? Date.parse(entry.startedBy.at) : NaN;
    return (0, config_1.rowStateOf)({
        running: !!activePort,
        crashed: !activePort && !!entry?.crashed,
        exitCode: entry?.crashed?.exitCode ?? null,
        uptimeSec: Number.isFinite(startedAt) ? (Date.now() - startedAt) / 1000 : null,
        startedBy: matches ? entry.startedBy : null,
    });
}
class AppTreeItem extends vscode.TreeItem {
    app;
    activePort;
    children;
    rowState;
    constructor(app, activePort, children = [], runtimeEntry) {
        super(app.name, children.length > 0
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.None);
        this.app = app;
        this.activePort = activePort;
        this.children = children;
        const isRunning = !!activePort;
        const port = activePort?.port ?? app.preferredPort;
        const isBranch = !!app.parentId;
        const row = this.rowState = appRowState(activePort, runtimeEntry);
        // A crashed app is not running: keep app-stopped so the start menu applies.
        this.contextValue = isRunning ? 'app-running' : 'app-stopped';
        const [icon, iconColor] = STATE_ICONS[row.state];
        // Branch rows get the git-branch icon, colour-coded by the branch colour, so
        // a child reads as a branch at a glance; top-level apps keep the status dot.
        this.iconPath = isBranch
            ? new vscode.ThemeIcon('git-branch', chartColorForHex(app.color) ??
                new vscode.ThemeColor(isRunning ? 'testing.iconPassed' : 'disabledForeground'))
            : new vscode.ThemeIcon(icon, new vscode.ThemeColor(iconColor));
        const parts = [];
        if (isBranch && app.branch)
            parts.push(`\u2387 ${app.branch}`);
        if (port)
            parts.push(`:${port}`);
        if (row.state === 'crashed')
            parts.push(['Crashed', row.reason].filter(Boolean).join(' '));
        if (row.uptime)
            parts.push(row.uptime);
        if (row.provenance)
            parts.push(row.provenance);
        if (children.length)
            parts.push(`\u2387${children.length}`); // branch count on a parent
        if (app.isFavorite)
            parts.push('\u2605');
        this.description = parts.join(' \u00b7 ');
        const tooltipLines = [
            app.name,
            ...(isBranch && app.branch ? [`Branch: ${app.branch}`] : []),
            ...(children.length ? [`Branches: ${children.length}`] : []),
            `Port: ${port ?? 'not set'}`,
            `Status: ${row.text}${isRunning ? ' (PID ' + activePort.pid + ')' : ''}`,
            `Command: ${app.command}`,
            `Directory: ${app.cwd}`
        ];
        if (app.description)
            tooltipLines.push(`Description: ${app.description}`);
        this.tooltip = tooltipLines.join('\n');
    }
}
exports.AppTreeItem = AppTreeItem;
class AppsTreeProvider {
    _onDidChangeTreeData = new vscode.EventEmitter();
    onDidChangeTreeData = this._onDidChangeTreeData.event;
    runningByAppId = new Map();
    async refresh() {
        const activePorts = await (0, portScanner_1.scanPorts)();
        this.runningByAppId = await (0, portScanner_1.computeRunning)((0, config_1.readConfig)().apps, activePorts);
        this._onDidChangeTreeData.fire(undefined);
    }
    async setActivePorts(ports) {
        this.runningByAppId = await (0, portScanner_1.computeRunning)((0, config_1.readConfig)().apps, ports);
        this._onDidChangeTreeData.fire(undefined);
    }
    getRunningByAppId() {
        return this.runningByAppId;
    }
    /** Apps whose last exit was a crash and that are not running again. */
    getCrashedApps() {
        const runtime = (0, config_1.readRuntimeApps)();
        return (0, config_1.readConfig)().apps.filter(a => !this.runningByAppId.has(a.id) && !!runtime[a.id]?.crashed);
    }
    getTreeItem(element) {
        return element;
    }
    getChildren(element) {
        if (element instanceof GroupTreeItem) {
            return element.apps;
        }
        // A parent app's children are its branch worktrees.
        if (element instanceof AppTreeItem) {
            return element.children;
        }
        const config = (0, config_1.readConfig)();
        if (!config.apps.length)
            return [];
        const runtime = (0, config_1.readRuntimeApps)();
        const groups = config.groups || [];
        const sortFn = (a, b) => {
            if (a.isFavorite !== b.isFavorite)
                return a.isFavorite ? -1 : 1;
            return a.name.localeCompare(b.name);
        };
        // Branch children (parentId pointing at a real app) nest under their parent,
        // not at the top level. Build the map once.
        const appIds = new Set(config.apps.map(a => a.id));
        const isChild = (a) => !!a.parentId && appIds.has(a.parentId);
        const childrenByParent = new Map();
        for (const a of config.apps) {
            if (isChild(a)) {
                const arr = childrenByParent.get(a.parentId) ?? [];
                arr.push(a);
                childrenByParent.set(a.parentId, arr);
            }
        }
        const topLevel = config.apps.filter(a => !isChild(a)).sort(sortFn);
        const makeAppItem = (app) => {
            const matched = this.runningByAppId.get(app.id);
            const kids = (childrenByParent.get(app.id) ?? [])
                .sort(sortFn)
                .map(makeAppItem);
            return new AppTreeItem(app, matched, kids, runtime[app.id]);
        };
        // If no groups, return flat list of top-level apps (each carrying its branches)
        if (groups.length === 0) {
            return topLevel.map(makeAppItem);
        }
        // Build grouped tree
        const result = [];
        const groupedAppIds = new Set();
        for (const group of groups) {
            const groupApps = topLevel
                .filter(a => a.group === group.id)
                .map(a => {
                groupedAppIds.add(a.id);
                return makeAppItem(a);
            });
            if (groupApps.length > 0) {
                result.push(new GroupTreeItem(group, groupApps));
            }
        }
        // Ungrouped apps go at root level
        const ungrouped = topLevel
            .filter(a => !groupedAppIds.has(a.id))
            .map(makeAppItem);
        result.push(...ungrouped);
        return result;
    }
}
exports.AppsTreeProvider = AppsTreeProvider;
//# sourceMappingURL=appsTreeProvider.js.map