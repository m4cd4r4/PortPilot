# PortPilot UX recommendations - 2026-10-05

Scope: desktop/web renderer (`src/renderer/`), VS Code extension (`vscode-extension/`), and the
planned Claude Code surfaces (`/ports` pane, status line, crash toasts, dev-server guard,
provenance, MCP channel alerts). Read-only research; nothing in the app was changed.

Evidence base: `src/renderer/index.html`, `renderer.js` (`renderAppCard` ~L1000-1100,
`showToast` L2500, `killConflictingProcess` L1225), `styles.css` theme tokens,
`vscode-extension/package.json` + `appsTreeProvider.ts` + `extension.ts`, and the fake-seeded
demo screenshots `docs/screenshots/slot1.png`, `slot2.png`, `docs/ui-redesign/slice9-detect-modal.png`.
Prior work respected: `docs/ui-redesign/PROJECT-PLAN.md` (status model in `src/core/status.js`,
grouped port table, drawer) already fixed the "flat wall" diagnosis; this report builds on it,
it does not re-litigate it.

Tags: `[observed]` seen in code/screenshot, `[researched]` from Mobbin/Refero, `[assumed]` a guess.

---

## 0. Diagnosis in one paragraph

The v3 redesign solved signal-vs-noise. What remains is **legibility of state and of
cause**. A row tells you *that* something is wrong (a coloured dot) but not *what* or *why*
or *who did it*: `slot1.png` shows an amber dot on `harbor-web feat/live-search` and a red dot on
`dockyard-docs` with no state word, while the drawer (`slot2.png`) has to say "Not responding" twice
(Status and Health). The planned Claude features make this worse, not better: once two actors
(human, Claude sessions) start and stop servers, "who started this, and is it healthy" becomes the
primary question, and the current row has no slot for either answer. Every recommendation below
either adds a slot for state/cause or moves an action closer to it.

Scored against the 8 premium ingredients (premium-app-redesign-guide.md §2):

| # | Ingredient | Score | Evidence |
|---|---|---|---|
| 1 | Anticipate need | partial | Framework port autodetect, Find Free; but conflict resolution asks you to pick between 4 unlabelled icons |
| 2 | Pacing on transitions | partial | Starting countdown exists (`countdownHtml`); stop/start otherwise snap |
| 3 | Delight | no | Nothing rewards a successful start |
| 4 | Know when not to animate | yes | Dense, no gratuitous motion |
| 5 | Extreme consistency | partial | Icon-only buttons beside text badges `N`, `Py`, `R`, `V4`; ALL-CAPS buttons + Title Case labels; `+` means "adopt" on ports and "start on free port" on conflicts |
| 6 | Empty states with intention | no | `"No apps registered. Click "Add App" to get started."` (index.html:54) - plain text, no Discover Projects shortcut |
| 7 | Reward discovery | no | |
| 8 | Prescriptive errors | partial | Share modal caveat is excellent (index.html:370); crash/health failure says "Not responding (error status)" with no next step |

---

## 1. Ranked top 10 (impact / effort)

| Rank | Recommendation | Surface | Effort |
|---|---|---|---|
| 1 | State word + reason chip on every row (`Not responding`, `Port blocked by node 4812`, `Crashed 2m ago`) - colour never carries state alone | desktop/web | S |
| 2 | Provenance badge model (`you` / `claude:<session>` / `external`) in `src/core/status.js`, rendered on rows, drawer, VS Code description, pane | cross-cutting | M |
| 3 | Claude Code status line `⚓ 3 up · :3000 web · :5173 docs` with a single "worst state" prefix when anything is wrong | Claude Code | S |
| 4 | Command palette (Ctrl+K): every action by app name ("stop harbor", "share :3000", "kill 4321") | desktop/web | M |
| 5 | Conflict resolution as a labelled inline strip, not 4 icon buttons + native `confirm()` | desktop/web | S |
| 6 | `/ports` live pane for Claude Code (text-cell table, keyboard row actions, guard-intercept card) | Claude Code | M |
| 7 | Crash toast with actions (Restart / Logs / Ask Claude) + last 3 stderr lines, persistent until dismissed | desktop/web + Claude Code | S |
| 8 | VS Code: status-aware tree icons (health + conflict + provenance), inline row actions, rich status-bar item | VS Code | S |
| 9 | Drawer re-hierarchy: one status header with reason + uptime, primary action pair, log tail inline, secondary actions in an overflow | desktop/web | M |
| 10 | Intentional empty/first-run state: "Discover projects in C:/dev" one-click + "Add manually" + "Adopt running :3000" | desktop/web | S |

