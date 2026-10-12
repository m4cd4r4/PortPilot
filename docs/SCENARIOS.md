# Scenarios

Recurring checks for PortPilot. Each is a situation, a check made from outside the code, and what a pass looks like.

**Automated** rows run with `npm run test:e2e` (real Electron, a throwaway config and OS-picked free ports; never your real PortPilot or ports 9222-9240). **Manual** rows need something a script cannot hold: a signed-in extension install, a second machine, a published build.

Unit checks (`npm run test:unit`, `npm run test:mcp`) cover the logic; these scenarios cover what a person sees.

## Desktop app

| Situation | Check from outside | Pass looks like | Run by |
|---|---|---|---|
| An app is stopped, then started from its row | Read the row's state cell before and after clicking Start | `Stopped`, then `Running` with an uptime and `you` | `tests/desktop-apps.e2e.js` |
| Claude started an app (MCP stamps the runtime sidecar) | Reload the list after a `claude` / `mcp` start is recorded for the live pid | The state cell reads `claude a3f2`, the short session id | `desktop-apps.e2e.js` |
| A running app has served a page | Wait for the row after the first thumbnail capture | One 32 x 18 preview on the running row, none on stopped rows | `desktop-apps.e2e.js` |
| A stranger process holds an app's port | Start a node server on the port, rescan | `Port blocked` row, a strip naming `:port`, the holder and its PID, and the actions Use free port, Kill & start, Show process in that order | `desktop-apps.e2e.js` |
| You press Kill & start | Click twice (the first only arms it), check the stranger's pid | The stranger is gone and the app is `Running` on its own port | `desktop-apps.e2e.js` |
| An app exits non-zero seconds after starting | Watch for the toast, then the row | A sticky toast: `<app> crashed`, `:port · exit N`, the last output lines, Restart / Logs / Ask Claude / Dismiss; the row later reads `Crashed exit N` | `desktop-apps.e2e.js` |
| A Claude session is live when an app crashes | Seed `sessions/<id>.json`, click Ask Claude | Button reads `Sent to <short>` and `inbox/<id>.json` holds a request for that app | `desktop-apps.e2e.js` |
| You open Logs or Restart from the toast | Click each | Logs opens for the crashed app; Restart closes the toast and starts the app | `desktop-apps.e2e.js` |
| A past run had git state | History tab, Re-run this version | A new run for that app, marked `re-run`, on a free port in a new worktree | `desktop-apps.e2e.js` |
| History has stopped, crashed and no-git runs | Open the History tab, filter, pin | Rows labelled by state, crashed run pinned, no-git run cannot be re-run or copied | `tests/history-ui.e2e.js` |

## Browsers tab

| Situation | Check from outside | Pass looks like | Run by |
|---|---|---|---|
| Three saved profiles | Open the tab | `0 running · 3 stopped`, Apps and History hidden | `tests/browsers-ui.e2e.js` |
| Start a profile | Click Start, then ask its debug port for `/json/version` | Real Brave answers; the row says Running and `In use by PortPilot desktop`, sorts first, and cannot be duplicated or removed | `browsers-ui.e2e.js` |
| Extensions dialog | Open it on a profile with an extension on disk | The extension's name and version are listed | `browsers-ui.e2e.js` |
| Duplicate a signed-in profile | Duplicate, then look at the new folder | Settings and extensions copied; `Cookies` not copied; the source keeps its own | `browsers-ui.e2e.js` |
| Add with a name that exists (any case) | Submit the dialog | A plain `already exists` error; the dialog stays open | `browsers-ui.e2e.js` |
| A profile's port is changed to one a stranger holds | Edit the port, read the row | `Port held`, `:port is held by <process> (PID n)`; the stranger is not touched | `browsers-ui.e2e.js` |
| Stop a running profile | Click Stop, then ask the port again | The port stops answering | `browsers-ui.e2e.js` |
| Remove a stopped profile | Remove, confirm | The row goes; its folder stays on disk | `browsers-ui.e2e.js` |
| Duplicate a profile that holds a saved password | Duplicate in a real, signed-in install | The new profile asks for the password-manager sign-in once; no password was copied | Manual: needs a Web Store install |

## Not yet automated

| Situation | Pass looks like | Why not yet |
|---|---|---|
| The plugin in a real `claude` session starts an app | `start_app` shows `claude <id>` in the desktop row | Needs `claude` in a pty (next phase) |
| The VS Code view lists running first, ports name their app, crashes alert | Matches the desktop rows | Needs an Extension Development Host with a throwaway `--user-data-dir` (next phase) |
| The web portal shows the same states | Same words and glyphs as the desktop | Plan row 24 (portal has no History or crash toast yet) |

## Running them

```
npm run test:e2e            # all three, about 2 minutes
node tests/browsers-ui.e2e.js   # one; skips without Brave
```

Re-run needs the MCP server's dependencies: `npm ci --prefix mcp-server` once per checkout. In a git worktree with a junctioned `node_modules`, run the specs from the worktree; Electron comes from the junction.
