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
class AppTreeItem extends vscode.TreeItem {
    app;
    activePort;
    constructor(app, activePort) {
        super(app.name, vscode.TreeItemCollapsibleState.None);
        this.app = app;
        this.activePort = activePort;
        const isRunning = !!activePort;
        const port = activePort?.port ?? app.preferredPort;
        this.contextValue = isRunning ? 'app-running' : 'app-stopped';
        this.iconPath = new vscode.ThemeIcon(isRunning ? 'circle-filled' : 'circle-outline', isRunning
            ? new vscode.ThemeColor('testing.iconPassed')
            : new vscode.ThemeColor('disabledForeground'));
        const parts = [];
        if (port)
            parts.push(`:${port}`);
        if (isRunning)
            parts.push('running');
        if (app.isFavorite)
            parts.push('\u2605');
        this.description = parts.join(' \u00b7 ');
        const tooltipLines = [
            app.name,
            `Port: ${port ?? 'not set'}`,
            `Status: ${isRunning ? 'Running (PID ' + activePort.pid + ')' : 'Stopped'}`,
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
    activePorts = [];
    refresh() {
        this.activePorts = (0, portScanner_1.scanPorts)();
        this._onDidChangeTreeData.fire(undefined);
    }
    setActivePorts(ports) {
        this.activePorts = ports;
        this._onDidChangeTreeData.fire(undefined);
    }
    getTreeItem(element) {
        return element;
    }
    getChildren(element) {
        if (element instanceof GroupTreeItem) {
            return element.apps;
        }
        const config = (0, config_1.readConfig)();
        if (!config.apps.length)
            return [];
        const groups = config.groups || [];
        const allApps = [...config.apps].sort((a, b) => {
            if (a.isFavorite !== b.isFavorite)
                return a.isFavorite ? -1 : 1;
            return a.name.localeCompare(b.name);
        });
        const makeAppItem = (app) => {
            const matched = this.activePorts.find(p => p.port === app.preferredPort);
            return new AppTreeItem(app, matched);
        };
        // If no groups, return flat list
        if (groups.length === 0) {
            return allApps.map(makeAppItem);
        }
        // Build grouped tree
        const result = [];
        const groupedAppIds = new Set();
        for (const group of groups) {
            const groupApps = allApps
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
        const ungrouped = allApps
            .filter(a => !groupedAppIds.has(a.id))
            .map(makeAppItem);
        result.push(...ungrouped);
        return result;
    }
}
exports.AppsTreeProvider = AppsTreeProvider;
//# sourceMappingURL=appsTreeProvider.js.map