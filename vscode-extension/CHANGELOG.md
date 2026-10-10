# Changelog

## Unreleased

- **Page previews on running apps.** Hover a running app to see a thumbnail of its page above the usual details. The thumbnail is the one PortPilot captured when the app started, read from the local run history; nothing leaves your machine. Turn this off with `portpilot.rowPreviews`.

## 3.4.0

- **Row state and who started it.** Each app shows its state, how long it has been in it and who started it: you, or a Claude Code session.
- **Crash alerts.** A crashed app reads `Crashed exit N`. The activity bar icon shows a crash count, and a new crash raises a toast with Restart and Logs. The status bar names the crashed app.
- **Ports name their app.** Active Ports shows the owning app where PortPilot knows it, with a ✦ on servers Claude Code started.
- **Running first.** Running and crashed apps sort to the top, and stopped apps fold into a `Stopped (N)` node. Turn this off with `portpilot.foldStoppedApps`.

## 3.1.0

- **Web portal from VS Code.** `portpilot.webPortal.enabled` runs the PortPilot browser UI from the editor: loopback-only, token-gated, with a `PP Portal` status-bar item.
- `portpilot.webPortal.stopAppsOnStop` also stops the dev servers the portal started.
