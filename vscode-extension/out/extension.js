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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const child_process_1 = require("child_process");
const os = __importStar(require("os"));
const config_1 = require("./config");
const appsTreeProvider_1 = require("./appsTreeProvider");
const portsTreeProvider_1 = require("./portsTreeProvider");
const portScanner_1 = require("./portScanner");
function activate(context) {
    const appsProvider = new appsTreeProvider_1.AppsTreeProvider();
    const portsProvider = new portsTreeProvider_1.PortsTreeProvider();
    vscode.window.registerTreeDataProvider('portpilot.apps', appsProvider);
    vscode.window.registerTreeDataProvider('portpilot.activePorts', portsProvider);
    // Status bar item
    const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
    statusBar.command = 'portpilot.refresh';
    statusBar.text = '$(plug) PP: ...';
    statusBar.tooltip = 'PortPilot - Click to refresh';
    statusBar.show();
    context.subscriptions.push(statusBar);
    function updateStatusBar() {
        const ports = portsProvider.getCachedPorts();
        const config = (0, config_1.readConfig)();
        const runningCount = config.apps.filter((a) => a.preferredPort && ports.some(p => p.port === a.preferredPort)).length;
        statusBar.text = `$(plug) PP: ${runningCount} running`;
        statusBar.tooltip = `PortPilot - ${config.apps.length} apps, ${runningCount} running, ${ports.length} ports`;
    }
    // File watcher on portpilot-config.json - stays in sync with Electron app
    const configPath = (0, config_1.getConfigPath)();
    const configDir = vscode.Uri.file(configPath.replace(/[/\\][^/\\]+$/, ''));
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(configDir, 'portpilot-config.json'));
    watcher.onDidChange(() => refreshAll());
    watcher.onDidCreate(() => refreshAll());
    context.subscriptions.push(watcher);
    function refreshAll() {
        portsProvider.refresh();
        appsProvider.setActivePorts(portsProvider.getCachedPorts());
        updateStatusBar();
    }
    // Auto-refresh every 10 seconds
    const interval = setInterval(() => refreshAll(), 10000);
    context.subscriptions.push({ dispose: () => clearInterval(interval) });
    // Initial load
    refreshAll();
    // Commands
    context.subscriptions.push(vscode.commands.registerCommand('portpilot.refresh', () => {
        refreshAll();
        vscode.window.setStatusBarMessage('PortPilot: Refreshed', 2000);
    }), vscode.commands.registerCommand('portpilot.scanPorts', () => {
        refreshAll();
        const count = portsProvider.getCachedPorts().length;
        vscode.window.setStatusBarMessage(`PortPilot: Found ${count} active ports`, 3000);
    }), vscode.commands.registerCommand('portpilot.startApp', (item) => {
        const app = item.app;
        const shell = os.platform() === 'win32' ? 'cmd.exe' : '/bin/sh';
        const shellFlag = os.platform() === 'win32' ? '/c' : '-c';
        const env = { ...process.env, ...app.env };
        if (app.preferredPort) {
            env.PORT = String(app.preferredPort);
        }
        const terminal = vscode.window.createTerminal({
            name: `PortPilot: ${app.name}`,
            cwd: app.cwd,
            env,
            shellPath: shell,
            shellArgs: [shellFlag, app.command]
        });
        terminal.show();
        // Refresh after a delay to pick up the new port
        setTimeout(() => refreshAll(), 3000);
    }), vscode.commands.registerCommand('portpilot.stopApp', (item) => {
        if (!item.activePort) {
            vscode.window.showWarningMessage(`${item.app.name} is not running.`);
            return;
        }
        const pid = item.activePort.pid;
        const cmd = os.platform() === 'win32'
            ? `taskkill /F /PID ${pid}`
            : `kill -9 ${pid}`;
        (0, child_process_1.exec)(cmd, (error) => {
            if (error) {
                vscode.window.showErrorMessage(`Failed to stop ${item.app.name}: ${error.message}`);
            }
            else {
                vscode.window.showInformationMessage(`Stopped ${item.app.name} (PID ${pid})`);
                setTimeout(() => refreshAll(), 1000);
            }
        });
    }), vscode.commands.registerCommand('portpilot.killPort', (item) => {
        const port = item.activePort.port;
        vscode.window.showWarningMessage(`Kill process on port ${port} (${item.activePort.processName})?`, 'Kill', 'Cancel').then(choice => {
            if (choice !== 'Kill')
                return;
            if ((0, portScanner_1.killPort)(port)) {
                vscode.window.showInformationMessage(`Killed process on port ${port}`);
                setTimeout(() => refreshAll(), 1000);
            }
            else {
                vscode.window.showErrorMessage(`Failed to kill port ${port}`);
            }
        });
    }), vscode.commands.registerCommand('portpilot.openInBrowser', (item) => {
        let port;
        if (item instanceof appsTreeProvider_1.AppTreeItem) {
            port = item.activePort?.port ?? item.app.preferredPort ?? undefined;
        }
        else {
            port = item.activePort.port;
        }
        if (port) {
            vscode.env.openExternal(vscode.Uri.parse(`http://localhost:${port}`));
        }
    }), vscode.commands.registerCommand('portpilot.openFolder', (item) => {
        const folderUri = vscode.Uri.file(item.app.cwd);
        vscode.commands.executeCommand('vscode.openFolder', folderUri, { forceNewWindow: false });
    }), 
    // ============ App Management Commands ============
    vscode.commands.registerCommand('portpilot.addApp', async () => {
        const name = await vscode.window.showInputBox({
            prompt: 'App name',
            placeHolder: 'My App'
        });
        if (!name)
            return;
        const folders = vscode.workspace.workspaceFolders;
        let cwd;
        if (folders && folders.length > 0) {
            const pick = await vscode.window.showQuickPick([
                ...folders.map(f => ({ label: f.name, description: f.uri.fsPath, value: f.uri.fsPath })),
                { label: 'Browse...', description: 'Choose a different folder', value: '__browse__' },
                { label: 'Enter path manually', description: '', value: '__manual__' }
            ], { placeHolder: 'Working directory' });
            if (!pick)
                return;
            if (pick.value === '__browse__') {
                const selected = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false });
                cwd = selected?.[0]?.fsPath;
            }
            else if (pick.value === '__manual__') {
                cwd = await vscode.window.showInputBox({ prompt: 'Working directory (absolute path)' });
            }
            else {
                cwd = pick.value;
            }
        }
        else {
            const selected = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false });
            cwd = selected?.[0]?.fsPath;
        }
        if (!cwd)
            return;
        const command = await vscode.window.showInputBox({
            prompt: 'Start command',
            placeHolder: 'npm run dev'
        });
        if (!command)
            return;
        const portStr = await vscode.window.showInputBox({
            prompt: 'Preferred port (leave empty for none)',
            placeHolder: '3000',
            validateInput: v => {
                if (!v)
                    return null;
                const n = parseInt(v, 10);
                return (n >= 1 && n <= 65535) ? null : 'Port must be 1-65535';
            }
        });
        if (portStr === undefined)
            return;
        const now = new Date().toISOString();
        const app = {
            id: (0, config_1.generateId)(),
            name,
            command,
            cwd,
            preferredPort: portStr ? parseInt(portStr, 10) : null,
            fallbackRange: null,
            env: {},
            autoStart: false,
            isFavorite: false,
            color: '#4fc3f7',
            createdAt: now,
            updatedAt: now
        };
        const config = (0, config_1.readConfig)();
        config.apps.push(app);
        (0, config_1.writeConfig)(config);
        refreshAll();
        vscode.window.showInformationMessage(`Added "${name}" to PortPilot`);
    }), vscode.commands.registerCommand('portpilot.editApp', async (item) => {
        const app = item.app;
        const field = await vscode.window.showQuickPick([
            { label: 'Name', description: app.name, value: 'name' },
            { label: 'Command', description: app.command, value: 'command' },
            { label: 'Port', description: String(app.preferredPort ?? 'not set'), value: 'preferredPort' },
            { label: 'Working Directory', description: app.cwd, value: 'cwd' },
            { label: 'Description', description: app.description ?? '', value: 'description' }
        ], { placeHolder: `Edit ${app.name} - pick a field` });
        if (!field)
            return;
        const config = (0, config_1.readConfig)();
        const target = config.apps.find(a => a.id === app.id);
        if (!target)
            return;
        if (field.value === 'preferredPort') {
            const val = await vscode.window.showInputBox({
                prompt: 'Preferred port',
                value: String(target.preferredPort ?? ''),
                validateInput: v => {
                    if (!v)
                        return null;
                    const n = parseInt(v, 10);
                    return (n >= 1 && n <= 65535) ? null : 'Port must be 1-65535';
                }
            });
            if (val === undefined)
                return;
            target.preferredPort = val ? parseInt(val, 10) : null;
        }
        else if (field.value === 'cwd') {
            const selected = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false });
            if (!selected?.[0])
                return;
            target.cwd = selected[0].fsPath;
        }
        else {
            const key = field.value;
            const val = await vscode.window.showInputBox({
                prompt: field.label,
                value: String(target[key] ?? '')
            });
            if (val === undefined)
                return;
            if (key === 'name')
                target.name = val;
            else if (key === 'command')
                target.command = val;
            else if (key === 'description')
                target.description = val;
        }
        target.updatedAt = new Date().toISOString();
        (0, config_1.writeConfig)(config);
        refreshAll();
        vscode.window.showInformationMessage(`Updated "${target.name}"`);
    }), vscode.commands.registerCommand('portpilot.deleteApp', async (item) => {
        const confirm = await vscode.window.showWarningMessage(`Delete "${item.app.name}" from PortPilot?`, 'Delete', 'Cancel');
        if (confirm !== 'Delete')
            return;
        const config = (0, config_1.readConfig)();
        config.apps = config.apps.filter(a => a.id !== item.app.id);
        (0, config_1.writeConfig)(config);
        refreshAll();
        vscode.window.showInformationMessage(`Deleted "${item.app.name}"`);
    }), vscode.commands.registerCommand('portpilot.toggleFavorite', (item) => {
        const config = (0, config_1.readConfig)();
        const target = config.apps.find(a => a.id === item.app.id);
        if (!target)
            return;
        target.isFavorite = !target.isFavorite;
        target.updatedAt = new Date().toISOString();
        (0, config_1.writeConfig)(config);
        refreshAll();
    }), vscode.commands.registerCommand('portpilot.changePort', async (item) => {
        const val = await vscode.window.showInputBox({
            prompt: `Port for ${item.app.name}`,
            value: String(item.app.preferredPort ?? ''),
            validateInput: v => {
                if (!v)
                    return null;
                const n = parseInt(v, 10);
                return (n >= 1 && n <= 65535) ? null : 'Port must be 1-65535';
            }
        });
        if (val === undefined)
            return;
        const config = (0, config_1.readConfig)();
        const target = config.apps.find(a => a.id === item.app.id);
        if (!target)
            return;
        target.preferredPort = val ? parseInt(val, 10) : null;
        target.updatedAt = new Date().toISOString();
        (0, config_1.writeConfig)(config);
        refreshAll();
        vscode.window.showInformationMessage(`${target.name} port set to ${target.preferredPort ?? 'none'}`);
    }), vscode.commands.registerCommand('portpilot.deleteAllApps', async () => {
        const config = (0, config_1.readConfig)();
        const count = config.apps.length;
        if (count === 0) {
            vscode.window.showInformationMessage('No apps to delete.');
            return;
        }
        const confirm = await vscode.window.showWarningMessage(`Delete ALL ${count} apps from PortPilot? This cannot be undone.`, 'Delete All', 'Cancel');
        if (confirm !== 'Delete All')
            return;
        config.apps = [];
        (0, config_1.writeConfig)(config);
        refreshAll();
        vscode.window.showInformationMessage(`Deleted ${count} apps`);
    }));
}
function deactivate() { }
//# sourceMappingURL=extension.js.map