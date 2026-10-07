# PortPilot for VS Code

**Every dev server and port in your sidebar, with crash alerts and the servers Claude Code started marked.**

PortPilot lists your registered apps and every listening port in the VS Code sidebar. Running apps come first, crashes get a badge and a toast, and a ✦ marks anything a Claude Code session started. It shares one config with the [PortPilot desktop app](https://github.com/m4cd4r4/PortPilot) and its MCP server, so the editor, the desktop app and Claude all see the same state.

![PortPilot sidebar in VS Code: apps grouped with running first, two crashed apps, the badge on the activity bar and a crash toast](https://raw.githubusercontent.com/m4cd4r4/PortPilot/master/docs/screenshots/vscode-overview.png)

## What's in the sidebar

**Apps, running first.** Each app shows its port, its state, how long it has been in that state and who started it: you, or a Claude Code session. Stopped apps fold into a collapsed `Stopped (N)` node at the end of each group, so the running ones stay on screen. Worktree branches sit under their app.

<img src="https://raw.githubusercontent.com/m4cd4r4/PortPilot/master/docs/screenshots/vscode-apps.png" alt="Apps view with running apps first, a crashed app and stopped apps folded" width="420">

**Ports that name their app.** Active Ports shows the app that owns each port where PortPilot knows it, and the process and PID where it does not. A ✦ marks a server Claude Code started.

<img src="https://raw.githubusercontent.com/m4cd4r4/PortPilot/master/docs/screenshots/vscode-ports.png" alt="Active Ports listing app names, with a star on the ports Claude Code started" width="420">

**Crash alerts.** When an app crashes, the PortPilot icon gets a count badge and a toast says which app crashed, its exit code and whether Claude Code started it. Restart brings it back; Logs opens its output with the stderr tail. A crash from before the window opened shows in the badge without a toast. The status bar switches from `PP: 6 running` to `PP: anchor-jobs crashed`.

<img src="https://raw.githubusercontent.com/m4cd4r4/PortPilot/master/docs/screenshots/vscode-crash-toast.png" alt="Crash toast: beacon-gateway crashed (exit 1). Claude Code started it. With Restart and Logs buttons" width="560">

**Everything else from the tree.** Start and stop apps, kill a port, open in the browser, change a port, toggle favourites, and add, edit or delete apps. Running detection is two-phase: an app on a dynamic or non-preferred port is still found, with its live port shown.

## Web portal, hosted from VS Code

Turn on `portpilot.webPortal.enabled` and PortPilot runs its full browser UI from VS Code, with no desktop app needed. A `PP Portal` item appears in the status bar; click it to open `http://127.0.0.1:<port>/`.

The portal binds `127.0.0.1` only and needs a per-session token. It runs on the editor's own Node, shuts down cleanly on Windows, and exits if the editor closes. Threat model: [SECURITY.md](https://github.com/m4cd4r4/PortPilot/blob/master/SECURITY.md).

## Use it with Claude Code

The ✦ marks and the "Claude Code started it" line come from the PortPilot plugin for Claude Code. It gives Claude the same view: a status line, a guard that reuses a running server instead of starting a second copy, and a crash band with Fix it.

```text
/plugin marketplace add m4cd4r4/PortPilot
/plugin install portpilot@portpilot
```

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `portpilot.foldStoppedApps` | `true` | Sort running and crashed apps first and fold stopped apps into a `Stopped (N)` node. |
| `portpilot.webPortal.enabled` | `false` | Run the web portal whenever this window is open. |
| `portpilot.webPortal.stopAppsOnStop` | `false` | Also stop the dev servers the portal started when it stops. |

## Commands

Start, stop and open the web portal; fold or unfold stopped apps; add, edit and delete apps; change ports, kill ports and scan ports. All are in the Command Palette under `PortPilot:` and on the sidebar.

## Links

- [GitHub repository](https://github.com/m4cd4r4/PortPilot)
- [Desktop app downloads](https://github.com/m4cd4r4/PortPilot/releases/latest)
- [Website](https://m4cd4r4.github.io/PortPilot/)

MIT licensed.
