# Follow-ups

Captured, not built. Each came up while building something else.

- **Share one run filter.** `filterRuns` in `src/core/runView.js` mirrors `findRuns` in `mcp-server/index.js`. They must stay in step by hand; move both onto one shared module when the MCP server can import from `src/core` (found in PR B2, run-history-view).
- **Loopback probing.** `healthCheck.probe` and thumbnail capture use `127.0.0.1` only; a server bound to `::1` (Vite on recent Node on Windows is the likely case) would never show as live or get a thumbnail. Confirm with a default Vite app, then probe `localhost` too.
- **Port rewrite limits.** A `-p`/`--port` hidden inside a package.json script, or two different `--port` flags in one command (`concurrently`), is not rewritten; the PORT env var is all Re-run sets. Consider probing the new port after start and warning when nothing answers there.
- **History view cost.** The 4 s poll sends the whole runs array over IPC and parses `runs.json` two or three times per call; `load()` has no in-flight guard, `h.thumbs` never evicts, and rewriting the list's `innerHTML` on each progress event can drop focus. Diff the rows, or send only changes.
- **Thumbnail frames.** The capture window guards the main frame only (`will-navigate`, `will-redirect`); add `will-frame-navigate` if the page's iframes ever matter. The window is sandboxed with no preload and a separate partition.
- **MCP `rerunSteps` lacks the yarn-berry `--immutable` branch** the desktop install uses (`mcp-server/index.js`, `src/core/rerun.js`).
- **Stop leaves the server running on Linux.** `processManager.killProcess` runs `kill -9 <pid>` on the shell wrapper only, so the node child can keep its port after Stop (Windows uses `taskkill /T`). Found when CI's Re-run test hit EADDRINUSE on ubuntu. Kill the process group.
- **History in the VS Code view** is plan row #22.
- **Re-run clean-up.** Deleting a re-run app does not run `git worktree remove` for its sibling worktree yet (found in PR B2).
