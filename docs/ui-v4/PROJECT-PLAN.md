# PortPilot v4 UI: project plan

Pick (Macdara, 2026-10-16): **A + B hybrid.** A's sidebar, grouped list and right inspector are the main app. B's big-Start tiles are the Running home and the first-run screen. Light and dark both first-class (A ships dark + light; B's dark variant is the tile home in dark).
Canvas: `docs/ui-v4/canvas.html`. Brief: `docs/ui-v4/BRIEF.md`. Do not re-litigate the pick.

## Signature move

The sidebar is the status board: every item carries a live count and a health dot ("is anything wrong" is answered before a click). Home is the B tile grid with one large action per app.

## Rule every slice holds

- Tokens only: no raw colour, radius, font or shadow in a component.
- Flag-off proof: with `ui.v4` off, the old UI is byte-identical (diff renderer assets before and after).
- Reuse `src/core` (status, nowStrip, conflict, browserProfiles); no logic forks.
- Every screen: structure, purposeful colour, a CTA, an obvious next place; empty states carry an action; errors say the fix.
- Screenshots read at 1440 and 390 (light and dark) before a slice is called done.

## Slices

| # | Slice | Status |
|---|---|---|
| 0 | Tokens and system only: new `styles-v4.css` beside the old one, flag `ui.v4`, two token sets (Dark, Light) plus System; no old-theme port | todo |
| 1 | Shell: sidebar with live counts and health dots, content region, Ctrl+K kept | todo |
| 2 | Running home: B tiles, blocked strip with prescriptive fixes (Use :3005, Free the port, Ask Claude), first-run empty state | todo |
| 3 | Apps list + inspector (A): grouped, worktrees nested, preview, logs, share | todo |
| 4 | Ports: dev / other / system, gated kill, conflicts | todo |
| 5 | Browsers | todo |
| 6 | History | todo |
| 7 | Settings and modals (add app, delete, detect, group, share, logs) | todo |
| 8 | Surfaces outside the route list: tray, crash toast, command palette, VS Code panel, web portal, docs screenshots and README demo | todo |
| 9 | Flip default on once every screen has a slice; remove flag after one release | todo |

## Does NOT cover

- The Mission map (C) beyond a possible later "Map" view inside Ports.
- New features; this is structure and look only.
- Releasing: a normal release PR follows slice 9.

## Open items

- Name B's dark and A's light as the default per OS theme? Assumed: follow the system theme, user can override.
- Which palette the hybrid uses for its Dark and Light sets: A's graphite + mint, or B's paper + indigo (assumed: graphite + mint dark, a light variant of the same; confirm in slice 0).

## Decision: the six old themes are retired (Macdara, 2026-10-16)

- v4 ships exactly two token sets, Dark and Light, plus "System" (follows the OS). No theme picker beyond that.
- The old look and its six themes stay available in the last v3.x release, which remains downloadable for anyone who prefers it. v4 does not port them.
- Consequences: Settings > Theme shrinks to a three-way switch; stored theme values from v3 map to System on first v4 launch; `ui.v4` becomes a build-time switch removed at slice 9 rather than a long-lived user setting.
