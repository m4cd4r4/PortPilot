import * as vscode from 'vscode';
import { readConfig, readRuntimeApps, readRowThumbs, thumbDataUri, rowStateOf, PortPilotApp, PortPilotGroup, RowState, RuntimeEntry } from './config';
import { scanPorts, computeRunning, ActivePort } from './portScanner';
import { arrange, previewFor, RowThumbRef, SortKey } from './treeModel';

export class GroupTreeItem extends vscode.TreeItem {
  constructor(
    public readonly group: PortPilotGroup,
    public readonly apps: TreeNode[],
    appCount: number
  ) {
    super(group.name, vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = 'group';
    this.iconPath = new vscode.ThemeIcon('folder', new vscode.ThemeColor('charts.yellow'));
    this.description = `${appCount} apps`;
  }
}

/** Collapsed tail node holding the idle apps of one sibling list. */
export class StoppedTreeItem extends vscode.TreeItem {
  constructor(public readonly apps: AppTreeItem[], scope: string) {
    super(`Stopped (${apps.length})`, vscode.TreeItemCollapsibleState.Collapsed);
    // A stable id keeps the user's expand/collapse choice across refreshes,
    // even though the count in the label changes.
    this.id = `portpilot-stopped:${scope}`;
    this.contextValue = 'stopped-fold';
    this.iconPath = new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('disabledForeground'));
  }
}

