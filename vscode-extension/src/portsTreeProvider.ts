import * as vscode from 'vscode';
import { readConfig, readRuntimeApps } from './config';
import { ActivePort, scanPorts } from './portScanner';

// Shared classification model (single source of truth with the desktop app and
// web portal). Shipped into runtime/core/status.js by copy-runtime.js; required
// relative to the compiled out/ directory.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PortPilotStatus: {
  classify: (
    p: { port: number; processName?: string; commandLine?: string; pid?: number; appId?: string },
    opts?: { registered?: boolean }
  ) => 'dev' | 'other' | 'system';
  GROUPS: Record<string, { key: string; label: string; order: number; defaultCollapsed: boolean }>;
  GROUP_ORDER: string[];
} = require('../runtime/core/status.js');

type GroupKey = 'dev' | 'other' | 'system';

export class PortTreeItem extends vscode.TreeItem {
  constructor(
    public readonly activePort: ActivePort,
    matchedAppName?: string,
    group: GroupKey = 'other',
    byClaude = false
  ) {
    super(`:${activePort.port}`, vscode.TreeItemCollapsibleState.None);

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

export class PortGroupTreeItem extends vscode.TreeItem {
  constructor(public readonly key: GroupKey, label: string, public readonly ports: PortTreeItem[], collapsed: boolean) {
    super(
      label,
      collapsed ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.Expanded
    );
    this.contextValue = 'port-group';
    this.description = `${ports.length}`;
    const glyph = key === 'dev' ? 'server-process' : key === 'system' ? 'gear' : 'plug';
    this.iconPath = new vscode.ThemeIcon(glyph);
  }
}

type PortNode = PortTreeItem | PortGroupTreeItem;

export class PortsTreeProvider implements vscode.TreeDataProvider<PortNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<PortNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private cachedPorts: ActivePort[] = [];
  // port -> appId from the apps provider's two-phase matcher, so an app on a
  // dynamic port is still named. Set by refreshAll in extension.ts.
  private appIdByPort: Map<number, string> = new Map();

  setAppIdByPort(map: Map<number, string>): void {
    this.appIdByPort = map;
    this._onDidChangeTreeData.fire(undefined);
  }

  async refresh(): Promise<void> {
    this.cachedPorts = await scanPorts();
    this._onDidChangeTreeData.fire(undefined);
  }

  getCachedPorts(): ActivePort[] {
    return this.cachedPorts;
  }

  getTreeItem(element: PortNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: PortNode): PortNode[] {
    if (element instanceof PortGroupTreeItem) {
      return element.ports;
    }

    // Root: classify the cached ports into Dev / Other / System groups, mirroring
    // the desktop app. Scanning is async and driven by refresh().
    const config = readConfig();
    const runtime = readRuntimeApps();
    const appById = new Map(config.apps.map(a => [a.id, a]));
    // Live matches first; a preferredPort match only names a port no live match claimed.
    const preferredByPort = new Map(
      config.apps.filter(a => a.preferredPort).map(a => [a.preferredPort!, a.id])
    );

    const buckets: Record<GroupKey, PortTreeItem[]> = { dev: [], other: [], system: [] };
    for (const p of this.cachedPorts) {
      const appId = this.appIdByPort.get(p.port) ?? preferredByPort.get(p.port);
      const app = appId ? appById.get(appId) : undefined;
      const group = PortPilotStatus.classify(
        { port: p.port, processName: p.processName, pid: p.pid },
        { registered: !!app }
      );
      const byClaude = !!appId && runtime[appId]?.startedBy?.kind === 'claude';
      buckets[group].push(new PortTreeItem(p, app?.name, group, byClaude));
    }

    const groups: PortNode[] = [];
    for (const key of PortPilotStatus.GROUP_ORDER as GroupKey[]) {
      const ports = buckets[key];
      if (ports.length === 0) continue;
      const meta = PortPilotStatus.GROUPS[key];
      groups.push(new PortGroupTreeItem(key, meta.label, ports, meta.defaultCollapsed));
    }
    return groups;
  }
}
