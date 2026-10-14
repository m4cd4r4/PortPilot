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

Never launch a browser with a debug port yourself, and never pick a port for one. The user
sets up profiles in PortPilot, each with what it is for (`purpose`) and the sites it logs into
(`sites`), and the start of the conversation lists them. Match by site first: for a task on a
site, call `start_browser` with `for` set to the site, URL or task ("google search console",
"https://search.google.com/..."). PortPilot picks the profile; you never pick a port or a
profile yourself. It returns `cdpUrl`; connect your automation there. If the answer is
`NO_MATCH`, tell the user no profile is set up for that site and ask them to create or label
one in the PortPilot Browsers tab; do not invent a port, launch a browser yourself or fall
back to `any`. If it is `AMBIGUOUS`, ask the user which profile. When the user names a profile
("use the PortPilot port for Facebook"), `start_browser` with `name`, or `for` with their words;
`list_browser_profiles` (optionally with `for`) shows the profiles, their purpose and their
state. `name: "any"` is only for a throwaway browser with no logins, never for a task tied to a
site (you get the one you already hold first). If a profile shows `leasedTo` another session,
do not use it: `start_browser` answers `IN_USE`; pick another profile that suits the task. Pass
`takeover:true` only after telling the user that you are taking a profile another session is using.
A headed profile may have a saved window and keep in front: the start result's `window.actual` is
where the window really is, and `window.front.topmost` is Windows-only best effort. If the port is held by another
process the error names it: tell the user, do not kill it. Stop with `stop_browser` only a
browser you started. `set_browser_mode` changes how a profile opens next time.
`browser_history` lists what a profile had open in past sessions.

## Destructive tools need the user's say-so in this conversation

`kill_port`, `delete_app` and `delete_all_apps` end processes or remove the user's
registry entries. Run them only when the user has asked for that exact action. A
taken port is a reason to ask, never a reason to kill.

## When PortPilot cannot help

If the MCP tools are unavailable, say so and give the user the command to run
themselves. Do not fall back to starting the server in the background.
