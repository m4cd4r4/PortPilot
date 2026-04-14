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
exports.PortsTreeProvider = exports.PortTreeItem = void 0;
const vscode = __importStar(require("vscode"));
const config_1 = require("./config");
const portScanner_1 = require("./portScanner");
class PortTreeItem extends vscode.TreeItem {
    activePort;
    constructor(activePort, matchedAppName) {
        super(`:${activePort.port}`, vscode.TreeItemCollapsibleState.None);
        this.activePort = activePort;
        this.contextValue = 'active-port';
        this.iconPath = new vscode.ThemeIcon('plug', new vscode.ThemeColor('testing.iconPassed'));
        const desc = matchedAppName ?? activePort.processName;
        this.description = `${desc} (PID ${activePort.pid})`;
        this.tooltip = [
            `Port: ${activePort.port}`,
            `Process: ${activePort.processName}`,
            `PID: ${activePort.pid}`,
            matchedAppName ? `App: ${matchedAppName}` : ''
        ].filter(Boolean).join('\n');
    }
}
exports.PortTreeItem = PortTreeItem;
class PortsTreeProvider {
    _onDidChangeTreeData = new vscode.EventEmitter();
    onDidChangeTreeData = this._onDidChangeTreeData.event;
    cachedPorts = [];
    refresh() {
        this.cachedPorts = (0, portScanner_1.scanPorts)();
        this._onDidChangeTreeData.fire(undefined);
    }
    getCachedPorts() {
        return this.cachedPorts;
    }
    getTreeItem(element) {
        return element;
    }
    getChildren() {
        if (!this.cachedPorts.length) {
            this.cachedPorts = (0, portScanner_1.scanPorts)();
        }
        const config = (0, config_1.readConfig)();
        const appByPort = new Map(config.apps
            .filter(a => a.preferredPort)
            .map(a => [a.preferredPort, a.name]));
        return this.cachedPorts.map(p => new PortTreeItem(p, appByPort.get(p.port)));
    }
}
exports.PortsTreeProvider = PortsTreeProvider;
//# sourceMappingURL=portsTreeProvider.js.map