# PortPilot v4 UI/UX brief

Status: draft 1, 2026-10-15. Design only. No app code changes until a direction is picked.
Tags: `[said]` Macdara said it, `[researched]` found in Mobbin/Refero/prior docs, `[assumed]` a guess to confirm.

## 1. Problem

- [said] "Nothing like the existing one!" The current UI is an old, clunky, overwhelming single scrolling page.
- [researched] The home page mixes three jobs: what is running (preview cards), inventory (23 equal-weight rows), what is broken (conflict banners). Preview cards are mostly empty ("No preview (IPv6 only)") and waste half the screen. Rows carry branch, STALE, N, conflict chips at equal weight.
- [researched] Rounds 1 and 2 (docs/ui-redesign) restyled this page: status dots, grouped rows, drawer, card tokens. They fixed flatness, not structure. v4 changes the information architecture.
- Diagnosis test (premium-app guide s1): reference-document look = partial; features under-sold = yes (worktrees, browser leases, Claude attribution are buried); clear next step per screen = no. Guide applies.

## 2. Audience and first run

- [assumed] Primary: a stranger with 3 to 5 apps. First run must be calm: three things on screen, one obvious action.
- [said] Power features (worktrees, groups, 42-app lists) must stay, but not in the face.
- [assumed] Secondary: Macdara, 20+ apps, many worktrees, Claude starting servers.

## 3. Feature inventory, categorised

| Section | Features |
|---|---|
| Run (home) | Now running (live), start/stop/restart, open in browser, preview thumbnail, favourite, bulk start/stop, groups, sort |
| Apps | Registry: add/edit/delete, auto-detect projects, worktrees (nested under parent app), branch + stale flag, reserved port, health, share link, logs (stdout/stderr) |
| Ports | Active ports classified dev / other / system, process + PID + command, kill (gated on system), conflict detection (wanted port taken), scan |
| Browsers | Named profiles on debug ports, leases (who holds it), start/stop, headless vs headed, extensions, duplicate, history |
| History | Runs: app, branch, command, sha, dirty flag, who started it, search + date filters, re-run |
| Claude | Who started what (attribution), crash toast, Ask Claude about a failure, MCP tool activity |
| Settings | Theme (6), scan interval, window/tray, Claude integration, run-history retention, web access (preview), data import/export, project discovery roots |
| Global | Ctrl+K command palette, title bar, tray, VS Code and web surfaces sharing one config |

## 4. Research log (TAKE / LEAVE)

| Reference | URL | TAKE | LEAVE |
|---|---|---|---|
| Linear, three-column | https://refero.design/pages/c2cf5972-9d5b-4078-a1fb-09e7b463b7e9 | Left nav, middle list, right detail that opens on selection; collapsible status groups with counts | Issue-tracker density (too many columns for 5 apps) |
| Linear, grouped list | https://refero.design/pages/adf9d449-68c8-47a1-9740-59cda51c2daf | Collapsible groups, one row = one line | Filter bar always visible |
| Railway, service canvas + side sheet | https://mobbin.com/screens/8907c9da-f513-4722-9f19-826602c11429 | Services as nodes with live status; click opens a side sheet with tabs (Deployments, Variables, Settings); history rows with status pills | Dark grid backdrop clutter |
| Supabase, project home | https://mobbin.com/screens/2e0ffd2d-c588-4513-bd84-d3effa2e31ed | Status block that expands to a per-service health list; "Get connected" tiles as next actions | Icon-only rail (no labels) |
| Render, overview | https://mobbin.com/screens/f3e5ef09-22e3-4568-a3b1-565fe78d58a3 | "All services are up and running" as one calm sentence; Active/Suspended/All tabs | Table with 5 mostly-empty columns |
| incident.io, status page | https://mobbin.com/screens/9618b478-1dc4-428c-b34d-5f4115112f4d | Empty = green "nothing wrong" banner, not a blank; sidebar with section tabs inside the page | Heavy dark sidebar |
| Customer.io, performance | https://mobbin.com/screens/b9743841-5a29-4454-bc39-133d7b0d7d9c | Big health glyph + one sentence + "last updated"; service list beneath | Left nav with 20 items |
| GitBook / AirOps empty states | https://mobbin.com/screens/5722e06a-7f90-424d-9239-97a878a7e7e6 | Single centred card with one primary action | Illustrations |
| Docker Desktop, OrbStack, Raycast, Arc | prior round: docs/ui-redesign/RESEARCH-FINDINGS.md | Left rail, master-detail, hover-reveal actions, command palette | (already adopted in rounds 1-2) |

## 5. Constraints

- [said] Palette fixed in round 2 (2026-10-14): dark navy + periwinkle (Tokyo Night tokens). [assumed] For v4 this is open again because Macdara said "nothing like the existing". To confirm.
- [assumed] Stack stays vanilla HTML/CSS/JS in Electron; core logic in src/core reused (status, nowStrip, conflict, browserProfiles).
- Light and dark both first-class. Six themes stay as token sets.
- Each screen needs: structure, purposeful colour, a CTA, an obvious next place (guide s4).
- Empty states with an action; errors say the fix (guide ingredients 6 and 8).

## 6. Signature move (one per direction, named before drawing)

- A "Ledger": the sidebar IS the status board. Each nav item carries a live count and a health dot, so "what is wrong" is readable without opening anything.
- B "Launchpad": one big Start. Apps are tiles; the whole app is a launcher with the palette as the primary input.
- C "Mission map": ports as a map. Apps are nodes, ports are the wires; a conflict is a visibly crossed wire.

## 7. Next

1. Render A, B, C on the demo seed (1440 and 390; with empty state and conflict state).
2. Macdara picks. Log the pick. Write docs/ui-v4/PROJECT-PLAN.md. Build in vertical slices.
