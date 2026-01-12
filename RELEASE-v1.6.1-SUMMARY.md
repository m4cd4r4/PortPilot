# PortPilot v1.6.1 Release Summary

## ✅ Completed Tasks

### 1. **British English Conversion** ✅
- Converted all documentation to British English spelling
- Updated 29 instances across 6 files:
  - optimize → optimise
  - organize → organise
  - customize → customise
  - behavior → behaviour
  - license → licence (in prose)
- Files updated: README.md, CHANGELOG.md, docs/USER_GUIDE.md, docs/index.html

### 2. **Version Bump to v1.6.1** ✅
- Updated package.json to version 1.6.1
- Updated README.md badge
- Updated docs/index.html download links
- Created Git tag: `v1.6.1`

### 3. **Windows Builds** ✅
Built successfully on 2026-01-12:
- `dist/PortPilot-1.6.1-x64.exe` (72 MB) - NSIS Installer
- `dist/PortPilot-1.6.1-portable.exe` (72 MB) - Portable Version
- `dist/PortPilot-1.6.1-x64.exe.blockmap` (78 KB) - Delta updates

### 4. **GitHub Actions Workflow** ✅
Created `.github/workflows/release.yml` for automated cross-platform builds:
- Triggers on version tags (e.g., `v1.6.1`)
- Builds Windows (NSIS + portable)
- Builds Linux (AppImage + .deb)
- Auto-creates GitHub release with all artifacts

### 5. **Knowledge Card Recommendations** ✅
Created `docs/KNOWLEDGE-CARDS-v1.6.1.md` with:
- "Port Card Information" card (explains new inline process details)
- "Port Actions" card (documents browser/folder/copy/kill buttons)
- Troubleshooting FAQ additions
- Implementation guide

## 📋 Next Steps

### Option A: GitHub Actions Release (Recommended)

1. **Push the v1.6.1 tag to GitHub:**
   ```bash
   git push origin master
   git push origin v1.6.1
   ```

2. **GitHub Actions will automatically:**
   - Build Windows packages
   - Build Linux packages
   - Create a GitHub release
   - Upload all 4 installers

3. **Wait ~5-10 minutes** for builds to complete

4. **Go to GitHub Releases** and verify:
   - https://github.com/m4cd4r4/PortPilot/releases/tag/v1.6.1
   - Should show all 4 files ready for download

### Option B: Manual Release (Windows Only)

If you want to release Windows-only right now:

1. **Create GitHub release manually:**
   - Go to: https://github.com/m4cd4r4/PortPilot/releases/new
   - Tag: `v1.6.1`
   - Title: `v1.6.1 - Port Card Optimisation`
   - Description: (see template below)

2. **Upload Windows files:**
   - `dist/PortPilot-1.6.1-x64.exe`
   - `dist/PortPilot-1.6.1-portable.exe`

3. **Linux builds can follow later** via GitHub Actions

## 📝 Release Notes Template

```markdown
# v1.6.1 - Port Card Optimisation

## Major Improvements

### Port Card Redesign
- **All process details visible by default** — Memory, Uptime, and Connections now display inline
- **Smart expansion** — Only expands for long command paths (>80 chars)
- **Auto-fetch on scan** — Process details load automatically, no extra clicks
- **Bind type indicators** — 🏠 (localhost only) vs 🌐 (network accessible)
- **Utility buttons** — Browser (🌐), Folder (📂), Copy (📋), Kill (✕)

### UI Refinements
- Removed Brutalist Light theme (consolidated to 5 themes)
- Removed knowledge tab icons for cleaner aesthetic
- Fixed window auto-resize calculation for 11+ apps
- Single-column port layout for better readability

### Technical Improvements
- Cross-platform process detail fetching (Windows/Linux)
- Memory usage displayed in MB
- Formatted uptime (2h 15m, 30m, 45s)
- Active connection counting
- Parallel detail loading with Promise.all

## Downloads

**Windows:**
- [PortPilot-1.6.1-x64.exe](https://github.com/m4cd4r4/PortPilot/releases/download/v1.6.1/PortPilot-1.6.1-x64.exe) - NSIS Installer (72 MB)
- [PortPilot-1.6.1-portable.exe](https://github.com/m4cd4r4/PortPilot/releases/download/v1.6.1/PortPilot-1.6.1-portable.exe) - Portable (72 MB)

**Linux:**
- [PortPilot-1.6.1-x86_64.AppImage](https://github.com/m4cd4r4/PortPilot/releases/download/v1.6.1/PortPilot-1.6.1-x86_64.AppImage) - Universal Linux (98 MB)
- [PortPilot-1.6.1-amd64.deb](https://github.com/m4cd4r4/PortPilot/releases/download/v1.6.1/PortPilot-1.6.1-amd64.deb) - Debian/Ubuntu (69 MB)

## What's Next

See [docs/KNOWLEDGE-CARDS-v1.6.1.md](docs/KNOWLEDGE-CARDS-v1.6.1.md) for recommended Knowledge tab updates to document the new features.

**Full Changelog**: https://github.com/m4cd4r4/PortPilot/compare/v1.6.0...v1.6.1
```

## 📚 Documentation Updates Needed

After release, optionally update Knowledge tab with new cards:

1. **Add "Port Card Information" card** (see `docs/KNOWLEDGE-CARDS-v1.6.1.md`)
   - Explains Memory, Uptime, Connections, PID
   - Documents 🏠/🌐 bind indicators
   - Shows v4/v6 badges

2. **Add "Port Actions" card**
   - Documents 🌐 browser button
   - Documents 📂 folder button
   - Documents 📋 copy button
   - Explains expand/collapse for long commands

3. **Update Troubleshooting FAQ**
   - Add "Why does a port show 'N/A'?" question
   - Add "What does 🏠 vs 🌐 mean?" question

See full recommendations in `docs/KNOWLEDGE-CARDS-v1.6.1.md`.

## 📊 Git Status

```
master branch: 11 commits ahead of v1.6.0
Latest commits:
  - e3e5814 docs: Convert all documentation to British English
  - 32c2467 chore: Bump version to v1.6.1
  - 77eaa3a feat: Optimise port card layout - show all info on one row
  - fc677d3 feat: Add expand/collapse all buttons for ports
  - 5865459 feat: Change ports to single-column layout
  - 574d173 feat: Add expandable port cards with process details
  - 7dfb4bc feat: Add browser and folder buttons to port cards
  - 97092f4 feat: Add bind type and IP version indicators to ports
  - f7c8b2c feat: Redesign port cards to single horizontal row
  - 463c969 chore: Remove knowledge tab icons
  - 4540364 chore: Remove Brutalist Light theme
```

Tags created:
- ✅ `v1.6.1` (includes all changes)

## 🎯 Recommendation

**Use Option A (GitHub Actions)** — Push the tag and let GitHub Actions build everything automatically. This ensures:
- Consistent cross-platform builds
- All 4 installers ready simultaneously
- Automated release creation
- Future releases are one command: `git tag v1.6.2 && git push --tags`

---

**Status**: Ready to release ✅
**Date**: 2026-01-12
**Next Action**: Push `v1.6.1` tag to trigger GitHub Actions build
