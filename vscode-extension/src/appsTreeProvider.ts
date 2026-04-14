import * as vscode from 'vscode';
import { readConfig, PortPilotApp, PortPilotGroup } from './config';
import { scanPorts, ActivePort } from './portScanner';

export class GroupTreeItem extends vscode.TreeItem {
  constructor(
    public readonly group: PortPilotGroup,
    public readonly apps: AppTreeItem[]
  ) {
    super(group.name, vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = 'group';
    this.iconPath = new vscode.ThemeIcon('folder', new vscode.ThemeColor('charts.yellow'));
    this.description = `${apps.length} apps`;
  }
}

export class AppTreeItem extends vscode.TreeItem {
  constructor(
    public readonly app: PortPilotApp,
    public readonly activePort: ActivePort | undefined
  ) {
    super(app.name, vscode.TreeItemCollapsibleState.None);

    const isRunning = !!activePort;
    const port = activePort?.port ?? app.preferredPort;

    this.contextValue = isRunning ? 'app-running' : 'app-stopped';
    this.iconPath = new vscode.ThemeIcon(
      isRunning ? 'circle-filled' : 'circle-outline',
      isRunning
        ? new vscode.ThemeColor('testing.iconPassed')
        : new vscode.ThemeColor('disabledForeground')
    );

    const parts: string[] = [];
    if (port) parts.push(`:${port}`);
    if (isRunning) parts.push('running');
    if (app.isFavorite) parts.push('\u2605');
    this.description = parts.join(' \u00b7 ');

    const tooltipLines = [
      app.name,
      `Port: ${port ?? 'not set'}`,
      `Status: ${isRunning ? 'Running (PID ' + activePort!.pid + ')' : 'Stopped'}`,
      `Command: ${app.command}`,
      `Directory: ${app.cwd}`
    ];
    if (app.description) tooltipLines.push(`Description: ${app.description}`);
    this.tooltip = tooltipLines.join('\n');
  }
}

type TreeNode = GroupTreeItem | AppTreeItem;

export class AppsTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private activePorts: ActivePort[] = [];

  refresh(): void {
    this.activePorts = scanPorts();
    this._onDidChangeTreeData.fire(undefined);
  }

  setActivePorts(ports: ActivePort[]): void {
    this.activePorts = ports;
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TreeNode): TreeNode[] {
    if (element instanceof GroupTreeItem) {
      return element.apps;
    }

    const config = readConfig();
    if (!config.apps.length) return [];

    const groups = config.groups || [];
    const allApps = [...config.apps].sort((a, b) => {
      if (a.isFavorite !== b.isFavorite) return a.isFavorite ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    const makeAppItem = (app: PortPilotApp) => {
      const matched = this.activePorts.find(p => p.port === app.preferredPort);
      return new AppTreeItem(app, matched);
    };

    // If no groups, return flat list
    if (groups.length === 0) {
      return allApps.map(makeAppItem);
    }

    // Build grouped tree
    const result: TreeNode[] = [];
    const groupedAppIds = new Set<string>();

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
