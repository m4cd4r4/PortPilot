import * as vscode from 'vscode';
import { browserCall, BrowserResult } from './config';
import { BrowsersTreeProvider, BrowserProfileItem, BrowserTabItem } from './browsersTreeProvider';
import { MODES, failureMessage, isRefusal, validateOpenUrl, cdpUrlFor } from './browserModel';
import { activateTab, openUrlInProfile } from './browserProbe';

interface Deps {
  provider: BrowsersTreeProvider;
  /** Runs one browser tool; defaults to the shared start/stop API the MCP tools use. */
  call?: (tool: string, args: Record<string, unknown>) => Promise<BrowserResult>;
}

/** An API failure as a message: refusals the API makes on purpose are information, the rest warnings. */
function showFailure(res: BrowserResult): void {
  const text = failureMessage(res);
  if (isRefusal(res.code)) void vscode.window.showInformationMessage(text);
  else void vscode.window.showWarningMessage(text);
}

const quiet = (text: string) => vscode.window.setStatusBarMessage(`PortPilot: ${text}`, 3000);

export function registerBrowserCommands(context: vscode.ExtensionContext, { provider, call = browserCall }: Deps): void {
  const profileOf = (item: unknown): BrowserProfileItem | undefined => (item instanceof BrowserProfileItem ? item : undefined);

  /** Start or stop run for up to ~10 s, so they get a progress notification; the view repaints after. */
  async function runWithProgress(title: string, tool: string, args: Record<string, unknown>): Promise<BrowserResult> {
    const res = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title },
      () => call(tool, args)
    );
    await provider.refresh();
    return res;
  }

  async function start(item: unknown): Promise<void> {
    const p = profileOf(item);
    if (!p) return;
    const { name, port } = p.row;
    const res = await runWithProgress(`Starting ${name} on :${port}...`, 'start_browser', { name });
    if (!res.success) return showFailure(res);
    if (res.already) void vscode.window.showInformationMessage(`${name} is already running on :${port}.`);
    else quiet(`Started ${name} on :${port}`);
  }

  async function stop(item: unknown): Promise<void> {
    const p = profileOf(item);
    if (!p) return;
    const { name } = p.row;
    const res = await runWithProgress(`Stopping ${name}...`, 'stop_browser', { name });
    if (!res.success) return showFailure(res);
    if (res.already) void vscode.window.showInformationMessage(`${name} was not running.`);
    else quiet(`Stopped ${name}`);
  }

  async function setMode(item: unknown): Promise<void> {
    const p = profileOf(item);
    if (!p) return;
    const { name, mode } = p.row;
    const pick = await vscode.window.showQuickPick(
      MODES.map(m => ({ label: m.label, description: m.id === mode ? 'current' : undefined, detail: m.hint, id: m.id })),
      { title: `Mode for ${name}`, placeHolder: 'Takes effect the next time the profile starts' }
    );
    if (!pick || pick.id === mode) return;
    const res = await call('set_browser_mode', { name, mode: pick.id });
    await provider.refresh();
    if (!res.success) return showFailure(res);
    // The API says the running browser keeps its old mode; pass that on.
    if (typeof res.note === 'string' && res.note) void vscode.window.showInformationMessage(`${name} is now ${pick.label}. ${res.note}`);
    else quiet(`${name} set to ${pick.label}`);
  }

  async function openUrl(item: unknown): Promise<void> {
    const p = profileOf(item);
    if (!p) return;
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
        const r = validateOpenUrl(v);
        return r.ok ? undefined : r.reason;
      },
    });
    if (input === undefined) return;
    const checked = validateOpenUrl(input);
    if (!checked.ok) return;
    const res = await openUrlInProfile(port, checked.url);
    if (!res.ok) {
      void vscode.window.showWarningMessage(`Could not open the page in ${name}. ${res.reason}`);
      return;
    }
    quiet(`Opened ${checked.url} in ${name}`);
    setTimeout(() => { void provider.refresh(); }, 600);
  }

  async function focusTab(item: unknown): Promise<void> {
    if (!(item instanceof BrowserTabItem)) return;
    const res = await activateTab(item.port, item.tab.id);
    if (!res.ok) void vscode.window.showWarningMessage(`Could not focus that tab in ${item.profile}. ${res.reason}`);
    await provider.refresh();
  }

  async function copy(text: string, what: string): Promise<void> {
    await vscode.env.clipboard.writeText(text);
    quiet(`Copied ${what}`);
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('portpilot.startBrowser', start),
    vscode.commands.registerCommand('portpilot.stopBrowser', stop),
    vscode.commands.registerCommand('portpilot.setBrowserMode', setMode),
    vscode.commands.registerCommand('portpilot.openBrowserUrl', openUrl),
    vscode.commands.registerCommand('portpilot.focusBrowserTab', focusTab),
    vscode.commands.registerCommand('portpilot.copyBrowserCdp', (item: unknown) => {
      const p = profileOf(item);
      return p ? copy(cdpUrlFor(p.row.port), cdpUrlFor(p.row.port)) : undefined;
    }),
    vscode.commands.registerCommand('portpilot.copyBrowserPort', (item: unknown) => {
      const p = profileOf(item);
      return p ? copy(String(p.row.port), `port ${p.row.port}`) : undefined;
    }),
    vscode.commands.registerCommand('portpilot.refreshBrowsers', () => provider.refresh())
  );
}
