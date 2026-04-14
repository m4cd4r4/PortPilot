import * as vscode from 'vscode';
import { readConfig } from './config';
import { ActivePort, scanPorts } from './portScanner';

export class PortTreeItem extends vscode.TreeItem {
  constructor(public readonly activePort: ActivePort, matchedAppName?: string) {
    super(`:${activePort.port}`, vscode.TreeItemCollapsibleState.None);

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

export class PortsTreeProvider implements vscode.TreeDataProvider<PortTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<PortTreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private cachedPorts: ActivePort[] = [];

  refresh(): void {
    this.cachedPorts = scanPorts();
    this._onDidChangeTreeData.fire(undefined);
  }

  getCachedPorts(): ActivePort[] {
    return this.cachedPorts;
  }

  getTreeItem(element: PortTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): PortTreeItem[] {
    if (!this.cachedPorts.length) {
      this.cachedPorts = scanPorts();
    }

    const config = readConfig();
    const appByPort = new Map(
      config.apps
        .filter(a => a.preferredPort)
        .map(a => [a.preferredPort!, a.name])
    );

    return this.cachedPorts.map(p => new PortTreeItem(p, appByPort.get(p.port)));
  }
}