// A TreeView can't paint a row an arbitrary hex, but it can colour an icon with
// a registered ThemeColor. Map a branch's colour (the window's Peacock colour)
// to the nearest charts.* palette entry by hue so the branch icon is colour-coded
// roughly in step with the VS Code window.
function chartColorForHex(hex?: string): vscode.ThemeColor | undefined {
  if (!hex || !/^#?[0-9a-fA-F]{6}$/.test(hex)) return undefined;
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let hue = 0;
  if (d !== 0) {
    if (max === r) hue = ((g - b) / d) % 6;
    else if (max === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
    hue = hue * 60;
    if (hue < 0) hue += 360;
  }
  const id =
    hue < 25 || hue >= 330 ? 'charts.red' :
    hue < 45 ? 'charts.orange' :
    hue < 70 ? 'charts.yellow' :
    hue < 170 ? 'charts.green' :
    hue < 260 ? 'charts.blue' :
    'charts.purple';
  return new vscode.ThemeColor(id);
}

// Same vocabulary as the desktop row state cell (status.js rowStateOf); the
// icon stands in for the glyph. Colour only reinforces the shape (D5).
const STATE_ICONS: Record<RowState['state'], [string, string]> = {
  running: ['pass-filled', 'testing.iconPassed'],
  starting: ['loading~spin', 'charts.yellow'],
  error: ['warning', 'testing.iconFailed'],
  conflict: ['warning', 'charts.orange'],
  crashed: ['error', 'errorForeground'],
  stopped: ['circle-outline', 'disabledForeground'],
};

/** Row state for an app from the port scan plus its runtime entry. */
export function appRowState(activePort: ActivePort | undefined, entry: RuntimeEntry | undefined): RowState {
  // The runtime entry describes the last start; trust it for a live app only
  // when it matches the live process (port or pid), per configFile's contract.
  const matches = !!activePort && !!entry &&
    ((entry.port != null && entry.port === activePort.port) || (entry.pid != null && entry.pid === activePort.pid));
  const startedAt = matches && entry!.startedBy ? Date.parse(entry!.startedBy.at) : NaN;
  return rowStateOf({
    running: !!activePort,
    crashed: !activePort && !!entry?.crashed,
    exitCode: entry?.crashed?.exitCode ?? null,
    uptimeSec: Number.isFinite(startedAt) ? (Date.now() - startedAt) / 1000 : null,
    startedBy: matches ? entry!.startedBy : null,
  });
}

export class AppTreeItem extends vscode.TreeItem {
  public readonly rowState: RowState;
  /** Tooltip lines, kept so resolveTreeItem can put them under the preview image. */
  public readonly tooltipLines: string[];

  constructor(
    public readonly app: PortPilotApp,
    public readonly activePort: ActivePort | undefined,
    public readonly children: AppTreeItem[] = [],
    runtimeEntry?: RuntimeEntry,
    public readonly preview: RowThumbRef | null = null
  ) {
    super(
      app.name,
      children.length > 0
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.None
    );

    const isRunning = !!activePort;
    const port = activePort?.port ?? app.preferredPort;
    const isBranch = !!app.parentId;
    const row = this.rowState = appRowState(activePort, runtimeEntry);

    // A crashed app is not running: keep app-stopped so the start menu applies.
    this.contextValue = isRunning ? 'app-running' : 'app-stopped';
    const [icon, iconColor] = STATE_ICONS[row.state];

    // Branch rows get the git-branch icon, colour-coded by the branch colour, so
    // a child reads as a branch at a glance; top-level apps keep the status dot.
    this.iconPath = isBranch
      ? new vscode.ThemeIcon(
          'git-branch',
          chartColorForHex(app.color) ??
            new vscode.ThemeColor(isRunning ? 'testing.iconPassed' : 'disabledForeground')
        )
      : new vscode.ThemeIcon(icon, new vscode.ThemeColor(iconColor));

    const parts: string[] = [];
    if (isBranch && app.branch) parts.push(`\u2387 ${app.branch}`);
    if (port) parts.push(`:${port}`);
    if (row.state !== 'stopped') parts.push([row.word, row.reason].filter(Boolean).join(' '));
    if (row.uptime) parts.push(row.uptime);
    if (row.provenance) parts.push(row.provenance);
    if (children.length) parts.push(`\u2387${children.length}`); // branch count on a parent
    if (app.isFavorite) parts.push('\u2605');
    this.description = parts.join(' \u00b7 ');

    const tooltipLines = [
      app.name,
      ...(isBranch && app.branch ? [`Branch: ${app.branch}`] : []),
      ...(children.length ? [`Branches: ${children.length}`] : []),
      `Port: ${port ?? 'not set'}`,
      `Status: ${row.text}${isRunning ? ' (PID ' + activePort!.pid + ')' : ''}`,
      `Command: ${app.command}`,
      `Directory: ${app.cwd}`
    ];
    if (app.description) tooltipLines.push(`Description: ${app.description}`);
    this.tooltipLines = tooltipLines;
    // With a preview the tooltip stays unset: resolveTreeItem builds the image
    // card lazily, so the 10s refresh never reads a thumbnail file.
    if (preview) {
      // A string tooltip doubles as the screen-reader label; a MarkdownString does not.
      this.accessibilityInformation = { label: tooltipLines.join(', ') };
    } else {
      this.tooltip = tooltipLines.join('\n');
    }
  }
}

type TreeNode = GroupTreeItem | AppTreeItem | StoppedTreeItem;

export class AppsTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private runningByAppId: Map<string, ActivePort> = new Map();

  /** Tuck idle apps under a collapsed "Stopped (N)" node (portpilot.foldStoppedApps). */
  foldStopped = true;

  setFoldStopped(fold: boolean): void {
    this.foldStopped = fold;
    this._onDidChangeTreeData.fire(undefined);
  }

  /** Show a page preview in the hover card of running apps (portpilot.rowPreviews). */
  rowPreviews = true;

  setRowPreviews(show: boolean): void {
    this.rowPreviews = show;
    this._onDidChangeTreeData.fire(undefined);
  }

  async refresh(): Promise<void> {
    const activePorts = await scanPorts();
    this.runningByAppId = await computeRunning(readConfig().apps, activePorts);
    this._onDidChangeTreeData.fire(undefined);
  }

  async setActivePorts(ports: ActivePort[]): Promise<void> {
    this.runningByAppId = await computeRunning(readConfig().apps, ports);
    this._onDidChangeTreeData.fire(undefined);
  }

  getRunningByAppId(): Map<string, ActivePort> {
    return this.runningByAppId;
  }

  /** Apps whose last exit was a crash and that are not running again. */
  getCrashedApps(): PortPilotApp[] {
    const runtime = readRuntimeApps();
    return readConfig().apps.filter(a => !this.runningByAppId.has(a.id) && !!runtime[a.id]?.crashed);
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    return element;
  }

  /** Hover card: the page thumbnail above the usual tooltip lines. */
  resolveTreeItem(item: vscode.TreeItem, element: TreeNode): vscode.TreeItem {
    if (!(element instanceof AppTreeItem) || !element.preview) return item;
    const uri = thumbDataUri(element.preview.thumb);
    if (!uri) {
      // The thumbnail file is gone or unreadable: keep the plain tooltip.
      item.tooltip = element.tooltipLines.join('\n');
      return item;
    }
    const md = new vscode.MarkdownString();
    md.appendMarkdown(`![Page preview](${uri}|width=240)\n\n`);
    element.tooltipLines.forEach((line, i) => {
      if (i) md.appendMarkdown('  \n'); // hard line break, not a paragraph gap
      md.appendText(line);
    });
    item.tooltip = md;
    return item;
  }

  getChildren(element?: TreeNode): TreeNode[] {
    if (element instanceof GroupTreeItem || element instanceof StoppedTreeItem) {
      return element.apps;
    }
    // A parent app's children are its branch worktrees.
    if (element instanceof AppTreeItem) {
      return element.children;
    }

    const config = readConfig();
    if (!config.apps.length) return [];
    const runtime = readRuntimeApps();
    const thumbs = this.rowPreviews ? readRowThumbs() : {};

    const groups = config.groups || [];
    const keyOf = (i: AppTreeItem): SortKey => ({
      state: i.rowState.state,
      name: i.app.name,
      favorite: i.app.isFavorite,
      childStates: i.children.map(c => c.rowState.state),
    });

    // Branch children (parentId pointing at a real app) nest under their parent,
    // not at the top level. Build the map once.
    const appIds = new Set(config.apps.map(a => a.id));
    const isChild = (a: PortPilotApp) => !!a.parentId && appIds.has(a.parentId);
    const childrenByParent = new Map<string, PortPilotApp[]>();
    for (const a of config.apps) {
      if (isChild(a)) {
        const arr = childrenByParent.get(a.parentId!) ?? [];
        arr.push(a);
        childrenByParent.set(a.parentId!, arr);
      }
    }
    const topLevel = config.apps.filter(a => !isChild(a));

    const makeAppItem = (app: PortPilotApp): AppTreeItem => {
      const matched = this.runningByAppId.get(app.id);
      // Branches are sorted running-first but never folded: they sit under an
      // already-expanded parent the user chose to look at.
      const kids = arrange((childrenByParent.get(app.id) ?? []).map(makeAppItem), keyOf, false).visible;
      const preview = matched ? previewFor(thumbs, app.id, !!runtime[app.id], matched.port) : null;
      return new AppTreeItem(app, matched, kids, runtime[app.id], preview);
    };

    // Running first, then the idle ones folded into a tail node when enabled.
    const ordered = (items: AppTreeItem[], scope: string): TreeNode[] => {
      const { visible, stopped } = arrange(items, keyOf, this.foldStopped);
      return stopped.length ? [...visible, new StoppedTreeItem(stopped, scope)] : visible;
    };

    // If no groups, return flat list of top-level apps (each carrying its branches)
    if (groups.length === 0) {
      return ordered(topLevel.map(makeAppItem), 'root');
    }

    // Build grouped tree
    const result: TreeNode[] = [];
    const groupedAppIds = new Set<string>();

    for (const group of groups) {
      const groupApps = topLevel
        .filter(a => a.group === group.id)
        .map(a => {
          groupedAppIds.add(a.id);
          return makeAppItem(a);
        });

      if (groupApps.length > 0) {
        result.push(new GroupTreeItem(group, ordered(groupApps, `group:${group.id}`), groupApps.length));
      }
    }

    // Ungrouped apps go at root level
    const ungrouped = topLevel
      .filter(a => !groupedAppIds.has(a.id))
      .map(makeAppItem);

    result.push(...ordered(ungrouped, 'root'));
    return result;
  }
}
