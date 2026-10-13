import * as vscode from 'vscode';
import * as fs from 'fs';
import { readRunsCached, thumbDataUri } from './config';
import { buildHistory, liveRunIds, tooltipLines, HistoryEntry, HistoryGroup, HistoryRun, HistoryState } from './historyModel';

// Same vocabulary as the app rows (running / stopped / crashed); "ended unseen"
// is a run whose end PortPilot never saw. Shape carries the meaning, colour reinforces it.
const STATE_ICONS: Record<HistoryState, [string, string]> = {
  live: ['pass-filled', 'testing.iconPassed'],
  stopped: ['circle-outline', 'disabledForeground'],
  crashed: ['error', 'errorForeground'],
  unseen: ['debug-disconnect', 'charts.orange'],
};

export class HistoryGroupItem extends vscode.TreeItem {
  constructor(public readonly group: HistoryGroup, public readonly children: HistoryRunItem[]) {
    super(group.label, group.collapsed ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.Expanded);
    // A stable id keeps the user's expand/collapse choice across refreshes.
    this.id = `portpilot-history:${group.key}`;
    this.contextValue = 'history-group';
    this.description = String(group.entries.length);
  }
}

export class HistoryRunItem extends vscode.TreeItem {
  readonly tooltipText: string[];

  constructor(public readonly entry: HistoryEntry, folderExists: boolean) {
    super(entry.label, vscode.TreeItemCollapsibleState.None);
    const run = entry.run;
    const [icon, color] = STATE_ICONS[entry.state];
    this.id = `portpilot-run:${run.id}`;
    this.iconPath = new vscode.ThemeIcon(icon, new vscode.ThemeColor(color));
    this.description = [entry.time, entry.detected ? 'detected' : '', entry.pinned ? 'pinned' : ''].filter(Boolean).join(' · ');
    // Tokens, not one word: the menus match each with a regex (package.json "when").
    this.contextValue = [
      'hrun',
      entry.live ? 'hlive' : entry.cannotStart ? 'hnostart' : 'hstart',
      entry.pinned ? 'hpinned' : 'hunpinned',
      folderExists ? 'hfolder' : '',
      entry.url ? 'hurl' : '',
    ].filter(Boolean).join(' ');
    this.tooltipText = tooltipLines(entry);
    this.tooltip = this.tooltipText.join('\n');
    // Click = the primary action: open it when live, else start it again.
    this.command = { command: 'portpilot.openHistoryRun', title: 'Open', arguments: [this] };
  }
}

class NoteItem extends vscode.TreeItem {
  constructor(label: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'history-note';
    this.iconPath = new vscode.ThemeIcon('search');
  }
}

type Node = HistoryGroupItem | HistoryRunItem | NoteItem;

export class HistoryTreeProvider implements vscode.TreeDataProvider<Node> {
  private _onDidChangeTreeData = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private listening = new Set<number>();
  private query = '';
  /** What the tree last drew from; the 10s refresh only repaints when it moves. */
  private drawn = '';

  getQuery(): string { return this.query; }

  setQuery(query: string): void {
    this.query = query.trim();
    this.refresh();
  }

  /** The existing 10s refresh hands over the listening ports; repaint only if the view would differ. */
  update(ports: number[]): void {
    this.listening = new Set(ports);
    const { key, runs } = readRunsCached();
    const live = [...liveRunIds(runs.filter((r): r is HistoryRun => !!r && typeof r === 'object'), this.listening)].sort();
    const sig = `${key}|${live.join(',')}|${new Date().toDateString()}`;
    if (sig !== this.drawn) this.refresh();
  }

  refresh(): void {
    this.drawn = '';
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: Node): vscode.TreeItem {
    return element;
  }

  getChildren(element?: Node): Node[] {
    if (element instanceof HistoryGroupItem) return element.children;
    if (element) return [];
    try {
      const { key, runs } = readRunsCached();
      const built = buildHistory(runs, { query: this.query, listening: this.listening });
      const live = built.groups.flatMap(g => g.entries).filter(e => e.live).map(e => e.run.id).sort();
      this.drawn = `${key}|${live.join(',')}|${new Date().toDateString()}`;
      if (!built.groups.length) return this.query ? [new NoteItem(`No runs match "${this.query}"`)] : [];
      // A folder can be deleted after the run; one stat per distinct folder per paint.
      const folders = new Map<string, boolean>();
      const exists = (cwd?: string | null) => {
        if (!cwd) return false;
        if (!folders.has(cwd)) folders.set(cwd, fs.existsSync(cwd));
        return folders.get(cwd)!;
      };
      return built.groups.map(g => new HistoryGroupItem(g, g.entries.map(e => new HistoryRunItem(e, exists(e.run.cwd)))));
    } catch {
      return []; // an unreadable history is an empty view, never an error toast
    }
  }

  /** Hover card: the page thumbnail above the usual lines (read lazily, never on refresh). */
  resolveTreeItem(item: vscode.TreeItem, element: Node): vscode.TreeItem {
    if (!(element instanceof HistoryRunItem)) return item;
    const thumb = element.entry.run.page?.thumb;
    const uri = thumb ? thumbDataUri(thumb) : null;
    if (!uri) return item;
    const md = new vscode.MarkdownString();
    md.appendMarkdown(`![Page preview](${uri}|width=240)\n\n`);
    element.tooltipText.forEach((line, i) => {
      if (i) md.appendMarkdown('  \n');
      md.appendText(line);
    });
    item.tooltip = md;
    return item;
  }
}
