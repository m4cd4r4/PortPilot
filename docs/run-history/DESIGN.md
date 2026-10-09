# Run history + auto-register: design

**Approved by Macdara 2026-10-08: all five open-question recommendations accepted.**

Brief: [`docs/prompts/run-history.md`](../prompts/run-history.md). Design only; no feature code in this commit. Three PRs: **A** (observe and record unregistered starts), **B1** (run records, snapshot, pruning, `find_run`), **B2** (desktop History view, thumbnails, Re-run).

## Corrections to the brief (source files win)

1. **An unregistered start almost never has a certain port.** `targetPort` (`guard-core.mjs` L368) only knows a port for an unregistered directory when the command spells it (`--port`, `-p`, `PORT=`). A plain `npm run dev` there returns null, and `decide` passes at L400. Auto-register needs its own port rule (below), or it will rarely fire.
2. **`start.script` is not a runnable command.** `devStart` rewrites `npm run dev` as `npm dev` (L246) for comparison. The registered command must come from the raw start step, so `parseStart` gains a `raw` field.
3. **The mod cannot write the config safely.** `$.fs.write` is a plain write with no lock and no rename; `configFile.updateJson` is the only safe writer. Auto-register goes through the MCP `add_app` / `add_worktree` tools, as routing already goes through `start_app`. `add_app` refuses a duplicate name (index.js L736), so names need a collision rule.
4. **Thumbnails need the desktop app running.** MCP, web-agent and VS Code starts run in plain Node with no Electron, so `capturePage` is only available in the desktop process.
5. **Exit codes exist only for desktop-started apps.** MCP and VS Code starts are detached shells (`detachedCommand`, index.js L431); their exit code is never seen. A record's `exitCode` is null unless the desktop process owned the child or a crash stamp carried one.

## PR A: observe, don't take over

**Pivot, 2026-10-08 (Macdara).** The first design registered an unknown project and then rerouted Claude's start through `start_app` (bash -> a saved cmd.exe command, PORT injected, a per-directory claim, a 60 s "still starting" deny). Two review rounds kept finding new bugs in that take-over, so PR A now only watches.

**Second pivot, same day: Claude confirms.** Round 3 attributed a new port to Claude's start by walking the process tree. A live check in real Claude Code 2.1.291 (`-p`) failed: with `run_in_background` the Bash shell is spawned through an intermediate process that exits, so the server's parent chain never reaches `claude.exe` and nothing was recorded. Process-tree attribution on Windows is not reliable, so PortPilot stops guessing who started a server and asks Claude, who knows what it ran.

**The first start of an unregistered project runs exactly as Claude typed it.** The guard never denies, rewrites or reroutes it on this path. `decide()` is master's, plus one exception below.

### Mechanism (`plugin/hooks/observe.mjs`, wired in `register.tsx`)

