---
name: portpilot
description: Start, stop and check local dev servers through PortPilot instead of bare shell commands. Use whenever you are about to run a dev server (npm run dev, next dev, vite, uvicorn, flask run, python -m http.server), free a port, or find out what is listening on a port.
---

# PortPilot

PortPilot keeps a registry of the user's local apps and the ports they run on. The
desktop app, the VS Code extension and this plugin's MCP server all read the same
registry, so an app started here shows up in the user's PortPilot window, tagged as
started by Claude.

## Never start a dev server with bare Bash

A server started with `npm run dev &` is invisible to the user, holds its port after
the session ends, and collides with the one they already have open. Use the
`portpilot` MCP tools instead.

1. **Check first.** `list_running`, or `check_port` with the port you expect. If the
   app is already running, reuse it: tell the user the URL and stop there.
2. **Registered app:** `start_app` with its name. Find the name with `list_apps`.
3. **Not registered:** `add_app` with the name, the project path, the start command
   and the port, then `start_app`. For a git worktree of a registered project, use
   `add_worktree` so it nests under its parent.
4. **Port taken by something else:** `check_port` names the holder. Tell the user what
   holds it and offer a free port. Do not kill it on your own.
5. **Stopping:** `stop_app` for an app you started. Stop an app the user started only
   when they ask.

## Browsers for automation

Never launch a browser with a debug port yourself, and never pick a port for one. Ask for a
named profile: `list_browser_profiles` (names, state, who is using each), then
`start_browser` with the name. It returns `cdpUrl`; connect your automation there. If a
profile is claimed by someone else you may still use it; leave their tabs alone. If the
port is held by another process the error names it: tell the user, do not kill it. Stop
with `stop_browser` only a browser you started. `set_browser_mode` changes how a profile
opens next time.

## Destructive tools need the user's say-so in this conversation

`kill_port`, `delete_app` and `delete_all_apps` end processes or remove the user's
registry entries. Run them only when the user has asked for that exact action. A
taken port is a reason to ask, never a reason to kill.

## When PortPilot cannot help

If the MCP tools are unavailable, say so and give the user the command to run
themselves. Do not fall back to starting the server in the background.
