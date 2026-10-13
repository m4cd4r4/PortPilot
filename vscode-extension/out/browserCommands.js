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
exports.registerBrowserCommands = registerBrowserCommands;
const vscode = __importStar(require("vscode"));
const config_1 = require("./config");
const browsersTreeProvider_1 = require("./browsersTreeProvider");
const browserModel_1 = require("./browserModel");
const browserProbe_1 = require("./browserProbe");
/** An API failure as a message: refusals the API makes on purpose are information, the rest warnings. */
function showFailure(res) {
    const text = (0, browserModel_1.failureMessage)(res);
    if ((0, browserModel_1.isRefusal)(res.code))
        void vscode.window.showInformationMessage(text);
    else
        void vscode.window.showWarningMessage(text);
}
const quiet = (text) => vscode.window.setStatusBarMessage(`PortPilot: ${text}`, 3000);
function registerBrowserCommands(context, { provider, call = config_1.browserCall }) {
    const profileOf = (item) => (item instanceof browsersTreeProvider_1.BrowserProfileItem ? item : undefined);
    /** Start or stop run for up to ~10 s, so they get a progress notification; the view repaints after. */
    async function runWithProgress(title, tool, args) {
        const res = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title }, () => call(tool, args));
        await provider.refresh();
        return res;
    }
    async function start(item) {
        const p = profileOf(item);
        if (!p)
            return;
        const { name, port } = p.row;
        const res = await runWithProgress(`Starting ${name} on :${port}...`, 'start_browser', { name });
        if (!res.success)
            return showFailure(res);
        if (res.already)
            void vscode.window.showInformationMessage(`${name} is already running on :${port}.`);
        else
            quiet(`Started ${name} on :${port}`);
    }
    async function stop(item) {
        const p = profileOf(item);
        if (!p)
            return;
        const { name } = p.row;
        const res = await runWithProgress(`Stopping ${name}...`, 'stop_browser', { name });
        if (!res.success)
            return showFailure(res);
        if (res.already)
            void vscode.window.showInformationMessage(`${name} was not running.`);
        else
            quiet(`Stopped ${name}`);
    }
    async function setMode(item) {
        const p = profileOf(item);
        if (!p)
            return;
        const { name, mode } = p.row;
        const pick = await vscode.window.showQuickPick(browserModel_1.MODES.map(m => ({ label: m.label, description: m.id === mode ? 'current' : undefined, detail: m.hint, id: m.id })), { title: `Mode for ${name}`, placeHolder: 'Takes effect the next time the profile starts' });
        if (!pick || pick.id === mode)
            return;
        const res = await call('set_browser_mode', { name, mode: pick.id });
        await provider.refresh();
        if (!res.success)
            return showFailure(res);
        // The API says the running browser keeps its old mode; pass that on.
        if (typeof res.note === 'string' && res.note)
            void vscode.window.showInformationMessage(`${name} is now ${pick.label}. ${res.note}`);
        else
            quiet(`${name} set to ${pick.label}`);
    }
    async function openUrl(item) {
        const p = profileOf(item);
        if (!p)
            return;
        const { name, port, state } = p.row;
        if (state !== 'running') {
            void vscode.window.showInformationMessage(`${name} is not running. Start it first.`);
            return;
        }
        const input = await vscode.window.showInputBox({
            title: `Open a page in ${name}`,
            prompt: 'An http:// or https:// URL, opened as a new tab in this profile.',
            placeHolder: 'https://example.com',
            validateInput: v => {
                const r = (0, browserModel_1.validateOpenUrl)(v);
                return r.ok ? undefined : r.reason;
            },
        });
        if (input === undefined)
            return;
        const checked = (0, browserModel_1.validateOpenUrl)(input);
        if (!checked.ok)
            return;
        const res = await (0, browserProbe_1.openUrlInProfile)(port, checked.url);
        if (!res.ok) {
            void vscode.window.showWarningMessage(`Could not open the page in ${name}. ${res.reason}`);
            return;
        }
        quiet(`Opened ${checked.url} in ${name}`);
        setTimeout(() => { void provider.refresh(); }, 600);
    }
    async function focusTab(item) {
        if (!(item instanceof browsersTreeProvider_1.BrowserTabItem))
            return;
        const res = await (0, browserProbe_1.activateTab)(item.port, item.tab.id);
        if (!res.ok)
            void vscode.window.showWarningMessage(`Could not focus that tab in ${item.profile}. ${res.reason}`);
        await provider.refresh();
    }
    async function copy(text, what) {
        await vscode.env.clipboard.writeText(text);
        quiet(`Copied ${what}`);
    }
    context.subscriptions.push(vscode.commands.registerCommand('portpilot.startBrowser', start), vscode.commands.registerCommand('portpilot.stopBrowser', stop), vscode.commands.registerCommand('portpilot.setBrowserMode', setMode), vscode.commands.registerCommand('portpilot.openBrowserUrl', openUrl), vscode.commands.registerCommand('portpilot.focusBrowserTab', focusTab), vscode.commands.registerCommand('portpilot.copyBrowserCdp', (item) => {
        const p = profileOf(item);
        return p ? copy((0, browserModel_1.cdpUrlFor)(p.row.port), (0, browserModel_1.cdpUrlFor)(p.row.port)) : undefined;
    }), vscode.commands.registerCommand('portpilot.copyBrowserPort', (item) => {
        const p = profileOf(item);
        return p ? copy(String(p.row.port), `port ${p.row.port}`) : undefined;
    }), vscode.commands.registerCommand('portpilot.refreshBrowsers', () => provider.refresh()));
}
//# sourceMappingURL=browserCommands.js.map