Do-now (S, high impact): 1, 3, 5, 7, 8, 10. Do-later (M): 2, 4, 6, 9. Item 2 is the
foundation for 3, 6 and 7's provenance text, so build its data model first even if the UI lands later.

---

## 2. (a) Desktop / web app

### A1. State word + reason chip on every app row - S
- **Problem** `[observed]`: `slot1.png` - amber and red dots with no text; the reason exists in
  code (`statusWord = 'Not responding'` / `'Port blocked'`, renderer.js ~L1498-1501) but only
  reaches the drawer. Colour-only state fails WCAG 1.4.1 and fails in the Light theme's yellow
  (`#9a6700`) against amber-ish branch colours.
- **Proposal**: right-hand column of the row (currently ~800px of dead space in `slot1.png`)
  becomes a fixed-width state cell: `● Running 2h14m`, `▲ Port blocked · node 4812`,
  `✕ Not responding · /api/health 503`, `○ Stopped`. Shape + word + colour. Uptime/memory are
  already fetched (`statsHtml`) but only when the port is expanded - show uptime always.
- **Reference** `[researched]`: Supabase projects list (Mobbin, status pill `ACTIVE` in its own column);
  Shopify Orders (Mobbin, two independent status pills per row - Paid / Unfulfilled - maps to
  Process state / Health). Vercel deployments list (Refero 8c510eb3) - state word + age per row.

### A2. Labelled conflict strip - S
- **Problem** `[observed]`: conflict actions are four icon buttons, one of which is a bare `+`
  ("Start on next free port"), plus `confirm()` (renderer.js L1230) - a native OS dialog that
  breaks theme and the web portal's look.
- **Proposal**: when a row is in conflict, expand it by one line underneath:
  `:3000 is held by node.exe (PID 4812, started 3h ago, not managed)  [Use :3001 instead]  [Kill & start]  [Show process]`.
  Recommended action first (start on free port is non-destructive). Kill confirms inline
  (button turns into `Confirm kill?` for 3s) instead of `confirm()`.
  If the holder is a *Claude-started* server (see provenance), say so: "held by harbor-web started by Claude (session a3f2)" - the usual real answer is "it's your own duplicate".
- **Reference** `[researched]`: Linear's inline create row (Mobbin, Initiatives - inline form, no modal);
  Square "Share your payment link" (Mobbin) - one sentence of context then a ranked action list.

### A3. Command palette (Ctrl+K) - M
- **Problem** `[observed]`: shortcuts are Ctrl+F/N/R/G only (index.html tooltips); every
  per-app action needs mouse → row → drawer → button (3 steps). Port kill needs the right row
  in a collapsed group.
