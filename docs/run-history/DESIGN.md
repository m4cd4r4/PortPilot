# Run history + auto-register: design

**Approved by Macdara 2026-10-08: all five open-question recommendations accepted.**

Brief: [`docs/prompts/run-history.md`](../prompts/run-history.md). Design only; no feature code in this commit. Three PRs: **A** (auto-register in the guard), **B1** (run records, snapshot, pruning, `find_run`), **B2** (desktop History view, thumbnails, Re-run).

## Corrections to the brief (source files win)

1. **An unregistered start almost never has a certain port.** `targetPort` (`guard-core.mjs` L368) only knows a port for an unregistered directory when the command spells it (`--port`, `-p`, `PORT=`). A plain `npm run dev` there returns null, and `decide` passes at L400. Auto-register needs its own port rule (below), or it will rarely fire.
2. **`start.script` is not a runnable command.** `devStart` rewrites `npm run dev` as `npm dev` (L246) for comparison. The registered command must come from the raw start step, so `parseStart` gains a `raw` field.
3. **The mod cannot write the config safely.** `$.fs.write` is a plain write with no lock and no rename; `configFile.updateJson` is the only safe writer. Auto-register goes through the MCP `add_app` / `add_worktree` tools, as routing already goes through `start_app`. `add_app` refuses a duplicate name (index.js L736), so names need a collision rule.
4. **Thumbnails need the desktop app running.** MCP, web-agent and VS Code starts run in plain Node with no Electron, so `capturePage` is only available in the desktop process.
5. **Exit codes exist only for desktop-started apps.** MCP and VS Code starts are detached shells (`detachedCommand`, index.js L431); their exit code is never seen. A record's `exitCode` is null unless the desktop process owned the child or a crash stamp carried one.

## PR A: auto-register in the guard

New pure function in `guard-core.mjs`, `planAutoRegister(c)`, called by `register.tsx` only when `decide()` returned `pass`. `decide()` itself does not change, so every existing deny and pass path is untouched.

### Decision rules (all must hold, else `pass` with no side effect)

