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
exports.PortsTreeProvider = exports.PortGroupTreeItem = exports.PortTreeItem = void 0;
const vscode = __importStar(require("vscode"));
const config_1 = require("./config");
const portScanner_1 = require("./portScanner");
// Shared classification model (single source of truth with the desktop app and
// web portal). Shipped into runtime/core/status.js by copy-runtime.js; required
// relative to the compiled out/ directory.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PortPilotStatus = require('../runtime/core/status.js');
class PortTreeItem extends vscode.TreeItem {
    activePort;
    constructor(activePort, matchedAppName, group = 'other', byClaude = false) {
        super(`:${activePort.port}`, vscode.TreeItemCollapsibleState.None);
        this.activePort = activePort;
        // System ports use a distinct contextValue so the kill / open-in-browser
        // context-menu items (gated on viewItem == active-port) never appear -
        // PortPilot should not invite killing OS-owned ports.
        this.contextValue = group === 'system' ? 'active-port-system' : 'active-port';
        const color = group === 'dev' ? 'charts.green' : group === 'system' ? 'disabledForeground' : 'charts.blue';
        this.iconPath = new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor(color));
        // An app name reads better than "node.exe"; the process stays in the tooltip.
        // ✦ marks a server Claude Code started, same glyph as the desktop row.
        const desc = matchedAppName ?? activePort.processName;
        this.description = `${byClaude ? '✦ ' : ''}${desc} (PID ${activePort.pid})`;
        this.tooltip = [
            `Port: ${activePort.port}`,
            `Process: ${activePort.processName}`,
            `PID: ${activePort.pid}`,
            matchedAppName ? `App: ${matchedAppName}` : '',
            byClaude ? 'Started by Claude Code' : ''
        ].filter(Boolean).join('\n');
    }
}
exports.PortTreeItem = PortTreeItem;
class PortGroupTreeItem extends vscode.TreeItem {
    key;
    ports;
    constructor(key, label, ports, collapsed) {
        super(label, collapsed ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.Expanded);
        this.key = key;
        this.ports = ports;
        this.contextValue = 'port-group';
        this.description = `${ports.length}`;
        const glyph = key === 'dev' ? 'server-process' : key === 'system' ? 'gear' : 'plug';
        this.iconPath = new vscode.ThemeIcon(glyph);
    }
}
exports.PortGroupTreeItem = PortGroupTreeItem;
class PortsTreeProvider {
    _onDidChangeTreeData = new vscode.EventEmitter();
    onDidChangeTreeData = this._onDidChangeTreeData.event;
    cachedPorts = [];
    // port -> appId from the apps provider's two-phase matcher, so an app on a
    // dynamic port is still named. Set by refreshAll in extension.ts.
    appIdByPort = new Map();
    setAppIdByPort(map) {
        this.appIdByPort = map;
        this._onDidChangeTreeData.fire(undefined);
    }
    async refresh() {
        this.cachedPorts = await (0, portScanner_1.scanPorts)();
        this._onDidChangeTreeData.fire(undefined);
    }
    getCachedPorts() {
        return this.cachedPorts;
    }
    getTreeItem(element) {
        return element;
    }
    getChildren(element) {
        if (element instanceof PortGroupTreeItem) {
            return element.ports;
        }
        // Root: classify the cached ports into Dev / Other / System groups, mirroring
        // the desktop app. Scanning is async and driven by refresh().
        const config = (0, config_1.readConfig)();
        const runtime = (0, config_1.readRuntimeApps)();
        const appById = new Map(config.apps.map(a => [a.id, a]));
        // Live matches first; a preferredPort match only names a port no live match claimed.
        const preferredByPort = new Map(config.apps.filter(a => a.preferredPort).map(a => [a.preferredPort, a.id]));
        const buckets = { dev: [], other: [], system: [] };
        for (const p of this.cachedPorts) {
            const appId = this.appIdByPort.get(p.port) ?? preferredByPort.get(p.port);
            const app = appId ? appById.get(appId) : undefined;
            const group = PortPilotStatus.classify({ port: p.port, processName: p.processName, pid: p.pid }, { registered: !!app });
            const byClaude = !!appId && runtime[appId]?.startedBy?.kind === 'claude';
            buckets[group].push(new PortTreeItem(p, app?.name, group, byClaude));
        }
        const groups = [];
        for (const key of PortPilotStatus.GROUP_ORDER) {
            const ports = buckets[key];
            if (ports.length === 0)
                continue;
            const meta = PortPilotStatus.GROUPS[key];
            groups.push(new PortGroupTreeItem(key, meta.label, ports, meta.defaultCollapsed));
        }
        return groups;
    }
}
exports.PortsTreeProvider = PortsTreeProvider;
//# sourceMappingURL=portsTreeProvider.js.map