import * as vscode from 'vscode';
import { browserCall, BrowserResult, addBrowserProfile, removeBrowserProfile, installedBrowsers, readBrowserProfilesCached } from './config';
import { BrowsersTreeProvider, BrowserProfileItem, BrowserTabItem } from './browsersTreeProvider';
import { MODES, failureMessage, isRefusal, validateOpenUrl, cdpUrlFor, normaliseProfiles, suggestPort, nameProblem, portProblem } from './browserModel';
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

  /** + in the view title: name, port (the next free one is offered) and what it is for. Writes the shared config. */
  async function addProfile(): Promise<void> {
    const profiles = normaliseProfiles(readBrowserProfilesCached().profiles);
    const usedBy = new Map(profiles.map(p => [p.port, p.name]));
    const held = provider.getRows().filter(r => r.state === 'held').map(r => r.port);

    const name = await vscode.window.showInputBox({
      title: 'Add a browser profile (1 of 3)',
      prompt: 'A short name. It also names the profile\'s folder, which keeps its own sign-ins.',
      placeHolder: 'google',
      validateInput: v => nameProblem(v, profiles.map(p => p.name)),
    });
    if (name === undefined) return;

    const portText = await vscode.window.showInputBox({
      title: 'Add a browser profile (2 of 3)',
      prompt: 'The debug port this profile owns. Nothing else picks it.',
      value: String(suggestPort(usedBy.keys(), held)),
      validateInput: v => portProblem(v, usedBy),
    });
    if (portText === undefined) return;

    const purpose = await vscode.window.showInputBox({
      title: 'Add a browser profile (3 of 3)',
      prompt: 'Optional: what it is for, so Claude can pick it ("Google Search Console, Analytics"). Leave empty to skip.',
    });
    if (purpose === undefined) return;

    // The browser the newest profile uses, else the first one installed here.
    const installed = installedBrowsers();
    const last = profiles.length ? profiles[profiles.length - 1].browser : '';
    const browser = installed.some(b => b.id === last) ? last : (installed[0]?.id ?? last ?? 'chrome');
    const res = addBrowserProfile({ name: name.trim(), port: Number(portText), browser, ...(purpose.trim() ? { purpose: purpose.trim() } : {}) });
    await provider.refresh();
    if (!res.ok) { void vscode.window.showWarningMessage(`Could not add the profile. ${res.reason}`); return; }
    quiet(`Added ${res.name} on :${res.port}`);
  }

  /** Remove from PortPilot only; the folder and its sign-ins stay on disk. A running profile is stopped first, by the user. */
  async function removeProfile(item: unknown): Promise<void> {
    const p = profileOf(item);
    if (!p) return;
    const { name, port, state } = p.row;
    if (state === 'running') {
      void vscode.window.showInformationMessage(`${name} is running. Stop it before removing it.`);
      return;
    }
    const pick = await vscode.window.showWarningMessage(
      `Remove the browser profile "${name}" (:${port})?`,
      { modal: true, detail: 'Its folder and the sign-ins in it stay on disk. PortPilot just stops listing it.' },
      'Remove'
    );
    if (pick !== 'Remove') return;
    const res = removeBrowserProfile(name);
    await provider.refresh();
    if (!res.ok) { void vscode.window.showWarningMessage(`Could not remove ${name}. ${res.reason}`); return; }
    quiet(`Removed ${name}`);
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
    vscode.commands.registerCommand('portpilot.addBrowserProfile', addProfile),
    vscode.commands.registerCommand('portpilot.removeBrowserProfile', removeProfile),
    vscode.commands.registerCommand('portpilot.refreshBrowsers', () => provider.refresh())
  );
}