| # | Rule | Why |
|---|------|-----|
| 1 | `settings.autoRegister !== false` | opt-out |
| 2 | `start.certain && start.bare` | the guard's #15 guarantee: only a bare start can be replaced by `start_app` |
| 3 | `appInDir(apps, dir)` is null | a registered dir keeps today's rules |
| 4 | `dir` is not the home dir, its Desktop/Documents/Downloads, a drive root or `/` | a stray `python -m http.server` in `~` is not a project |
| 8 | (review fix) the session cwd and any `cd` target are not UNC, and the dir exists | `normPath` folds `//wsl.localhost/x` into `/wsl.localhost/x` |
| 9 | (review fix) the command uses only `[A-Za-z0-9_-=.:/@+, ]` | it is later run by cmd.exe or sh, not bash: `$VAR`, quotes, `\`, `%`, globs and `~` read differently |
| 5 | the port is certain (next table) | `start_app` verifies by polling that port |
| 6 | the port is not in `listeners` | a busy port is `decide`'s business, never a registration |
| 7 | the MCP `add_app` and `start_app` tools are both connected | otherwise nothing can be routed |

### What counts as a certain port, in order

1. An explicit port in the command (`start.port`, already parsed).
2. A literal `--port N` / `-p N` in the `package.json` script the command names (`npm run dev` reads `scripts.dev`); `-p` counts only for a tool that takes it (`tsc -p 2020 && vite` is not 2020).
   (review fix) A forwarded flag counts only when npm forwards it (after `--`; `npm run dev --port 3005` is npm config and uncertain even to `decide`) and the script sets no port of its own; `PORT=` only when the script tool binds `$PORT` (Next, Nuxt, react-scripts; not Vite or http.server). `npm dev`/`serve`/`preview` are not npm commands and are not starts. The cwd is saved with an upper-case drive letter.
3. `python -m http.server` with no port: 8000 (the module's fixed default, not configurable elsewhere).

Framework defaults (Vite 5173, Next 3000) are **not** certain: `vite.config`, `.env` or `next.config` can move them. Those starts pass untouched. Open question 1.

### How each field is derived

- **cwd**: `dir` from `startDir`, written back in the platform's own form (not the lower-cased comparison form).
- **command**: the raw start step with the leading `PORT=N` stripped (`start_app` sets `PORT` from `preferredPort`, processManager L56 and index.js L452) and a trailing `&` removed. A `--port N` flag stays, so `registeredStart(app).port` still matches on the next start.
- **preferredPort**: the certain port.
- **name**: `package.json` `name` (scope dropped: `@acme/web` becomes `web`), else the folder name. On a clash with an existing name, append the parent folder (`web (checkout-mockup)`), then `-2`, `-3`.
- **worktree**: when `git rev-parse --git-common-dir` (run by the mod via `$.process.run`) resolves to a registered app's repo, call `add_worktree` with that parent instead of `add_app`, so the row nests.
- **group/description**: `description: "Auto-registered from Claude Code"`, so the user can find and delete them.

### Flow in `register.tsx`

`decide` pass -> read `package.json` (if any) and settings -> `planAutoRegister` -> `add_app` (or `add_worktree`) -> parse the new id -> `start_app` with the session id -> `routeResult`. The route note says the app was registered. (Review fix: now `auto-register.mjs` with injected I/O, tested in CI.) Only a doubt before the claim runs the command as written. A per-dir claim (`<configDir>/claims/<key>`, atomic `mkdir`, stale after 60 s) serialises concurrent hooks; a held claim, or a re-read showing the dir registered or the port held, denies with the reuse message. A failed, refused or thrown `add_app` never falls through to a shell start: it denies. A `start_app` failure after a successful add is reported through `routeResult` as today (a deny with the reason), because the detached process may still be running and a second shell start would collide. A `start_app` timeout (`verified`, not `success`) reads "registered <name>, still starting on :<port>. Do not start it again"; `start_app` now records that start, and `decide` denies a route while the app is `starting` (60 s grace).

The ✦ in the status line needs no new code: `start_app` stamps `startedBy.kind = 'claude'`.

### Opt-out

`settings.autoRegister` (default true) in `portpilot-config.json`, a toggle in desktop Settings under "Claude Code": "Register new projects when Claude starts them". The mod reads it from the config it already loads.

### Tests (`tests/plugin-mod.test.mjs`, in `test:unit`)

| Command / state | Expected |
|---|---|
| `npm run dev -- --port 3005`, unregistered dir, port free | plan `{name, command: 'npm run dev -- --port 3005', port: 3005}` |
| `PORT=3005 npm run dev` | plan, command `npm run dev`, port 3005 |
| `cd mock && python -m http.server` | plan, port 8000, cwd `<session>/mock` |
| `npm run dev`, script `vite --port 5174` | plan, port 5174 |
| `npm run dev`, script `next dev` | `pass`, no plan |
| `npm install && npm run dev --port 3005` | `pass` (uncertain) |
| `npm run dev --port $P`, `$(...)`, unbalanced quotes | `pass` |
| `--port 3005` start piped to `tee`, or with `> log`, or `FOO=1 npm run dev` | `pass` (not bare) |
| port 3005 listening | no plan; `decide` keeps its deny |
| dir is home or a drive root | `pass` |
| `settings.autoRegister: false` | `pass` |
| dir already registered | no plan; existing route/pass unchanged |
| name clash with `web` | `web (<parent folder>)` |
| `add_app` returns `isError` (mod-level, `register.test.ts`) | `next(e)`, command untouched |

## PR B1: run records

New module `src/core/runHistory.js`, zero dependencies, loaded by the desktop app, web agent and MCP server (and by VS Code through `copy-runtime.js` at its next build; no extension code changes).

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

`git` is null outside a repo. `skipped` is `"not-a-repo" | "too-large" | "git-missing" | "timeout"`. `files` is capped at 50 names, because file names are what free-text search most often hits ("checkout").

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

Caps: **500 runs** and **150 MB** (`runs.json` plus `thumbs/`). Both settings. Pruning runs inside the same `updateJson` that appends: drop the oldest unpinned runs until both caps hold, delete their thumbs, then (outside the lock, best-effort) `git update-ref -d` each dropped ref where `repoRoot` still exists. A weekly sweep in the desktop app removes orphan thumbs and refs whose run is gone. Pinned runs never prune; at most 50 pins.

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
| 19 | guard-auto-register | PR A: `planAutoRegister`, `parseStart.raw`, `settings.autoRegister`, tests | 4 | S-M |
| 20 | run-history-core | PR B1: `runHistory.js`, hooks in record*, snapshot, pruning, `find_run`, tests | 4 | M |
| 21 | run-history-view | PR B2: History tab, offscreen thumbnails, Re-run, demo-seed runs + screenshots | 4 | M-L |
| 22 | vscode-run-history | History node in the VS Code view (after #17) | 5 | S |

Order: #19 and #20 are independent (guard vs core) and can run in parallel; #21 after #20. #12 rebases onto #20.

## Open questions for Macdara

1. **Framework-default ports**: should `npm run dev` with a bare `vite`/`next dev` script auto-register? *Recommended: no in PR A. Pass untouched; revisit with a "learn the port after it binds" follow-up, which keeps the never-guess guarantee.*
2. **Re-run dependencies**: install fresh in the new worktree, or junction `node_modules` from the original checkout? *Recommended: fresh install. A junction breaks Turbopack and risks the recursive-delete trap; a lockfile install is slower but always correct.*
3. **Snapshot refs in the project repo**: acceptable to write `refs/portpilot/runs/*` into each repo? *Recommended: yes. They are invisible to branches and normal push/fetch, deduplicate, and restore without conflicts. A per-repo opt-out falls back to "no snapshot".*
4. **A `rerun_run` MCP tool** in B1, or only `find_run` with steps? *Recommended: `find_run` only for now. Re-run creates a worktree and installs packages, which the user should trigger from the desktop until the flow has been used.*
5. **Retention caps**: 500 runs / 150 MB with pinning? *Recommended: yes, both editable in Settings.*
