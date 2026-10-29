# PortPilot redesign: Ledger

Chosen 2026-10-28 by Macdara from three live directions (Ledger, Harbour, Lookout). Reference page: https://claude.ai/artifact/DtGJUfY8yGFgmm2wSJrBk5

## Decisions

- Direction A, Ledger: left sidebar, hairline rows, tight density, status as glyph + word, grouped, hover-peek screenshots.
- Theme stays Dark, Light and System.
- Display options are real settings: view (Rows, Compact, Cards, Gallery), density, thumbnails (Off, Hover peek, Inline), status style (Dot, Glyph + word), grouping (Grouped, Flat). Defaults: Rows, Tight, Hover peek, Glyph + word, Grouped.
- Navigation (Sidebar or Top bar) and accent (Blue, Teal, Coral, Pink, Violet) are also settings, per Macdara 2026-10-28 ("nice to give people the customisation"). Default is Sidebar and Blue; the sidebar collapses to the top bar under 720px. Sidebar as default reverses the 2026-10-24 top-bar choice, picked explicitly by Macdara.
- Temporary browsers stay dropped.

## Slices (each ends testable and visible)

1. **Shell and tokens.** Ledger palette for dark, light and system in `ui/src/styles.css`, with the accent hue as a variable. A shell that renders either a sidebar or the existing top bar for Home, Apps, Browsers, History, Scenes, Ports, Settings. Palette button and Ctrl+K kept.
2. **Apps list.** Rows with grouping, glyph + word status, tight density, hover-peek thumbnails, row actions that fit at 390px. Manage mode keeps working.
3. **Display settings.** The five display options plus navigation and accent, persisted, set in Settings and (view only) as a quick control on the Apps toolbar. Cards and Gallery views.
4. **Home, Browsers, History** on the same tokens and row pattern.
5. **Scenes, Ports, drawers, Palette** restyled.
6. **Verify.** e2e at the real window size (clear the viewport override first), screenshots at 1440 and 390 read by eye, then a packaged draft install per the existing release rule. No tag, release or publish without Macdara's yes.

## Rules for this work

- One PR for the theme, one commit per slice. Not inside PR #161.
- Never judge UI from `tests/e2e-harness.js` renders without clearing the viewport override.
- Demo data stays the fictional apps and profiles.
