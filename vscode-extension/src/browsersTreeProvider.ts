import * as vscode from 'vscode';
import { readBrowserProfilesCached, browserCall, BrowserResult } from './config';
import {
  BrowserRow, BrowserState, BrowserTab, FullRow, Probe, buildRows, normaliseProfiles, tabLabel,
} from './browserModel';
import { probeProfile } from './browserProbe';

// Same vocabulary as the Apps rows: running / stopped / port held. Shape carries the
// meaning, colour reinforces it.
const STATE_ICONS: Record<BrowserState, [string, string]> = {
  running: ['pass-filled', 'testing.iconPassed'],
  stopped: ['circle-outline', 'disabledForeground'],
  held: ['warning', 'charts.orange'],
  unknown: ['circle-outline', 'disabledForeground'],
};

/** How often the slower, process-inspecting API read runs while nothing else changed. */
const FULL_EVERY_MS = 60_000;

export class BrowserProfileItem extends vscode.TreeItem {
  constructor(public readonly row: BrowserRow) {
    super(row.name, row.tabs.length ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
    const [icon, color] = STATE_ICONS[row.state];
    // A stable id keeps the user's expand/collapse choice across refreshes.
    this.id = `portpilot-browser:${row.name}`;
    this.iconPath = new vscode.ThemeIcon(icon, new vscode.ThemeColor(color));
    this.description = row.description;
    this.tooltip = row.tooltip.join('\n');
    // Tokens, not one word: the menus match each with a regex (package.json "when").
    this.contextValue = ['bprofile', row.state === 'running' ? 'bup' : row.state === 'held' ? 'bheld' : 'bdown'].join(' ');
  }
}

export class BrowserTabItem extends vscode.TreeItem {
  constructor(public readonly profile: string, public readonly port: number, public readonly tab: BrowserTab) {
    super(tabLabel(tab), vscode.TreeItemCollapsibleState.None);
    this.id = `portpilot-btab:${profile}:${tab.id}`;
    this.iconPath = new vscode.ThemeIcon('browser');
    this.description = tab.title ? tab.url : undefined;
    this.tooltip = [tab.title, tab.url].filter(Boolean).join('\n');
    this.contextValue = 'btab';
    // Click = bring the tab to the front.
    this.command = { command: 'portpilot.focusBrowserTab', title: 'Focus Tab', arguments: [this] };
  }
}

class MoreItem extends vscode.TreeItem {
  constructor(hidden: number) {
    super(`${hidden} more tab${hidden === 1 ? '' : 's'} not listed`, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'bnote';
  }
}

type Node = BrowserProfileItem | BrowserTabItem | MoreItem;

export class BrowsersTreeProvider implements vscode.TreeDataProvider<Node> {
  private _onDidChangeTreeData = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private visible = false;
  private rows: BrowserRow[] = [];
  /** What the tree last drew; a poll repaints only when it moves. */
  private drawn = '';
  private polling = false;
  private again = false;
  private full = new Map<string, FullRow>();
  private fullAt = 0;
  private lightSig = '';
  private seenConfig = '';

  /** `call` runs the API's list; tests hand in a fake. */
  constructor(private readonly call: (tool: string, args?: Record<string, unknown>) => Promise<BrowserResult> = browserCall) {}

  /** The view's visibility. A hidden view does no polling at all; showing it reads straight away. */
  setVisible(visible: boolean): void {
    if (visible === this.visible) return;
    this.visible = visible;
    if (visible) void this.poll(true);
  }

  /** The existing 10 s refresh calls this; it does nothing while the view is hidden. */
  async update(): Promise<void> {
    if (this.visible) await this.poll(false);
  }

  /** Title-bar Refresh and after any action: look again and re-read the API. */
  refresh(): Promise<void> {
    return this.poll(true);
  }

  getRows(): BrowserRow[] {
    return this.rows;
  }

  getRow(name: string): BrowserRow | undefined {
    return this.rows.find(r => r.name === name);
  }

  getTreeItem(element: Node): vscode.TreeItem {
    return element;
  }

  getChildren(element?: Node): Node[] {
    if (element instanceof BrowserProfileItem) {
      const { row } = element;
      const tabs: Node[] = row.tabs.map(t => new BrowserTabItem(row.name, row.port, t));
      return row.tabsHidden ? [...tabs, new MoreItem(row.tabsHidden)] : tabs;
    }
    if (element) return [];
    try {
      // Before the first look the profiles are listed with no state, so the view is never blank while it checks.
      if (!this.rows.length && !this.drawn) {
        const profiles = normaliseProfiles(readBrowserProfilesCached().profiles);
        return buildRows(profiles, new Map()).map(r => new BrowserProfileItem(r));
      }
      return this.rows.map(r => new BrowserProfileItem(r));
    } catch {
      return []; // an unreadable config is an empty view, never an error toast
    }
  }

  private async poll(force: boolean): Promise<void> {
    if (this.polling) { this.again = this.again || force; return; }
    this.polling = true;
    try {
      const cached = readBrowserProfilesCached();
      const profiles = normaliseProfiles(cached.profiles);
      const configChanged = cached.key !== this.seenConfig;
      this.seenConfig = cached.key;

      const probes = new Map<string, Probe>();
      await Promise.all(profiles.map(async p => { probes.set(p.name, await probeProfile(p.port)); }));

      // Up/held/down per profile, before the API refines it: a change here is what earns a fresh API read.
      const lightSig = profiles.map(p => {
        const pr = probes.get(p.name)!;
        return `${p.name}:${pr.up ? 'u' : pr.held ? 'h' : 'd'}`;
      }).join('|');
      const needFull = force || configChanged || lightSig !== this.lightSig || Date.now() - this.fullAt >= FULL_EVERY_MS;
      this.lightSig = lightSig;
      if (needFull && profiles.length) await this.readFull();

      const rows = buildRows(profiles, probes, this.full);
      const sig = JSON.stringify(rows);
      if (sig !== this.drawn) {
        this.rows = rows;
        this.drawn = sig;
        this._onDidChangeTreeData.fire(undefined);
      }
    } catch {
      /* a failed look leaves the last drawing in place */
    } finally {
      this.polling = false;
      if (this.again) {
        this.again = false;
        void this.poll(true);
      }
    }
  }

  /** The API's own listing: claims, leases and who holds a blocked port. A failure keeps the last read. */
  private async readFull(): Promise<void> {
    let res: BrowserResult;
    try { res = await this.call('list_browser_profiles'); } catch { return; }
    this.fullAt = Date.now();
    if (!res.success || !Array.isArray(res.profiles)) return;
    const next = new Map<string, FullRow>();
    for (const r of res.profiles) {
      if (r && typeof r === 'object' && typeof (r as FullRow).name === 'string') next.set((r as { name: string }).name.toLowerCase(), r as FullRow);
    }
    this.full = next;
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }
}
