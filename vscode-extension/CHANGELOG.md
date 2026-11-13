# Changelog

## [4.2.6] - 2026-11-13

- The web portal's Stop on a browser profile waits for the browser to close, and Start reports a browser opened by hand on the profile's folder instead of timing out (shared with desktop 5.1.0).
- Stop works on a server PortPilot started before a relaunch.

## [4.2.5] - 2026-11-03

- Kill on a port held by two processes (an IPv4 and an IPv6 listener) now frees it: every holder is killed, where before the second one kept the port.
- The scanner no longer mistakes PortPilot's own server for an app (shared with desktop 5.0.1).

## [4.2.4] - 2026-11-02

- Marketplace page: the top image is now a short clip of hovering an app (a page preview, then Stop, Open in Browser and Favourite) in place of a still. No code changes.

## [4.2.3] - 2026-11-02

- Marketplace page: shorter README (History, Browsers and Commands sections trimmed), status bar example matches the demo, and the extension now ships its MIT LICENSE file. No code changes.

## [4.2.2] - 2026-11-02

- Marketplace page: every screenshot now shows the fictional demo apps instead of real project names, and the crash toast and image descriptions match. No code changes.

## [4.2.1] - 2026-11-01

- Marketplace page: new Tiles screenshot (wider and sharper, with the Apps and Active Ports lists under the tiles) and corrected image descriptions. No code changes.

## [4.2.0] - 2026-11-01

- New Tiles view at the top of the sidebar: your apps and dedicated browsers as small picture tiles. Running apps and ones that need attention come first, each with the page picture the desktop app captured; a running app with no picture of its own yet shows its last known one. Idle apps sit in a compact `Show N stopped` list. Browser profiles show the site icon the desktop app saved for them. Click an app tile to open it, click a running browser tile to bring its page to the front, hover for Start or Stop. Pictures come from PortPilot's local files only. Hide it with `portpilot.tilesView`; `portpilot.rowPreviews` off also turns the app pictures off.

- On a new install the sidebar opens with Tiles tall enough for six app tiles and with Apps, Browsers, Active Ports and History collapsed, since Tiles already shows the same information. Click a header to open one. VS Code keeps the layout you already have, so an existing install changes only if you right-click the PortPilot sidebar and choose Reset View Locations.

## [4.1.0] - 2026-10-31

- New opt-in Browser Previews view: a small picture of each chosen browser profile's front page, taken over the debug port (no desktop app needed). Right-click a profile in Browsers and choose Show Preview. Off by default, because a picture can show a signed-in page; stored in the machine-scoped setting `portpilot.browserPreviews`. Each profile is captured at most every 30 seconds, one at a time.

- Browsers is now the second section of the sidebar, right under Apps, instead of the last. VS Code keeps the order you already have; to apply it, right-click the PortPilot sidebar and choose Reset View Locations.

## [4.0.6] - 2026-10-17

- Wording is no longer Claude-only: crash toasts and tooltips say an AI assistant started an app, and the description and README lead with the product, not one assistant.
- An app started by another MCP assistant (for example Cursor) is now labelled with that assistant's own name instead of "claude".
- Removed the "tested in <profile>" line on History rows and the link that wrote it. Browser sessions and their tabs are still recorded.

## [4.0.5] - 2026-10-17

- Fixed apps showing as stopped, or with no page preview, when another app's name shares a word with their server path (for example `roofing-clone` taking `glancehawk-web`'s port because of the word "clone"). Exact port matching now runs before fuzzy name matching.

## [4.0.4] - 2026-10-17

- Marketplace page: new screenshots of the 4.0.3 build, now including the History and Browsers views. No code change.

## [4.0.3] - 2026-10-17

- Version bump to match the desktop app. The extension itself is unchanged.

## [4.0.2] - 2026-10-16

- Version bump to match the desktop app. The extension itself is unchanged.

## [4.0.1] - 2026-10-16

- Version bump to match the desktop app. The extension itself is unchanged.

## [4.0.0] - 2026-10-16

- Version bump to match the desktop app. The extension itself is unchanged.

## [3.9.1] - 2026-10-15

- A + in the Browsers view adds a browser profile, and Remove in the profile menu removes one.

## [3.9.0] - 2026-10-15

## [3.8.2] - 2026-10-14

## [3.8.1] - 2026-10-14

## [3.8.0] - 2026-10-13

- **Browsers view.** A new `Browsers` view under History lists your named browser profiles (the debug-port Brave, Chrome or Edge windows from the PortPilot app's Browsers tab, or started by Claude). Each row shows `:port · mode · browser` with a running, stopped or port-held icon. A running profile expands to its open tabs, and hovering shows its note, start URL, profile folder and who has it leased when a Claude session does.
- **Manage them from the sidebar.** Start, Stop, Set mode (headed, offscreen, headless), Open URL in this profile (http and https), Copy CDP URL and Copy port are on each row; clicking a tab brings it to the front. Stop will not end a browser PortPilot did not start, and says why. Errors come from PortPilot's own browser API as plain messages.
- **Quiet by design.** The view looks only while it is visible, every 10 seconds, at each profile's own debug port on `127.0.0.1`. It reads tab titles and URLs only, never page content, and re-reads the profile list only when the config changes.
- **History view.** A new `History` view under Apps lists past localhost pages from PortPilot's run history, newest first, grouped Today, Yesterday, then by day for a week, then a collapsed `Earlier`. Each row shows the app, start time and port, with an icon for running, stopped, crashed or ended-unseen. Hover for the page title, URL, git branch and commit, and the page thumbnail.
- **Reopen a past page.** Click a run to open it in your browser while its server is up. A closed run with a recorded folder and start command shows `Start Again`: PortPilot starts it in a terminal, waits for the port to answer, then opens the page. Rows also copy the URL, open the folder, and pin or unpin the run (pinned runs are never pruned).
- **Search.** The search icon in the History title bar filters by name, port, page title or branch.
- Servers PortPilot found without you registering them show a `detected` marker once the desktop app records them.

## 3.7.0

- **No more false "Running".** A browser, an editor or Claude holding a port is no longer shown as your app running just because its command line mentions the project (a Brave debug port read as "Solaisoft Running", Code.exe as "SSF Site").
- **Page previews on running apps.** Hover a running app to see a thumbnail of its page above the usual details. The thumbnail is the one PortPilot captured when the app started, read from the local run history; nothing leaves your machine. Turn this off with `portpilot.rowPreviews`.

## 3.4.0

- **Row state and who started it.** Each app shows its state, how long it has been in it and who started it: you, or a Claude Code session.
- **Crash alerts.** A crashed app reads `Crashed exit N`. The activity bar icon shows a crash count, and a new crash raises a toast with Restart and Logs. The status bar names the crashed app.
- **Ports name their app.** Active Ports shows the owning app where PortPilot knows it, with a ✦ on servers Claude Code started.
- **Running first.** Running and crashed apps sort to the top, and stopped apps fold into a `Stopped (N)` node. Turn this off with `portpilot.foldStoppedApps`.

## 3.1.0

- **Web portal from VS Code.** `portpilot.webPortal.enabled` runs the PortPilot browser UI from the editor: loopback-only, token-gated, with a `PP Portal` status-bar item.
- `portpilot.webPortal.stopAppsOnStop` also stops the dev servers the portal started.