1. **Note** (Bash hook, `decide()` passed): a certain start in a directory no app owns adds `{ dir, cwd, command, name, at }` to this session's `$.state` (`portpilot.observe`), where `command` is the start step as typed and `name` is the suggested app name (`package.json` name, else the folder, made unique). The ports listening at that moment become the baseline. At most 5 notes; a restart in one directory replaces its note. No shared files.
2. **Check** (after every tool call, and on the 15 s status tick, which covers `run_in_background`): only while a note is under 2 minutes old. The ports not listening at the last check, and not held by a *running* registered app (sidecar pid or sidecar start on that port; a `preferredPort` alone does not count), go into **one notice per check**, one line per holding process with its PID, process name (one `tasklist` per new port on Windows) and bind address. Several ports of one PID share a line; the lowest below 49152 is suggested as `preferredPort`, the rest are marked extra listeners of the same process. The notice tells Claude to register only a port it is confident its own start opened and to ignore ones held by processes it did not start, and suggests a cmd-safe command (`cmdSafe`: trailing redirections and `&` dropped, leading `VAR=value` moved to `env`). Each port is told once a session.
3. **Delivery:** notices queue in the session state, stamped with their time, and ride the next tool result as `context` (what a PostToolUse hook's `additionalContext` is): the model reads it, the user does not see it. A tick's notice waits for the next tool call; one older than 2 minutes is dropped, and opting out clears the queue.
4. **Claude attributes, PortPilot never registers on its own.** The `add_app` description tells Claude to use `registeredBy: 'observed'` for this; the plugin stamps `observedSession` with this session's id (Claude cannot see it).
5. **Idempotent by cwd:** `add_app` with `registeredBy: 'observed'` returns the existing app when one has that cwd (`appAtCwd`: case-insensitive on Windows and macOS, exact on Linux). A plain `add_app` of the same command in a directory an observed app already holds also returns it (live check: Claude re-registered without `registeredBy` once). Never a direct config write.

Never noted: uncertain or unparseable commands; one-shot tool runs (`next build`, `vite build`, `astro check`, `nuxi generate`, ...) even with a port flag; UNC or root paths; the home folder and its Desktop, Documents, Downloads; `settings.autoRegister === false` (Settings: "Record new projects Claude starts"), which also drops a note already taken.

### Observed apps in the guard

- **Deny path applies:** a second start on a busy port is denied with "reuse http://localhost:N", as for any app. For an observed app the deny also names the holder's process and PID and says how to fix a wrong registration (`update_app` / `delete_app`), so a port Claude mis-attributed does not deny every later start unexplained.
- **start_app refuses** an observed app whose command still has a shell redirection, a trailing `&` or a leading `VAR=` (cmd.exe would write `/tmp/x` as `<drive>:\tmp\x` or fail on `PORT=4000`); `add_app` saves observed commands in cmd-safe form, the assignments in `env`.
- **Dedupe:** `add_app` returns an existing app for the same directory (Git Bash `/i/x` = `I:/x` on Windows) when the call is observed, or when any app there has the same cmd-safe command.
- **Route path does not:** `decide()` skips the route when `app.registeredBy === 'observed'`, because `start_app` runs the command through cmd.exe with PORT set, which can behave differently from the bash Claude used. A free-port start passes as typed and is not noted again (the directory is owned now).

### Parser corrections kept from the review rounds

`npm run dev --port N` (npm keeps a flag before `--`) is uncertain; `-p N` is a port only for the tools that take it (Next, Nuxt, http-server, serve, flask, or a forwarded script); `npm dev/serve/preview` start nothing; `parseStart` returns `raw`; the noted cwd has an upper-case drive letter.

### Tests

`tests/plugin-mod.test.mjs` (in `test:unit`, CI) drives the real `decide` / `noteStart` / `checkNotices` with fake scans: untouched first start; the notice names port, directory, command; one notice per port; no notice without a recent unregistered start (none, expired, already listening); none for a registered app's port; build and uncertain commands; observed app busy -> reuse deny, free -> pass, managed -> still routes; opt-out; paths; two notes named in one notice. `tests/mcp-worktree.test.mjs` covers `appAtCwd` and `observedDuplicate`. `plugin/hooks/register.test.ts` (`claude plugin test plugin`, local) runs the wiring in the engine: the notice reaches the result's `context` once, and an observed `add_app` gets this session's id.

### Known limits

- **Flapping port:** a port told once and then gone and back is not told again in that session (`noticed`), so a server that restarts on another port is told, one that restarts on the same port after a wrong attribution is not.
- **Start shapes:** only the starts `parseStart` reads as certain are noted; a start after another step (`npm install && npm run dev`), from a script file, or through a task runner is never noted.
- **No suspect check by process age:** the plugin's scan has no process start time, so an observed app registered on a port held by a process older than `observedAt` is not flagged on its own; the observed-app deny names the holder so Claude can see it.

## PR B1: run records

New module `src/core/runHistory.js`, zero dependencies, loaded by the desktop app, web agent and MCP server (and by VS Code through `copy-runtime.js` at its next build; no extension code changes beyond one line in `copy-runtime.js` listing `core/runHistory.js`). It ships as `runHistory.cjs` beside `configFile.cjs` (desktop `extraResources`, `build-plugin.mjs`, `copy-runtime.js`). Opt-outs: per repo with `git config portpilot.snapshots false`, globally with `settings.historySnapshots = false`. Caps are `settings.historyMaxRuns` (500) and `settings.historyMaxMB` (150); pinned runs count toward the run cap, at most 50 pins.

### Where it hooks in

`recordStart`, `recordStop` and `recordCrash` in `configFile.js` are already the single choke point every surface calls. Each gets one best-effort call: `openRun` (after a start succeeds), `closeRun(appId, {endedBy: 'stop'})`, `closeRun(appId, {endedBy: 'crash', exitCode})`. `openRun` writes the record synchronously, then captures git state asynchronously and patches the record, so a start never waits on git. Opening a run closes any earlier open run of the same app as `endedBy: 'unknown'`.

### Storage

```
<configDir>/history/
  runs.json          { v: 1, runs: [ ...newest last ] }   via updateJson (lock + atomic rename)
  thumbs/<runId>.jpg
```

Local only; nothing is sent anywhere. The git snapshot lives in the project's own repo (below), not under configDir.

### Record schema

```json
{
  "id": "r_20261005T011204_7f3a",
  "appId": "mjx2k1", "appName": "shop-web",
  "cwd": "I:/Scratch/shop/apps/web", "repoRoot": "I:/Scratch/shop", "relCwd": "apps/web",
  "command": "npm run dev -- --port 3005", "port": 3005, "url": "http://localhost:3005/",
  "startedBy": { "kind": "claude", "surface": "mcp", "sessionId": "b71c...", "at": "2026-10-05T01:12:04.118Z" },
  "startedAt": "2026-10-05T01:12:04.118Z", "stoppedAt": "2026-10-05T03:40:51.002Z",
  "endedBy": "stop", "exitCode": null,
  "git": {
    "branch": "feat/checkout", "sha": "9c41e0a...", "subject": "wip: checkout layout",
    "dirty": true, "files": ["src/pages/checkout.tsx", "public/mock/checkout-v2.html"],
    "snapshot": { "ref": "refs/portpilot/runs/r_20261005T011204_7f3a", "commit": "e02bd71...", "bytes": 48213 },
    "skipped": null
  },
  "page": { "title": "Checkout - Shop", "thumb": "thumbs/r_20261005T011204_7f3a.jpg" },
  "pinned": false
}
```

`git` is null outside a repo, and also for a run whose process exited before the async git patch landed (known limit). `skipped` is `"not-a-repo" | "too-large" | "git-missing" | "timeout" | "unborn-head" | "opted-out" | "error"` (the last three were added in B1). `files` is capped at 50 names, because file names are what free-text search most often hits ("checkout").

### Dirty-tree snapshot: temporary-index commit + ref (chosen)

```
GIT_INDEX_FILE=<tmp copy of $(git rev-parse --git-path index)>
git add -A                       # tracked + untracked, .gitignore respected
tree=$(git write-tree)
commit=$(git commit-tree $tree -p HEAD -m "portpilot run <id>")
git update-ref refs/portpilot/runs/<id> $commit
```

The real index and working tree are never touched. Compared with the alternatives:

| | `git stash create` + `update-ref` | patch file under configDir | temp-index commit + ref |
|---|---|---|---|
| Untracked files (new mockups) | **missed** (`stash create` has no `-u`) | needs `add -N`, which mutates the index | included |
| Binary files (images) | yes | only with `--binary` | yes |
| Restore | `stash apply`, can conflict | `git apply`, can fail on drift | `worktree add <commit>`: exact tree, cannot conflict |
| Storage | repo, deduplicated | configDir, full copy each run | repo, deduplicated |
| Survives repo deletion | no | yes | no |

Untracked capture decides it: the brief's core case is an uncommitted mockup, which is usually a new file. Guards: skip with `too-large` if untracked files total over 20 MB (`git ls-files -o --exclude-standard` sizes, checked before `add -A`); 10 s timeout on the whole capture; skip when HEAD is unborn. A clean tree stores no snapshot (`sha` alone reproduces it). The ref keeps the commit from `git gc`; refs under `refs/portpilot/` do not show in branch lists and are not fetched or pushed by default (`push --mirror` would push them: open question 3).

### Retention and pruning

Caps: **500 runs** and **150 MB** (`runs.json` plus `thumbs/`). Both settings. Pruning runs inside the same `updateJson` that appends: drop the oldest unpinned runs until both caps hold, delete their thumbs, then (outside the lock, best-effort, one `git update-ref --stdin` per repo started after the start returns) delete each dropped ref where `repoRoot` still exists. The 20 MB snapshot guard counts every dirty path, tracked or not. **Moved to B2:** the weekly sweep that removes orphan thumbs and refs whose run is gone (refs leak today only if the process dies between `update-ref` and the record patch, or `runs.json` is lost). Pinned runs never prune; at most 50 pins.

### MCP tool: `find_run` (tool 20)

```
find_run({
  query?: string,      // free text: app name, branch, page title, file names, command, commit subject, sha prefix
  app?: string,        // id or name
  branch?: string,
  since?: string,      // ISO date/time; Claude resolves "Monday" to a date in the user's zone
  until?: string,
  dirty_only?: boolean,
  limit?: number       // default 5, max 20
}) -> { count, runs: [ record + { running: boolean, rerun: { steps: string[] } } ] }
```

Ranked newest first after filtering; `query` matches case-insensitively across the listed fields. `rerun.steps` are the literal commands (worktree add, install, start) so Claude can do it with existing tools or ask the user to press Re-run. A `rerun_run` tool is deferred (open question 4).

## PR B2: desktop History view, thumbnails, Re-run

### Thumbnail capture

Desktop main process only. When a run is open and `page.thumb` is null, poll `healthCheck.probe(port)` every 2 s for 60 s; on the first `healthy`, open an offscreen `BrowserWindow` (`show: false`, `webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false, partition: 'portpilot-thumbs' }`, 1280x800, audio muted). `loadURL(url)`, wait for `did-finish-load` plus 1.5 s, `capturePage()`, `resize({ width: 480 })`, `toJPEG(70)` (about 30-60 KB), read `document.title`, close. Navigation off `localhost`/`127.0.0.1` is blocked; 15 s hard timeout. Runs started while the desktop app is closed get a thumb if the app opens while they are still up; otherwise the card shows a placeholder. No new dependency.

### History view (new sidebar tab "History")

```
+--------------------------------------------------------------------------------+
| History                                   [ search: checkout            ] [x] |
| App [All v]  Branch [All v]  From [2026-10-01]  To [2026-10-08]  [ ] Dirty only |
+--------------------------------------------------------------------------------+
| +----------+  shop-web  :3005                     Mon 5 Oct, 09:12 - 11:40     |
| |  thumb   |  Checkout - Shop                     feat/checkout @ 9c41e0a +2   |
| |  480x300 |  claude b71c · stopped                                             |
| +----------+  [Open URL] [Re-run this version] [Copy SHA] [Pin]                |
|--------------------------------------------------------------------------------|
| +----------+  mockups  :8000                      Sun 4 Oct, 21:03 - 21:30     |
| | (no img) |  Directory listing for /             no git                        |
| +----------+  you · crashed, exit 1   [Re-run this version] [Pin]               |
+--------------------------------------------------------------------------------+
| 312 runs · 41 MB of 150 MB                                                     |
+--------------------------------------------------------------------------------+
```

`+2` is the dirty-file count. Open URL is enabled only while that run's app is running on that port. Compact rows (data-dense), state words from `rowStateOf`.

### "Re-run this version"

1. Path: `<repoParent>/<repo>-run-<shortId>` (sibling, matching the existing worktree convention). Refuse if the repo is gone or the ref was pruned (say which).
2. `git worktree add --detach <path> <snapshot.commit || sha>`, then `git -C <path> reset --mixed <sha>` when a snapshot exists, so the captured changes show as uncommitted against the original commit, exactly as they were.
3. Dependencies: if `relCwd` has `package.json`, run the lockfile's install (`npm ci`, `pnpm i --frozen-lockfile`, `yarn --immutable`, `bun i`) with progress in the row (open question 2).
4. Register through the `add_worktree` logic (nested under the app, branch label `run <date>`), on a free port from the existing reserver; a `--port N` in the command is rewritten to the new port, otherwise `PORT` is set.
5. Start through the normal path, which opens a new run record with `rerunOf: <id>`.

Clean-up is the existing delete-app flow plus `git worktree remove`.

## PROJECT-PLAN overlap and proposed rows

- **#12 drawer-timeline (A10)**: the run records are the timeline's start/stop/crash events. #12 should read `history/runs.json` rather than add a second store; the A5 drawer gains "Recent runs" for one app.
- **#11 command-palette-pane**: palette entries "Find run" and "Re-run last version"; the `/ports` pane can list today's runs. No dependency either way.
- **#17 vscode-ports-view**: a History node in the VS Code view is a follow-up row, not part of B.

Proposed rows (Wave 4, after the Wave 3 gate):

| # | Slug | Scope | Wave | Effort |
|---|------|-------|------|--------|
| 19 | guard-auto-register | PR A: observe-and-record (`observe.mjs`), `add_app` `registeredBy: observed`, `parseStart.raw`, `settings.autoRegister`, tests | 4 | S-M |
| 20 | run-history-core | PR B1: `runHistory.js`, hooks in record*, snapshot, pruning, `find_run`, tests | 4 | M |
| 21 | run-history-view | PR B2: History tab, offscreen thumbnails, Re-run, demo-seed runs + screenshots | 4 | M-L |
| 22 | vscode-run-history | History node in the VS Code view (after #17) | 5 | S |

Order: #19 and #20 are independent (guard vs core) and can run in parallel; #21 after #20. #12 rebases onto #20.

## Open questions for Macdara

1. **Framework-default ports**: should `npm run dev` with a bare `vite`/`next dev` script auto-register? *Recommended: no in PR A. Pass untouched; revisit with a "learn the port after it binds" follow-up, which keeps the never-guess guarantee.*
2. **Re-run dependencies**: install fresh in the new worktree, or junction `node_modules` from the original checkout? *Recommended: fresh install. A junction breaks Turbopack and risks the recursive-delete trap; a lockfile install is slower but always correct.*
3. **Snapshot refs in the project repo**: acceptable to write `refs/portpilot/runs/*` into each repo? **Answered 2026-10-08: yes, with a per-repo opt-out.** *Recommended: yes. They are invisible to branches and normal push/fetch, deduplicate, and restore without conflicts. A per-repo opt-out falls back to "no snapshot".*
4. **A `rerun_run` MCP tool** in B1, or only `find_run` with steps? **Answered 2026-10-08: `find_run` only; it returns the literal `rerun.steps` (plus a `rerun.note`), and `running` means the run is open AND its port is listening.** *Recommended: `find_run` only for now. Re-run creates a worktree and installs packages, which the user should trigger from the desktop until the flow has been used.*
5. **Retention caps**: 500 runs / 150 MB with pinning? **Answered 2026-10-08: yes; max 50 pins; caps editable in Settings.** *Recommended: yes, both editable in Settings.*

## Open items

- **Follow-up: promote an observed app to managed.** A user action (desktop row menu, or an MCP `update_app` flag) that clears `registeredBy: observed` after checking the saved command runs the same under `start_app` (cmd.exe, PORT set). Until then observed apps are guarded but never routed.
- **Follow-up: a `&` start inside a foreground Bash call** detaches from its bash, which exits; on Windows the listener's parent chain then no longer reaches the Claude process, so the start is not recorded. `run_in_background` keeps the chain and is recorded.