- **Proposal**: Ctrl+K palette, fuzzy over `verb + app/port`: `stop harbor`, `logs dockyard`,
  `share 3000`, `kill 4321`, `start group Harbor App`, `theme nord`. Each row: status dot, name,
  `:port`, right-aligned shortcut hint. Empty query shows "Recently used" + "Needs attention"
  (crashed/conflicted first - ingredient #1). Same command registry feeds the web portal, and the
  `/ports` pane's action list.
- **Reference** `[researched]`: Raycast palette (Refero d907406e / 370ddbce - icon, title, muted
  subtitle, right-side hint, ~10 compact rows); fal dashboard palette (Refero 43640d5d - suggestions
  on empty query); Linear keyboard-shortcuts side sheet (Refero 84407ff1) for a `?` cheat-sheet.

### A4. Crash toast with actions - S
- **Problem** `[observed]`: `showToast(message, type)` is text-only, auto-dismisses at 3s, max 3.
  A crash notice that vanishes in 3s with no "why" fails ingredient #8.
- **Proposal**: `showToast({title, body, actions[], sticky})`. Crash toast is sticky, shows exit
  code + last 2-3 stderr lines in mono, actions `Restart` `Logs` `Ask Claude` (the last only when
  an MCP channel is connected). Group repeated crashes ("crashed 3x in 5m - auto-restart paused").
- **Reference** `[researched]`: Enode assets success toast (Refero 16820738 - bottom-right toast with
  context); Klaviyo copy-confirmation toast (Mobbin - icon + close, top-centre).

### A5. Drawer re-hierarchy - M
- **Problem** `[observed]` `slot2.png`: full-width salmon STOP dominates; STATUS and HEALTH repeat the
  same sentence; 8 equal-weight buttons (Open, Share, Logs, Folder, Copy cmd, Reserve, Edit, Delete) -
  Delete has the same weight as Open; bottom 40% empty.
- **Proposal**: header = dot + state word + reason + uptime + provenance (`started by Claude · session a3f2 · 14:02`).
  Primary pair: `Open` (accent) + `Stop` (neutral, red only on hover). Key/value block (port, branch,
  cmd, dir) with copy-on-click per value - removes the Copy Cmd button. Inline **log tail** (last 20 lines,
  follow toggle) fills the empty space; `Logs` opens full view. Secondary actions (Share, Reserve,
  Folder, Edit) as an icon row; Delete in an overflow menu.
- **Reference** `[researched]`: Vercel deployment detail (Refero 73675061 - summary row + collapsible
  build log in the same page); Base44 Activity Monitor side sheet (Refero d2675eb7 - slide-over with
  list + detail tabs); Appwrite function deployment card (Refero 0407ea2f - overflow for redeploy/logs).

### A6. Badge vocabulary cleanup - S
- **Problem** `[observed]`: `N`, `Py`, `DB`, `R`, `V4` single-letter badges with tooltip-only meaning
  (renderer.js ~L1057-1063). `V4` repeated on every row is noise; `R` (reserved) is unguessable.
- **Proposal**: drop `V4` (show only `v6` as the exception); replace `N`/`Py` with 12px framework
  glyph (or the detected framework name `next`, `vite`, `uvicorn` - the autodetect already knows it);
  `R` becomes a lock glyph on the port chip itself (`🔒:5173` style, as an SVG icon).
- **Reference**: Mistral connectors list (Mobbin - brand icon at row start, no letter badges).

### A7. Intentional empty and first-run states - S
- **Problem** `[observed]`: index.html:54 and :67 are plain text.
- **Proposal**: empty apps list shows three actions: `Discover projects` (pre-filled with the last
  scan path or `~/dev`), `Adopt a running server` (lists the dev ports already detected - the
  single best "anticipate" move, since the user usually already has `:3000` running), `Add manually`.
  Empty ports: "Nothing listening on dev ports. Start an app above." with the list of favourites.
- **Reference** `[researched]`: Airtable "Get up and running fast!" import grid (Refero 007368c4);
  Typeform register-app empty state (Refero 5e852a7b).

### A8. Group header and toolbar polish - S
- **Problem** `[observed]` `slot1.png`: group count sits at the far right, 1100px from its label;
  sort select reads "DEFAULT"; all buttons ALL-CAPS; no group-level state summary.
- **Proposal**: header = `Harbor App · 3 · ●●○` (mini status strip) + hover-revealed `Start all / Stop all`
  next to the label. Sort select reads `Sort: Default`. Sentence-case buttons (ALL-CAPS hurts scan
  speed at 12-13px).
- **Reference** `[researched]`: Linear grouped issue list (Mobbin - `In Progress 2` count beside label,
  `+` on hover).

### A9. Share sheet - S
- **Problem** `[observed]`: works and has a good caveat; but the QR is shown even when the server only
  binds localhost (the phone will fail).
- **Proposal**: detect bind address (already known - network-exposed glyph exists) and, when
  loopback-only, replace the QR with a one-click "Restart with --host" (framework-aware) before
  showing the QR. Copy confirmation as a toast, not a button label change.
- **Reference** `[researched]`: Base wallet QR sheet (Mobbin - QR centred, address + copy beneath);
  Calendly share modal (Mobbin - link + Copy, then "Next steps" numbered).

### A10. Activity timeline (who/what/when) - M
- **Problem**: nothing records starts, stops, crashes, kills. With Claude acting autonomously this
  becomes the trust surface.
- **Proposal**: a collapsible "Activity" section (or drawer tab) - `14:02 claude:a3f2 started harbor-web :3002`,
  `14:09 you stopped tugboat-api`, `14:11 dockyard-docs crashed (exit 1)`, `14:11 guard blocked duplicate "npm run dev" from claude:b71c → routed to :3000`.
  Filter by actor.
- **Reference** `[researched]`: Klaviyo Activity log (Mobbin - actor column, action, time, filters by user);
  Customer.io activity logs (Mobbin - auto-refresh toggle, type filter); Fibery audit log (Refero 2cec7602).

---

## 3. (b) VS Code extension

### B1. Status-aware tree items - S
- **Problem** `[observed]`: `appsTreeProvider.ts` L66-79 only distinguishes running/stopped
  (`circle-filled` / `circle-outline`); health, conflict, starting and crashed are invisible in VS Code,
  though `src/core/status.js` already computes them.
- **Proposal**: map `STATES` to ThemeIcons: running `pass-filled` (testing.iconPassed), unhealthy
  `warning` (list.warningForeground), conflict `issues`, crashed `error` (errorForeground),
  starting `loading~spin`. Description: `:3000 · 2h · claude` (provenance last). Tooltip as
  `MarkdownString` with command links ([Restart](command:portpilot.startApp?...)).
- **Reference**: VS Code's own Testing view icon vocabulary `[assumed - not in Mobbin/Refero]`.

### B2. Inline row actions - S
- **Proposal**: `view/item/context` with `group: "inline"` - play/stop + globe on hover, conflict rows
  get `Use next free port` inline. Contextual `contextValue` per state (`app-conflict`, `app-crashed`).

### B3. Status bar item - S
- **Problem** `[observed]`: `extension.ts` L32: `$(plug) PP: 3 running`, click = refresh.
- **Proposal**: mirror the Claude status line: `$(pulse) 3 up · :3000 web` normally,
  `$(error) dockyard crashed` with `statusBarItem.errorBackground` when anything is wrong. Click opens a
  QuickPick of apps with actions (the command palette, VS Code edition).

### B4. Welcome view - S
- **Proposal**: `viewsWelcome` for `portpilot.apps` when empty: `[Discover projects](command:...)`,
  `[Adopt running servers]`, `[Add app]`. Zero custom UI.

---

## 4. (c) Claude Code pane, status line, toasts

Constraints: elements are Box/Text/Button/Input/Select/Markdown/Code; terminal is a text-cell
grid, so every state needs a glyph + word, never colour alone (many terminals are 16-colour or
colour-blind-configured). Keep the pane under ~12 rows by default.

### C1. Status line - S
Rules: max ~50 cells; worst state first; at most 2 named servers (favourites, then most recent);
provenance glyph only when Claude started it. Glyphs pick from a narrow, widely-supported set.

```
normal          ⚓ 3 up · :3000 web · :5173 docs
claude-owned    ⚓ 3 up · :3000 web · :5173 docs✦          (✦ = started by a Claude session)
attention       ⚓ ✕ docs crashed · 2 up · :3000 web
conflict        ⚓ ▲ :3000 busy (node 4812) · 2 up
nothing         ⚓ idle
portpilot down  ⚓ offline
```

### C2. `/ports` live pane - M

```
╭─ PortPilot ───────────────────────────── 3 up · 1 crashed · 1 stopped ─╮
│   APP                  PORT   STATE              UP     BY             │
│ ▸ ● harbor-web         :3000  running            2h14m  you            │
│   ● ├ feat/checkout    :3002  running            31m    claude a3f2    │
│   ✕ dockyard-docs      :4321  crashed (exit 1)   -      claude b71c    │
│   ▲ tugboat-api        :8000  blocked by py 9120 -      you            │
│   ○ lighthouse-admin   :5173  stopped            -      -              │
│                                                                        │
│ dockyard-docs  ✕ crashed 14:11  exit 1                                 │
│   Error: Cannot find module './routes/index.js'                        │
│   at Module._resolveFilename (node:internal/modules/cjs/loader:1145)   │
│ [ Restart ]  [ Logs ]  [ Open in PortPilot ]                           │
├────────────────────────────────────────────────────────────────────────┤
│ ↑↓ select  enter open  s start/stop  r restart  l logs  k kill  / find │
╰────────────────────────────────────────────────────────────────────────╯
```

- The selected row expands into a 3-line detail (state, last stderr, buttons) - the drawer, in cells.
- Unmanaged dev ports appear under a folded `+ 2 other dev ports` line, `a` adopts.
- `BY` column is the provenance badge; `claude a3f2` = short session id; the session running the
  pane shows `this session` instead.

### C3. Dev-server guard intercept card - S (UI) / M (logic)
When Claude tries `npm run dev` on a busy port, render a card in the pane/transcript instead of a
silent block:

```
╭─ PortPilot guard ─────────────────────────────────────────────────╮
│ ▲ Not starting a second dev server.                                │
│   harbor-web is already running on :3000 (started by you, 2h ago). │
│   Using http://localhost:3000                                      │
│ [ Use existing ]  [ Restart it ]  [ Start branch on :3002 ]        │
╰────────────────────────────────────────────────────────────────────╯
```
Prescriptive (ingredient #8): what happened, what was used instead, and the two alternatives.

### C4. Crash toast (Claude Code) - S

```
✕ dockyard-docs crashed · :4321 · exit 1 · started by claude b71c
  Cannot find module './routes/index.js'          [Restart] [Logs] [Fix it]
```
`Fix it` posts the crash + stderr tail into the originating session via the MCP channel; when the
crash belongs to a different session, the button reads `Send to b71c`.

---

## 5. (d) Cross-cutting

### D1. Provenance model - M (foundation)
- Add to the shared status model (`src/core/status.js`, so desktop, web, VS Code and pane agree):
  `startedBy: { kind: 'human'|'claude'|'external', surface: 'desktop'|'web'|'vscode'|'claude-code'|'mcp', sessionId?, label?, at }`.
- Render rules, one vocabulary everywhere: `you` (human via any surface), `claude a3f2` (session short
  id, full id + cwd in tooltip), `external` (adopted / found running, not started by PortPilot).
  A small glyph (`✦`) for Claude-started in tight spaces; never colour alone.
- Ownership rule surfaced in UI: a stop/kill on a server another actor started asks once inline
  ("Started by claude a3f2 12m ago - stop anyway?"). Same rule powers the guard.
- Reference `[researched]`: Klaviyo / Customer.io activity logs (actor column); fal Recent History
  (Mobbin - each request row carries its source endpoint tag).

### D2. One command registry - M
Palette (A3), VS Code QuickPick (B3), pane keybindings (C2) and MCP tools share one list of
`{id, verb, label, appliesTo(state), shortcut}`. Prevents the `+`-means-two-things drift (§0, #5).

### D3. Status vocabulary table - S
Write the canonical table once (state → glyph → word → colour token → terminal fallback) in
`docs/ui-redesign/` and test each surface renders the same word. Existing `--status-*` CSS tokens
stay; add `--status-crashed` distinct from `--status-error` (unhealthy-but-alive vs dead).

### D4. Keyboard and accessibility - S
Rows are already `tabindex=0 role=button`; add `j/k` navigation, `space` start/stop, `?` cheat-sheet
(Linear side sheet pattern). Ensure state words are in the accessible name.

### D5. Palette guardrail
Keep the existing themes (TokyoNight default, Light, Nord, Dracula, Glass). Do not introduce a new
brand palette in this pass; colour is reserved for status. No clay/maroon or dark-purple redesign.

---

## 6. References (12)

| # | App / source | Pattern to borrow | Why it fits PortPilot |
|---|---|---|---|
| 1 | Raycast palette - [Refero d907406e](https://refero.design/pages/d907406e-b209-461b-a53a-bf87e3c406b6) | Compact rows: icon, title, muted subtitle, right hint | Ctrl+K for start/stop/kill by name; dense like the app |
| 2 | fal palette - [Refero 43640d5d](https://refero.design/pages/43640d5d-fc7d-4c13-a2e0-9b40376b835f) | Suggestions on empty query | "Needs attention" first on open |
| 3 | Linear shortcuts sheet - [Refero 84407ff1](https://refero.design/pages/84407ff1-9cae-4ace-92db-5027844e3437) | `?` side sheet of grouped hotkeys | Discoverability for pane + desktop keys |
| 4 | Linear grouped list - [Mobbin](https://mobbin.com/screens/ed670cda-0527-4716-a1a6-0159f12c4f42) | Count beside group label, hover `+` | Group headers with Start/Stop all |
| 5 | Vercel deployments - [Refero 8c510eb3](https://refero.design/pages/8c510eb3-57b1-4a0f-a46b-8e2d85c7e695) | State word + age per row, filter by status/branch | Row state cell, branch filter for worktrees |
| 6 | Vercel deployment detail - [Refero 73675061](https://refero.design/pages/73675061-8485-4c1d-854d-d3061ce2e334) | Summary + collapsible log on one surface | Drawer with inline log tail |
| 7 | Shopify orders - [Mobbin](https://mobbin.com/screens/a02d3d73-8a92-43d5-a848-6871b908b484) | Two independent status pills per row; bulk bar | Process vs health; existing selection toolbar |
| 8 | Supabase projects - [Mobbin](https://mobbin.com/screens/7d933e08-5076-4cf8-aef2-b16d6b2dba55) | Dedicated STATUS column, compact | Aligned state cell |
| 9 | Klaviyo activity log - [Mobbin](https://mobbin.com/screens/1f44450b-8a6f-4d19-83e8-24addf2ca0e8) | Actor column + filter by user | Provenance timeline (you vs Claude) |
| 10 | Base44 activity monitor - [Refero d2675eb7](https://refero.design/pages/d2675eb7-be0a-43b6-8bc1-2e03e0029662) | Slide-over list with detail tabs | Drawer Logs/Activity tabs |
| 11 | Base QR sheet - [Mobbin](https://mobbin.com/screens/c1902c7b-0eff-4237-8f5a-674424ada92b) | QR centred, value + copy beneath | Share-to-phone |
| 12 | Airtable import start - [Refero 007368c4](https://refero.design/pages/007368c4-4c55-40f6-8567-6544ceb09461) | First-run grid of import sources | Empty state: Discover / Adopt / Add |

Both MCPs worked. Mobbin returned no Docker Desktop or Railway service-list screens for the
containers query (Railway's result was a canvas editor), so the process-manager row pattern leans
on Vercel/Supabase/Shopify instead. VS Code tree-icon guidance (B1) is from VS Code's own API
conventions, not a Mobbin/Refero screen.

---

## 7. Suggested sequencing (vertical slices)

1. Status vocabulary table + `startedBy` field in `src/core/status.js` (D1, D3) - no UI.
2. Row state cell (A1) + VS Code icons/description (B1) + status line (C1) - same data, three surfaces, one PR each.
3. Crash toast with actions on desktop + Claude Code (A4, C4).
4. Conflict strip (A2) + guard intercept card (C3) - same decision tree.
5. Command registry + Ctrl+K palette (D2, A3), then `/ports` pane keybindings (C2).
6. Drawer re-hierarchy + activity timeline (A5, A10).

Verification per slice: the fake-seeded demo (`docs/demo/demo-seed.js`) extended with a crashed,
Claude-started and conflicted app, screenshotted at 1440 and narrow width in Light + TokyoNight.
