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
exports.registerHistoryCommands = registerHistoryCommands;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const config_1 = require("./config");
const historyTreeProvider_1 = require("./historyTreeProvider");
const portWait_1 = require("./portWait");
const PIN_MESSAGES = {
    'not-found': 'That run is no longer in the history.',
    'pin-limit': 'Pin limit reached. Unpin a run first.',
};
const open = (url) => vscode.env.openExternal(vscode.Uri.parse(url));
function registerHistoryCommands(context, { provider, view, startApp }) {
    async function startAgain(item) {
        const { entry } = item;
        const run = entry.run;
        if (entry.cannotStart) {
            void vscode.window.showInformationMessage(`${entry.label} cannot be started again. ${entry.cannotStart}`);
            return;
        }
        if (!run.cwd || !fs.existsSync(run.cwd)) {
            void vscode.window.showInformationMessage(`${entry.label} cannot be started again. Its folder no longer exists: ${run.cwd}`);
            return;
        }
        const res = (0, config_1.appForRun)(run);
        const app = res.ok ? (0, config_1.readConfig)().apps.find(a => a.id === res.appId) : undefined;
        if (!res.ok || !app) {
            void vscode.window.showWarningMessage(`${entry.label} cannot be started again. ${res.ok ? 'Its app is no longer registered.' : res.error}`);
            return;
        }
        const port = res.port ?? run.port ?? app.preferredPort ?? null;
        // Reuse the recorded URL (path included) unless the app moves to a different port.
        const url = port && port === run.port && entry.url ? entry.url : port ? `http://localhost:${port}/` : null;
        // Something else already holds the port: starting would only fail, and opening would show the wrong page.
        if (port && await (0, portWait_1.portAnswers)(port)) {
            const pick = await vscode.window.showWarningMessage(`Port ${port} is already in use, so ${entry.label} was not started.`, 'Open Anyway');
            if (pick && url)
                void open(url);
            return;
        }
        startApp({ ...app, preferredPort: port });
        if (!port || !url) {
            void vscode.window.showInformationMessage(`Started ${entry.label}. No port was recorded, so no page was opened.`);
            return;
        }
        let cancelled = false;
        const up = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Starting ${entry.label} on :${port}...`, cancellable: true }, (_p, token) => (0, portWait_1.waitForPort)(port, { cancelled: () => (cancelled = token.isCancellationRequested) }));
        if (up)
            void open(url);
        else if (!cancelled)
            void vscode.window.showWarningMessage(`${entry.label} has not answered on :${port} after 60 seconds. It may still be starting in its terminal.`);
    }
    async function openRun(item) {
        if (!(item instanceof historyTreeProvider_1.HistoryRunItem))
            return;
        if (item.entry.live && item.entry.url) {
            void open(item.entry.url);
            return;
        }
        await startAgain(item);
    }
    context.subscriptions.push(vscode.commands.registerCommand('portpilot.openHistoryRun', openRun), vscode.commands.registerCommand('portpilot.startHistoryRun', (item) => item instanceof historyTreeProvider_1.HistoryRunItem ? startAgain(item) : undefined), vscode.commands.registerCommand('portpilot.copyHistoryUrl', async (item) => {
        if (!(item instanceof historyTreeProvider_1.HistoryRunItem))
            return;
        if (!item.entry.url) {
            void vscode.window.showInformationMessage(`${item.entry.label} has no URL recorded.`);
            return;
        }
        await vscode.env.clipboard.writeText(item.entry.url);
        vscode.window.setStatusBarMessage(`PortPilot: Copied ${item.entry.url}`, 2000);
    }), vscode.commands.registerCommand('portpilot.pinHistoryRun', (item) => pin(item, true)), vscode.commands.registerCommand('portpilot.unpinHistoryRun', (item) => pin(item, false)), vscode.commands.registerCommand('portpilot.openHistoryFolder', (item) => {
        const cwd = item instanceof historyTreeProvider_1.HistoryRunItem ? item.entry.run.cwd : null;
        if (!cwd || !fs.existsSync(cwd)) {
            void vscode.window.showInformationMessage('That folder no longer exists.');
            return;
        }
        void vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(cwd), { forceNewWindow: false });
    }), vscode.commands.registerCommand('portpilot.refreshHistory', () => provider.refresh()), vscode.commands.registerCommand('portpilot.searchHistory', async () => {
        const q = await vscode.window.showInputBox({
            prompt: 'Filter history by name, port, page title or branch. Leave empty to show everything.',
            placeHolder: 'shop 3005 checkout',
            value: provider.getQuery(),
        });
        if (q === undefined)
            return;
        provider.setQuery(q);
        view.description = provider.getQuery() ? `Filter: ${provider.getQuery()}` : undefined;
    }));
    function pin(item, pinned) {
        if (!(item instanceof historyTreeProvider_1.HistoryRunItem))
            return;
        const res = (0, config_1.pinHistoryRun)(item.entry.run.id, pinned);
        if (!res.ok)
            void vscode.window.showWarningMessage(PIN_MESSAGES[res.reason ?? ''] ?? 'Could not change the pin.');
        provider.refresh();
    }
}
//# sourceMappingURL=historyCommands.js.map