# PortPilot landing page redesign for v3.4.0 Brief

Open this in a **fresh Claude Code session** in `I:/Scratch/PortPilot-2026-landing-redesign-340/`. Don't carry context from the current session.

## First action: rebase before doing anything else

```bash
git fetch origin master --quiet
git rebase origin/master
```

## The problem

The landing page (https://m4cd4r4.github.io/PortPilot/, served by GitHub Pages from `docs/` on master) still sells v3.3. v3.4.0 shipped 2026-10-07 with the Claude Code plugin, crash alerts and row state, and none of it is shown. Measured at 1440 on 2026-10-07: the page is 6,916px tall. Section heights: Features 1,227 (20 flat cards, no grouping), Smart App Detection 520, Getting Started 510, Keyboard Shortcuts 333, VS Code Extension 605, AI Agent Integration 720, **Security 1,432 (the largest)**, Download 691. There are only 2 screenshots (`docs/screenshots/slot1.png`, `slot2.png`), both pre-3.4. The hero subtitle is "Localhost Port Manager for Developers".

The logo is inconsistent. The page header uses a ⚓ emoji. The desktop app and the VS Code extension use `public/icon.png` / `vscode-extension/media/icon.png` (a "P" in a compass with four coloured nodes), which Macdara thinks is weak and generic. The plugin status line also uses ⚓ (`⚓ 3 up`). The page favicon links `../public/icon.svg`, which is outside `docs/` and returns **404** on Pages.

## Decisions already made by Macdara

- The hero leads with **Claude Code and you sharing one view of what's running**, for example the plugin status line next to the desktop app. It does not lead with "localhost port manager".
- The new logo is chosen by Macdara. Show him 2-3 directions **before** applying any of them.
- Merging is publishing (Pages deploys from master). Ask before merging.

## Source of truth (read these BEFORE designing/coding)

1. [docs/index.html](docs/index.html) - the page; its CSS is inline. Keep the dark Tokyo-night palette unless the logo choice requires otherwise.
2. [CHANGELOG.md](CHANGELOG.md) `[3.4.0]` - what shipped and how to describe it.
3. [docs/demo/demo-seed.js](docs/demo/demo-seed.js) - fictional data for every screenshot.
4. [docs/claude-integration/PROJECT-PLAN.md](docs/claude-integration/PROJECT-PLAN.md) - feature rows #6-#10 describe the plugin, status line, guard and crash band precisely.
5. [README.md](README.md) - the feature list the page must not contradict.

## What's in scope

- `docs/index.html` and new assets under `docs/` (screenshots, crops, logo, favicon, `og-image.png`).
- The logo, once chosen: `public/icon.svg` + `icon*.png`, `vscode-extension/media/icon.png` + `portpilot-icon.svg`, the page header, favicon (fix the 404 by serving it from inside `docs/`), og-image.
- `docs/screenshots/` replacements (README references `slot1.png`; update README image refs if you rename).

## Out of scope (do NOT modify)

- App code under `src/`, `mcp-server/`, `plugin/` (the status-line ⚓ glyph is code; note it as a follow-up if the new logo argues for changing it).
- Release workflow, version numbers.

## What "good" looks like

- The hero makes the Claude Code + desktop story obvious in 5 seconds, with a real (demo-seed) visual.
- Features are grouped by importance. First: the Claude Code plugin (status line, dev-server guard, crash band with Fix it) and the 3.4 desktop features (row state with "who started it", conflict strip, crash toast with Ask Claude). Below: the classic features in a few named groups, not 20 flat cards.
- Security is cut to about 300px: a short "what we protect against" list plus a link to the detail. Getting Started and Keyboard Shortcuts become compact or collapsible.
- Component crops (conflict strip, crash toast, row state cell, status line) appear beside the features they explain.
- The page is noticeably shorter than 6,916px at 1440, and reads well at 390.
- One logo everywhere; favicon loads (200) on the live URL after merge.

## Required deliverables

1. A short plain-text rationale (new section order, what moves, what shrinks) before code. Show Macdara the logo options at the same time.
2. The page change and assets.
3. Screenshots at 1440 and 390 of every changed section, read by you before reporting.
4. `/design-review`, then `/polish-pass`, on the finished page.
5. One PR, with a row added to `docs/claude-integration/PROJECT-PLAN.md`.

## Suggested workflow

1. Rebase. Read the source-of-truth files.
2. Screenshot the live page at 1440 and 390 first, as the "before".
3. Logo: produce 2-3 directions as SVG on one comparison sheet (screenshot it), and ask Macdara with AskUserQuestion. Meanwhile, draft the restructure.
4. Screenshots: serve the repo root with a small Node static server, load `src/renderer/index.html` with `docs/demo/demo-seed.js` as a Playwright `addInitScript`, drive Brave (`C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe`) with the main repo's Playwright (`I:/Scratch/PortPilot-2026/node_modules/playwright`). The seed has `autoScan: false`; call `loadApps()` from `page.evaluate` if you need a scan. Crop components with element screenshots.
5. Build, screenshot, read, iterate. Then `/design-review` and `/polish-pass`.
6. PR. Ask Macdara before merging.

## Constraints

- One PR. Branch: `feat/landing-redesign-340`.
- **Never screenshot the real app**: it shows Macdara's real project names. Demo seed only.
- The page has scroll-reveal animations. Scroll through the page before taking element screenshots, or below-the-fold cards render blank (seen 2026-10-07 at 390).
- No new runtime dependencies on the page; external scripts only from the allowed CDNs if at all.
- Site copy: British English, no em-dashes, en-dashes or ellipsis characters, no "not just X" constructions.
- Do not branch or commit in the primary checkout `I:/Scratch/PortPilot-2026`.

## Added scope: README redesign (Macdara, 2026-10-07)

Do this after the logo is chosen and the screenshots exist, so both surfaces share one logo, one pitch and one set of images. Same branch; same PR, or a second PR if the first gets large.

Measured: `README.md` is 796 lines. It opens with six "What's New" sections (v1.7.0 to v3.3.0, L64-174) and has none for 3.4. Version History (L716-783) repeats `CHANGELOG.md`. Auto Detection runs 187 lines (L216-402). Screenshots has one image (L403). The hook flagged a "not just" (L62) and an em-dash (L600).

What "good" looks like:
- Top of the README: logo, one-line pitch matching the new hero, one hero image (demo seed), badges, install links.
- A short "Use it with Claude Code" quickstart near the top (plugin install, what the status line and guard do).
- Features grouped in the same order as the landing page, with the component crops.
- Release history moves to `CHANGELOG.md`: delete the What's New and Version History blocks from the README and link to the changelog and Releases page.
- Long reference material (Auto Detection detail, example config, MCP tool list) goes into collapsible `<details>` blocks or `docs/` pages, linked from the README.
- Renders well on github.com in both light and dark themes: check by viewing the pushed branch's README on GitHub (screenshot at 1440 and 390), not a local markdown preview.
- Target well under half the current length.

## Out-of-scope follow-ups (capture, don't build)

Append to `C:/Users/Hard-Worker/Obsidian/Second-Brain/wiki/backlog/portpilot.md`. Example: aligning the plugin status-line glyph with the new logo.

## Why this brief is structured this way

The page grew one section per release with no regrouping, so the newest and strongest features are invisible and Security outweighs Features. The logo gate exists because a logo applied across four surfaces is costly to undo.