import * as vscode from 'vscode';
import * as fs from 'fs';
import { exec } from 'child_process';
import * as os from 'os';
import {
  getConfigPath, readConfig, readRuntimeApps, updateConfig, generateId, logPathFor,
  PortPilotApp, recordHumanStart, recordAppStop
} from './config';
import { AppsTreeProvider, AppTreeItem, GroupTreeItem } from './appsTreeProvider';
import { PortsTreeProvider, PortTreeItem } from './portsTreeProvider';
import { killPort } from './portScanner';
import { appIdByPort, newCrashes, CrashStamp } from './treeModel';
import { WebPortal } from './webPortal';

let webPortal: WebPortal | undefined;

export function activate(context: vscode.ExtensionContext) {
  const appsProvider = new AppsTreeProvider();
  const portsProvider = new PortsTreeProvider();

  // createTreeView (not registerTreeDataProvider) so the Apps view can carry a
  // crash-count badge on the activity bar icon.
  const appsView = vscode.window.createTreeView('portpilot.apps', { treeDataProvider: appsProvider });
  context.subscriptions.push(appsView);
  vscode.window.registerTreeDataProvider('portpilot.activePorts', portsProvider);

  // "Stopped (N)" folding: setting-backed, with a view-title toggle whose icon
  // follows the portpilot.foldStopped context key.
  const readFold = () => vscode.workspace.getConfiguration('portpilot').get<boolean>('foldStoppedApps', true);
  const applyFold = (fold: boolean) => {
    appsProvider.setFoldStopped(fold);
    void vscode.commands.executeCommand('setContext', 'portpilot.foldStopped', fold);
  };
  applyFold(readFold());
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('portpilot.foldStoppedApps')) applyFold(readFold());
    })
  );
  // Page preview in the hover card of running apps (portpilot.rowPreviews).
  const readPreviews = () => vscode.workspace.getConfiguration('portpilot').get<boolean>('rowPreviews', true);
  appsProvider.setRowPreviews(readPreviews());
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('portpilot.rowPreviews')) appsProvider.setRowPreviews(readPreviews());
    })
  );
  const setFold = (fold: boolean) =>
    vscode.workspace.getConfiguration('portpilot').update('foldStoppedApps', fold, vscode.ConfigurationTarget.Global);

  const crashOutput = vscode.window.createOutputChannel('PortPilot Crashes');
  context.subscriptions.push(crashOutput);

  // Status bar item
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  statusBar.command = 'portpilot.apps.focus';
  statusBar.text = '$(plug) PP: ...';
  statusBar.tooltip = 'PortPilot - Click to show apps';
  statusBar.show();
  context.subscriptions.push(statusBar);

  function updateStatusBar() {
    const ports = portsProvider.getCachedPorts();
    const config = readConfig();
    // Use the same two-phase matcher as the apps tree so the count reflects apps
    // running on a dynamic port, not just those on their exact preferredPort.
    const runningCount = appsProvider.getRunningByAppId().size;
    const crashed = appsProvider.getCrashedApps();
    // Same words as the app rows: "Running", "Crashed". A crash wins the slot.
    statusBar.text = crashed.length === 1
      ? `$(error) PP: ${crashed[0].name} crashed`
      : crashed.length > 1
        ? `$(error) PP: ${crashed.length} crashed`
        : `$(pulse) PP: ${runningCount} running`;
    statusBar.backgroundColor = crashed.length
      ? new vscode.ThemeColor('statusBarItem.errorBackground')
      : undefined;
    statusBar.tooltip = [
      `PortPilot - ${config.apps.length} apps, ${runningCount} running, ${crashed.length} crashed, ${ports.length} ports`,
      ...crashed.map(a => `Crashed: ${a.name}`),
      'Click to show apps',
    ].join('\n');
  }

  // File watcher on portpilot-config.json and -runtime.json (crash stamps) - stays in sync with Electron app
  const configPath = getConfigPath();
  const configDir = vscode.Uri.file(configPath.replace(/[/\\][^/\\]+$/, ''));
  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(configDir, '{portpilot-config.json,portpilot-runtime.json}')
  );
  watcher.onDidChange(() => refreshAll());
  watcher.onDidCreate(() => refreshAll());
  context.subscriptions.push(watcher);

  async function refreshAll() {
    // Single async scan shared with both providers (no UI-thread blocking).
    await portsProvider.refresh();
    await appsProvider.setActivePorts(portsProvider.getCachedPorts());
    portsProvider.setAppIdByPort(appIdByPort(appsProvider.getRunningByAppId()));
    updateStatusBar();
    updateBadge();
    alertNewCrashes();
  }

  function updateBadge() {
    const n = appsProvider.getCrashedApps().length;
    appsView.badge = n ? { value: n, tooltip: `${n} app${n === 1 ? '' : 's'} crashed` } : undefined;
  }

  // High-water mark of crash stamps already seen. The first refresh only sets
  // it: a crash from before this window opened shows in the badge, not a toast.
  let crashSeenAt: number | undefined;

  function alertNewCrashes() {
    const runtime = readRuntimeApps();
    const running = new Set(appsProvider.getRunningByAppId().keys());
    if (crashSeenAt === undefined) {
      crashSeenAt = newCrashes(runtime, running, 0).latest;
      return;
    }
    const { crashes, latest } = newCrashes(runtime, running, crashSeenAt);
    crashSeenAt = latest;
    const apps = new Map(readConfig().apps.map(a => [a.id, a]));
    for (const { appId, stamp } of crashes) {
      const app = apps.get(appId);
      if (app) void showCrash(app, stamp);
    }
  }

  async function showCrash(app: PortPilotApp, stamp: CrashStamp) {
    const why = stamp.exitCode != null ? ` (exit ${stamp.exitCode})` : '';
    const who = stamp.startedBy?.kind === 'claude' ? ' Claude Code started it.' : '';
    const choice = await vscode.window.showErrorMessage(`${app.name} crashed${why}.${who}`, 'Restart', 'Logs');
    if (choice === 'Restart') {
      startApp(app);
    } else if (choice === 'Logs') {
      const file = logPathFor(app.id);
      if (fs.existsSync(file)) {
        await vscode.window.showTextDocument(vscode.Uri.file(file), { preview: true });
      } else {
        crashOutput.appendLine(`--- ${app.name} crashed${why} at ${new Date(stamp.at).toLocaleString()} ---`);
        crashOutput.appendLine(stamp.errorTail || '(no output was captured for this run)');
        crashOutput.show(true);
      }
    }
  }

  function startApp(app: PortPilotApp) {
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
    recordHumanStart(app);

    // Refresh after a delay to pick up the new port
    setTimeout(() => refreshAll(), 3000);
  }

  // Auto-refresh every 10 seconds
  const interval = setInterval(() => { void refreshAll(); }, 10000);
  context.subscriptions.push({ dispose: () => clearInterval(interval) });

  // Initial load
  refreshAll();

  // ===== Web Portal (opt-in: run the browser UI from this window, no Electron) =====
  webPortal = new WebPortal(context);
  if (vscode.workspace.getConfiguration('portpilot').get<boolean>('webPortal.enabled', false)) {
    webPortal.start();
  }
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('portpilot.webPortal.enabled')) {
        const on = vscode.workspace.getConfiguration('portpilot').get<boolean>('webPortal.enabled', false);
        if (on) { webPortal?.start({ notify: true }); } else { webPortal?.stop(); }
      }
    })
  );

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('portpilot.refresh', () => {
      refreshAll();
      vscode.window.setStatusBarMessage('PortPilot: Refreshed', 2000);
    }),

    vscode.commands.registerCommand('portpilot.scanPorts', () => {
      refreshAll();
      const count = portsProvider.getCachedPorts().length;
      vscode.window.setStatusBarMessage(`PortPilot: Found ${count} active ports`, 3000);
    }),

    vscode.commands.registerCommand('portpilot.startApp', (item: AppTreeItem) => {
      startApp(item.app);
    }),

    vscode.commands.registerCommand('portpilot.foldStopped', () => setFold(true)),
    vscode.commands.registerCommand('portpilot.unfoldStopped', () => setFold(false)),

    vscode.commands.registerCommand('portpilot.stopApp', (item: AppTreeItem) => {
      if (!item.activePort) {
        vscode.window.showWarningMessage(`${item.app.name} is not running.`);
        return;
      }
      const pid = item.activePort.pid;
      const cmd = os.platform() === 'win32'
        ? `taskkill /F /PID ${pid}`
        : `kill -9 ${pid}`;

      exec(cmd, (error) => {
        if (error) {
          vscode.window.showErrorMessage(`Failed to stop ${item.app.name}: ${error.message}`);
        } else {
          recordAppStop(item.app.id);
          vscode.window.showInformationMessage(`Stopped ${item.app.name} (PID ${pid})`);
          setTimeout(() => refreshAll(), 1000);
        }
      });
    }),

    vscode.commands.registerCommand('portpilot.killPort', (item: PortTreeItem) => {
      const port = item.activePort.port;
      vscode.window.showWarningMessage(
        `Kill process on port ${port} (${item.activePort.processName})?`,
        'Kill', 'Cancel'
      ).then(async choice => {
        if (choice !== 'Kill') return;
        if (await killPort(port)) {
          vscode.window.showInformationMessage(`Killed process on port ${port}`);
          setTimeout(() => { void refreshAll(); }, 1000);
        } else {
          vscode.window.showErrorMessage(`Failed to kill port ${port}`);
        }
      });
    }),

    vscode.commands.registerCommand('portpilot.openInBrowser', (item: AppTreeItem | PortTreeItem) => {
      let port: number | undefined;
      if (item instanceof AppTreeItem) {
        port = item.activePort?.port ?? item.app.preferredPort ?? undefined;
      } else {
        port = item.activePort.port;
      }
      if (port) {
        vscode.env.openExternal(vscode.Uri.parse(`http://localhost:${port}`));
      }
    }),

    vscode.commands.registerCommand('portpilot.openFolder', (item: AppTreeItem) => {
      const folderUri = vscode.Uri.file(item.app.cwd);
      vscode.commands.executeCommand('vscode.openFolder', folderUri, { forceNewWindow: false });
    }),

    // ============ App Management Commands ============

    vscode.commands.registerCommand('portpilot.addApp', async () => {
      const name = await vscode.window.showInputBox({
        prompt: 'App name',
        placeHolder: 'My App'
      });
      if (!name) return;

      const folders = vscode.workspace.workspaceFolders;
      let cwd: string | undefined;

      if (folders && folders.length > 0) {
        const pick = await vscode.window.showQuickPick(
          [
            ...folders.map(f => ({ label: f.name, description: f.uri.fsPath, value: f.uri.fsPath })),
            { label: 'Browse...', description: 'Choose a different folder', value: '__browse__' },
            { label: 'Enter path manually', description: '', value: '__manual__' }
          ],
          { placeHolder: 'Working directory' }
        );
        if (!pick) return;
        if (pick.value === '__browse__') {
          const selected = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false });
          cwd = selected?.[0]?.fsPath;
        } else if (pick.value === '__manual__') {
          cwd = await vscode.window.showInputBox({ prompt: 'Working directory (absolute path)' });
        } else {
          cwd = pick.value;
        }
      } else {
        const selected = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false });
        cwd = selected?.[0]?.fsPath;
      }
      if (!cwd) return;

      const command = await vscode.window.showInputBox({
        prompt: 'Start command',
        placeHolder: 'npm run dev'
      });
      if (!command) return;

      const portStr = await vscode.window.showInputBox({
        prompt: 'Preferred port (leave empty for none)',
        placeHolder: '3000',
        validateInput: v => {
          if (!v) return null;
          const n = parseInt(v, 10);
          return (n >= 1 && n <= 65535) ? null : 'Port must be 1-65535';
        }
      });
      if (portStr === undefined) return;

      const now = new Date().toISOString();
      const app: PortPilotApp = {
        id: generateId(),
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

      updateConfig(config => { config.apps.push(app); });
      refreshAll();
      vscode.window.showInformationMessage(`Added "${name}" to PortPilot`);
    }),

    vscode.commands.registerCommand('portpilot.editApp', async (item: AppTreeItem) => {
      const app = item.app;
      const field = await vscode.window.showQuickPick(
        [
          { label: 'Name', description: app.name, value: 'name' },
          { label: 'Command', description: app.command, value: 'command' },
          { label: 'Port', description: String(app.preferredPort ?? 'not set'), value: 'preferredPort' },
          { label: 'Working Directory', description: app.cwd, value: 'cwd' },
          { label: 'Description', description: app.description ?? '', value: 'description' }
        ],
        { placeHolder: `Edit ${app.name} - pick a field` }
      );
      if (!field) return;

      // Prompt first, then apply under the lock - see updateConfig.
      const target = readConfig().apps.find(a => a.id === app.id);
      if (!target) return;
      const patch: Partial<PortPilotApp> = {};

      if (field.value === 'preferredPort') {
        const val = await vscode.window.showInputBox({
          prompt: 'Preferred port',
          value: String(target.preferredPort ?? ''),
          validateInput: v => {
            if (!v) return null;
            const n = parseInt(v, 10);
            return (n >= 1 && n <= 65535) ? null : 'Port must be 1-65535';
          }
        });
        if (val === undefined) return;
        patch.preferredPort = val ? parseInt(val, 10) : null;
      } else if (field.value === 'cwd') {
        const selected = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false });
        if (!selected?.[0]) return;
        patch.cwd = selected[0].fsPath;
      } else {
        const key = field.value as keyof PortPilotApp;
        const val = await vscode.window.showInputBox({
          prompt: field.label,
          value: String(target[key] ?? '')
        });
        if (val === undefined) return;
        if (key === 'name') patch.name = val;
        else if (key === 'command') patch.command = val;
        else if (key === 'description') patch.description = val;
      }

      const updated = updateConfig(config => {
        const current = config.apps.find(a => a.id === app.id);
        if (current) Object.assign(current, patch, { updatedAt: new Date().toISOString() });
        return current;
      });
      refreshAll();
      if (updated) vscode.window.showInformationMessage(`Updated "${updated.name}"`);
    }),

    vscode.commands.registerCommand('portpilot.deleteApp', async (item: AppTreeItem) => {
      const confirm = await vscode.window.showWarningMessage(
        `Delete "${item.app.name}" from PortPilot?`,
        'Delete', 'Cancel'
      );
      if (confirm !== 'Delete') return;

      updateConfig(config => { config.apps = config.apps.filter(a => a.id !== item.app.id); });
      refreshAll();
      vscode.window.showInformationMessage(`Deleted "${item.app.name}"`);
    }),

    vscode.commands.registerCommand('portpilot.toggleFavorite', (item: AppTreeItem) => {
      updateConfig(config => {
        const target = config.apps.find(a => a.id === item.app.id);
        if (!target) return;
        target.isFavorite = !target.isFavorite;
        target.updatedAt = new Date().toISOString();
      });
      refreshAll();
    }),

    vscode.commands.registerCommand('portpilot.changePort', async (item: AppTreeItem) => {
      const val = await vscode.window.showInputBox({
        prompt: `Port for ${item.app.name}`,
        value: String(item.app.preferredPort ?? ''),
        validateInput: v => {
          if (!v) return null;
          const n = parseInt(v, 10);
          return (n >= 1 && n <= 65535) ? null : 'Port must be 1-65535';
        }
      });
      if (val === undefined) return;

      const target = updateConfig(config => {
        const current = config.apps.find(a => a.id === item.app.id);
        if (!current) return undefined;
        current.preferredPort = val ? parseInt(val, 10) : null;
        current.updatedAt = new Date().toISOString();
        return current;
      });
      if (!target) return;
      refreshAll();
      vscode.window.showInformationMessage(`${target.name} port set to ${target.preferredPort ?? 'none'}`);
    }),

    vscode.commands.registerCommand('portpilot.deleteAllApps', async () => {
      const count = readConfig().apps.length;
      if (count === 0) {
        vscode.window.showInformationMessage('No apps to delete.');
        return;
      }

      const confirm = await vscode.window.showWarningMessage(
        `Delete ALL ${count} apps from PortPilot? This cannot be undone.`,
        'Delete All', 'Cancel'
      );
      if (confirm !== 'Delete All') return;

      const deleted = updateConfig(config => {
        const n = config.apps.length;
        config.apps = [];
        return n;
      });
      refreshAll();
      vscode.window.showInformationMessage(`Deleted ${deleted} apps`);
    }),

    vscode.commands.registerCommand('portpilot.startWebPortal', () => {
      webPortal?.start({ notify: true });
    }),

    vscode.commands.registerCommand('portpilot.stopWebPortal', () => {
      webPortal?.stop();
      vscode.window.setStatusBarMessage('PortPilot: Web portal stopped', 2000);
    }),

    vscode.commands.registerCommand('portpilot.openWebPortal', () => {
      if (webPortal?.isRunning()) {
        webPortal.openInBrowser();
      } else {
        webPortal?.start({ notify: true });
      }
    })
  );
}

export function deactivate() {
  webPortal?.stop();
}
