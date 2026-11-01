import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { readConfig, readRuntimeApps, readRowThumbs, readLastAppThumbs, thumbDataUri, browserArtStamp, browserArtDataUri } from './config';
import { AppsTreeProvider, AppTreeItem, appRowState } from './appsTreeProvider';
import { BrowsersTreeProvider, BrowserProfileItem, BrowserTabItem } from './browsersTreeProvider';
import { pickPreviewTab } from './browserCapture';
import { AppInput, ImageSync, TilesState, buildAppTiles, buildBrowserTiles, imageKeys, thumbOf } from './tilesModel';
import { tilesHtml } from './tilesHtml';

export const TILES_SETTING = 'tilesView';

type FromWebview =
  | { type: 'ready' }
  | { type: 'app'; action: 'open' | 'start' | 'stop'; id: string }
  | { type: 'browser'; action: 'focus' | 'start' | 'stop'; name: string };

/**
 * The Tiles view: localhost apps as small tiles (a page picture each, from the run history the
 * desktop writes), then one tile per dedicated browser profile (its cached brand art). It reads the
 * same data as the Apps and Browsers trees, which stay below it for the keyboard and right-click menus.
 * Pictures are read from local files and handed to the webview as data URIs; nothing is fetched,
 * written or sent anywhere.
 */
export class TilesView implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewId = 'portpilot.tiles';

  private view: vscode.WebviewView | undefined;
  private readonly sync = new ImageSync();
  private subs: vscode.Disposable[] = [];
  private drawn = '';
  private state: TilesState = { apps: [], stoppedApps: [], browsers: [] };

  constructor(private readonly apps: AppsTreeProvider, private readonly browsers: BrowsersTreeProvider) {
    this.subs.push(
      this.apps.onDidChangeTreeData(() => this.post()),
      this.browsers.onDidChangeRows(() => this.post()),
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('portpilot.rowPreviews')) this.post();
      }),
    );
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = tilesHtml(crypto.randomBytes(16).toString('base64'));
    view.onDidDispose(() => { this.view = undefined; this.browsers.setTiling(false); });
    view.onDidChangeVisibility(() => this.visibilityChanged());
    view.webview.onDidReceiveMessage((m: FromWebview) => void this.onMessage(m));
    this.visibilityChanged();
  }

  private visibilityChanged(): void {
    const on = !!this.view?.visible;
    this.browsers.setTiling(on);
    if (on) this.post(true);
  }

  /** Everything the tiles show, from the same sources as the trees. */
  private compute(): TilesState {
    const config = readConfig();
    const runtime = readRuntimeApps();
    const running = this.apps.getRunningByAppId();
    const pictures = this.apps.rowPreviews;
    const thumbs = pictures ? readRowThumbs() : {};
    const lastThumbs = pictures ? readLastAppThumbs() : {};
    const inputs: AppInput[] = config.apps.map(a => {
      const active = running.get(a.id);
      const row = appRowState(active, runtime[a.id]);
      return {
        id: a.id,
        name: a.name,
        port: active?.port ?? a.preferredPort ?? null,
        state: row.state,
        word: row.word,
        favorite: !!a.isFavorite,
        branch: a.branch || null,
        // A running app with no capture of its own yet shows its last known screenshot.
        thumb: active ? thumbOf(thumbs, a.id, !!runtime[a.id], active.port) ?? lastThumbs[a.id]?.thumb ?? null : null,
      };
    });
    const { live, stopped } = buildAppTiles(inputs, pictures);
    return { apps: live, stoppedApps: stopped, browsers: buildBrowserTiles(this.browsers.getRows(), browserArtStamp) };
  }

  /** The bytes behind a picture key, or null when the file is gone. */
  private load(key: string): string | null {
    if (key.startsWith('run:')) return thumbDataUri(key.slice(4));
    const m = /^art:(.+)@\d+$/.exec(key);
    return m ? browserArtDataUri(m[1]) : null;
  }

  private post(force = false): void {
    if (!this.view?.visible) return;
    try {
      this.state = this.compute();
      const sig = JSON.stringify(this.state);
      const images: Record<string, string> = {};
      for (const key of this.sync.pending(imageKeys(this.state))) {
        const uri = this.load(key);
        if (uri) images[key] = uri; else this.sync.failed(key);
      }
      if (!force && sig === this.drawn && !Object.keys(images).length) return;
      this.drawn = sig;
      void this.view.webview.postMessage({ type: 'state', state: this.state, images });
    } catch {
      /* an unreadable config leaves the last drawing in place */
    }
  }

  private async onMessage(m: FromWebview): Promise<void> {
    if (m.type === 'ready') { this.sync.reset(); this.drawn = ''; this.post(true); return; }
    if (m.type === 'app') {
      // The id comes from the page; only act on an app in the config.
      const app = readConfig().apps.find(a => a.id === (typeof m.id === 'string' ? m.id : ''));
      if (!app) return;
      const active = this.apps.getRunningByAppId().get(app.id);
      if (m.action === 'open') {
        const port = active?.port ?? app.preferredPort;
        if (active && port) await vscode.env.openExternal(vscode.Uri.parse(`http://localhost:${port}`));
      } else if (m.action === 'start' && !active) {
        await vscode.commands.executeCommand('portpilot.startApp', new AppTreeItem(app, undefined));
      } else if (m.action === 'stop' && active) {
        await vscode.commands.executeCommand('portpilot.stopApp', new AppTreeItem(app, active));
      }
      return;
    }
    if (m.type === 'browser') {
      // The name comes from the page; only act on a profile that is in the Browsers list.
      const row = this.browsers.getRow(typeof m.name === 'string' ? m.name : '');
      if (!row) return;
      if (m.action === 'start') await vscode.commands.executeCommand('portpilot.startBrowser', new BrowserProfileItem(row));
      else if (m.action === 'stop') await vscode.commands.executeCommand('portpilot.stopBrowser', new BrowserProfileItem(row));
      else if (m.action === 'focus') {
        const tab = pickPreviewTab(row.tabs);
        if (tab) await vscode.commands.executeCommand('portpilot.focusBrowserTab', new BrowserTabItem(row.name, row.port, tab));
      }
    }
  }

  dispose(): void {
    this.subs.forEach(s => s.dispose());
  }
}
