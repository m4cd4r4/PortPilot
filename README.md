# PortPilot

**Localhost Port Manager for Windows & Linux** — A desktop app for developers to manage local development ports and applications.

🌐 **[View Landing Page & Download](https://m4cd4r4.github.io/PortPilot/)** 🌐

[![Version](https://img.shields.io/badge/version-1.5.0-blue.svg)](https://github.com/m4cd4r4/PortPilot/releases/tag/v1.5.0)
[![Tests](https://img.shields.io/badge/tests-20%2F20%20passing-brightgreen.svg)](TESTING_SUMMARY.md)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

![PortPilot](docs/screenshots/03-apps-tab.png)

## ✨ What's New in v1.5.0

### 🐧 Linux Platform Support
- **Cross-Platform Builds** — Now officially supports Windows AND Linux
- **AppImage Package** — Universal Linux binary that runs on any distro (98 MB)
- **.deb Package** — Native Debian/Ubuntu installer (69 MB)
- **WSL Testing** — Full testing support in Windows Subsystem for Linux
- **Platform Auto-Detection** — Automatically adapts commands for Windows/Linux

### 🖥️ System Tray & Window Behavior
- **Stop All Apps from Tray** — Right-click tray icon to stop all PortPilot-managed apps without quitting
- **Configurable Window Behavior** — Choose whether close button minimizes to tray or exits completely
- **Smart Process Cleanup** — Optionally stop all apps when quitting (only affects PortPilot-managed processes)
- **External Process Safety** — Never touches processes started outside PortPilot

### 🔒 Single-Instance Lock
- **One Instance Only** — Prevents multiple copies of PortPilot from running simultaneously
- **Smart Window Focusing** — Launching a second instance automatically focuses the existing window
- **No More Confusion** — Single system tray icon, clear state management

[See full changelog →](CHANGELOG.md)


## ✨ What's New in v1.4.0

### 🔍 Browse & Auto-detect Project
- **One-Click Project Setup** — Click "Browse & Auto-detect" in Add App modal to automatically configure any project
- **Recursive Scanning** — Finds projects up to 2 levels deep in subdirectories
- **Package Manager Detection** — Auto-detects pnpm, yarn, or npm and uses the correct command
- **Smart Port Detection** — Only uses explicit port config (no more "everything gets port 3000")
- **Works with Monorepos** — Finds the actual project inside parent folders (e.g., `manual-build/` inside root)

### ⚠️ Port Conflict Warnings
- **Unknown Process Detection** — Warns when unknown processes block your app's preferred port
- **🌐 Preview Button** — Click globe to see what's running on the blocked port
- **Kill Blocker Button** — Terminate blocking processes with one click
- **Toast Notifications** — Visual warnings when port conflicts are detected
- **Improved Matching** — Two-phase algorithm with keyword extraction prevents false positives

### 🔍 Project Auto-Discovery
- **Automatic Project Detection** — Scan your project directories to automatically discover Node.js, Docker, Python, and static site projects
- **Smart Metadata Extraction** — Automatically detects project names, start commands, and ports
- **User-Configurable Paths** — Add your own scan directories (e.g., `C:\Projects`, `C:\Dev`)
- **Confidence Scoring** — Shows match confidence (95%, 85%, etc.) for each discovered project
- **Bulk Import** — Add all discovered projects at once or pick individual ones
- **Scan Depth Control** — Configure how deep to search (1-5 directory levels)

### ⭐ Favorites System
- **Star Your Apps** — Click the star (⭐/☆) button to mark frequently-used apps as favorites
- **Organized Sections** — Apps automatically organized into:
  - **⭐ Favorites** — Starred apps at the top for quick access
  - **📁 Other Projects** — Non-starred apps below
- **Collapsible Sections** — Click section headers to expand/collapse
- **Persistent State** — Section collapse state saved across app restarts

### 🗑 Delete All
- **Bulk Delete** — Remove all apps in one click with "Delete All" button
- **Safety First** — Strong confirmation modal warns before deletion
- **Export Reminder** — Prompts to export config before deleting

[See full changelog →](CHANGELOG.md)

## Features

- **🔍 Browse & Auto-detect** — One-click project setup with recursive scanning and package manager detection
- **⚠️ Port Conflict Warnings** — Visual warnings when unknown processes block app ports, with preview and kill options
- **🔍 Project Auto-Discovery** — Scan directories to automatically find and import dev projects (Node.js, Docker, Python, static sites)
- **⭐ Favorites** — Star frequently-used apps for quick access with collapsible sections
- **🗑 Bulk Operations** — Delete all apps at once with safety confirmations
- **Port Scanner** — Discover all active TCP ports with process details (name, PID, command line)
- **One-Click Kill** — Free up stuck ports instantly
- **App Registry** — Register your dev projects with start commands and preferred ports
- **Process Management** — Start/stop apps directly from PortPilot
- **Smart Port Matching** — Two-phase algorithm with CWD validation and keyword extraction for accurate detection
- **Requirement Badges** — Visual indicators for Docker, Node.js, Python, and more
- **Docker Integration** — Click to start Docker Desktop, with status detection
- **IPv4/IPv6 Awareness** — Shows which protocol your app is bound to
- **System Tray** — Minimize to tray, "Stop All Apps" menu option, configurable window behavior
- **Single-Instance Lock** — Only one PortPilot runs at a time, focuses existing window
- **Multi-Theme Support** — 6 themes including TokyoNight, Brutalist, Nord, Dracula
- **Knowledge Base** — Built-in help with tips, shortcuts, and common ports reference

## Screenshots

### My Apps
Register and manage your development applications with automatic status detection and favorites.

![My Apps](docs/screenshots/03-apps-tab.png)

### Active Ports
Scan and view all listening TCP ports with improved readability.

![Active Ports](docs/screenshots/01-ports-tab.png)

### Knowledge Base
Built-in documentation with System Tray guide, shortcuts, and troubleshooting.

![Knowledge](docs/screenshots/05-knowledge-tab.png)

### Settings
Choose from 6 themes, configure window behavior, auto-scan, and more.

![Settings](docs/screenshots/06-settings-tab.png)

### Dark Theme
Brutalist Dark theme with high contrast and bold design.

![Dark Theme](docs/screenshots/07-brutalist-dark-theme.png)

## Installation

### Download (Recommended)

**Latest Release: v1.5.0** 🐧

> 🎉 **v1.5.0 adds Linux support!** Build from source or download pre-built packages (coming soon to GitHub Releases)

**Windows:**
- [PortPilot-1.4.0-x64.exe](https://github.com/m4cd4r4/PortPilot/releases/download/v1.4.0/PortPilot-1.4.0-x64.exe) — NSIS Installer (v1.4.0)
- [PortPilot-1.4.0-portable.exe](https://github.com/m4cd4r4/PortPilot/releases/download/v1.4.0/PortPilot-1.4.0-portable.exe) — Portable (v1.4.0)
- Build v1.5.0 from source for latest features

**Linux:** 🆕
- Build AppImage + .deb from source (see instructions below)
- Pre-built packages coming soon to GitHub Releases

### Build from Source

```bash
# Clone the repo
git clone https://github.com/m4cd4r4/PortPilot.git
cd PortPilot

# Install dependencies
npm install

# Run the app
npm start

# Build for your platform
npm run build              # Windows (NSIS installer)
npm run build:linux        # Linux (AppImage + .deb)
npm run build:all-platforms  # Both Windows and Linux
```

> **Note for VSCode/Claude Code users:** The app automatically clears the `ELECTRON_RUN_AS_NODE` environment variable via `launch.js`.

## Usage

### Scan Ports
Click "Scan Ports" to discover all listening TCP ports. You'll see:
- Port number (large and prominent!)
- Process name
- PID
- Command line (with clean ellipsis for long paths)

Click the ❌ button to kill any process.

### Register Apps

#### Option 1: Auto-detect (Recommended)
1. Click "Add App"
2. Click **"🔍 Browse & Auto-detect Project"**
3. Select your project folder (e.g., `C:\Scratch\MyApp`)
4. PortPilot automatically fills in:
   - **Name** from package.json
   - **Command** with the correct package manager (`pnpm run dev`, `yarn dev`, `npm run dev`)
   - **Working Directory** path
   - **Preferred Port** from config files (if found)
5. Review and edit if needed
6. Click "Save App"

#### Option 2: Manual Entry
1. Click "Add App"
2. Fill in:
   - **Name**: Display name (e.g., "AzurePrep Frontend")
   - **Command**: Start command (e.g., `npm run dev`)
   - **Working Directory**: Project folder path
   - **Preferred Port**: The port your app should use (or leave blank to assign later)
   - **Fallback Range**: Alternative ports if preferred is taken (e.g., `3001-3010`)
3. Click "Save App"

Now you can start/stop your apps directly from PortPilot with visual countdown feedback!

### Handle Port Conflicts
When a port is blocked by an unknown process:
1. You'll see **"⚠️ Port Blocked"** status on the app card
2. Click **🌐 Globe button** to preview what's running on that port
3. Click **"Kill Blocker"** to terminate the blocking process
4. Click **"Start"** to launch your app

## App Badges

PortPilot automatically detects app requirements and shows badges:

| Badge | Meaning | Detected When |
|-------|---------|---------------|
| 🐳 | Docker app | Command includes `docker` or `compose` |
| 📦 | Node.js app | Command includes `npm`, `npx`, `pnpm`, `yarn`, or `bun` |
| 🐍 | Python app | Command includes `python`, `uvicorn`, `flask`, or `django` |
| 🗄️ | Database | Command includes `postgres`, `mysql`, `redis`, or `mongo` |
| ⚡ | Auto-start | App configured to start on launch |
| 🌐 | Remote | App runs on remote server/VPS |

### Docker Integration

- **Yellow pulsing 🐳** — Docker Desktop is not running (click to start)
- **Green 🐳** — Docker Desktop is running and ready

### IPv4/IPv6 Indicators

When apps are running, PortPilot shows `v4` or `v6` to indicate the IP protocol:
- **v4** — Bound to IPv4 (e.g., `0.0.0.0:3000`)
- **v6** — Bound to IPv6 (e.g., `[::]:3000`)

This ensures the browser button opens the correct URL.

## Themes

| Theme | Description |
|-------|-------------|
| **TokyoNight** | Dark blue with cyan/magenta accents (default) |
| **Brutalist Dark** | Pure black, yellow/cyan, monospace |
| **Brutalist Light** | White with black borders, yellow highlights |
| **Nord** | Cool arctic blues |
| **Dracula** | Purple/pink dark theme |
| **Solarized Light** | Warm, easy on the eyes |

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+R` | Refresh/Scan ports |
| `Ctrl+N` | Add new app |
| `Ctrl+1` | Ports tab |
| `Ctrl+2` | Apps tab |
| `Ctrl+3` | Knowledge tab |
| `Ctrl+4` | Settings tab |
| `Escape` | Close modal |

## Config Location

Your config is stored at:
- **Windows**: `%APPDATA%/portpilot/portpilot-config.json`
- **macOS**: `~/Library/Application Support/portpilot/portpilot-config.json`
- **Linux**: `~/.config/portpilot/portpilot-config.json`

## Example Config

```json
{
  "apps": [
    {
      "id": "app_azureprep",
      "name": "AzurePrep",
      "command": "npm run web",
      "cwd": "C:\\Scratch\\azure-practice-exam-platform",
      "preferredPort": 3001,
      "fallbackRange": [3002, 3010],
      "color": "#84CC16",
      "autoStart": false
    }
  ],
  "settings": {
    "autoScan": true,
    "scanInterval": 5000,
    "openDevTools": false
  }
}
```

## Development

```bash
# Install dependencies
npm install

# Run in development
npm start

# Run in dev mode (with DevTools if enabled)
npm run dev

# Run all tests
npm run test:all

# Take screenshots
npm run screenshots

# Build installers
npm run build:all
```

## Testing

PortPilot includes a comprehensive Playwright E2E test suite with **100% test coverage**.

```bash
# Run all tests (20 tests)
npm run test:all

# Run core functionality tests (11 tests)
npm test

# Run v1.3.0 feature tests (9 tests)
npm run test:v1.3

# Generate UI screenshots
npm run screenshots
```

**Test Coverage:**
- ✅ UI rendering and navigation (100%)
- ✅ Port scanning functionality (100%)
- ✅ Port filtering (100%)
- ✅ Port killing (100%)
- ✅ Process cleanup (100%)
- ✅ Settings persistence (100%)
- ✅ DevTools toggling (100%)
- ✅ App configuration editing (100%)

**Total: 20/20 tests passing** — See [TESTING_SUMMARY.md](TESTING_SUMMARY.md) for details.

## Tech Stack

- **Electron 27** — Cross-platform desktop framework
- **Node.js** — Process management and port scanning
- **Playwright** — End-to-end testing
- **Vanilla JS** — No framework bloat, lightweight and fast
- **CSS Variables** — Powerful theme system
- **Native Commands** — `netstat` (Windows) / `lsof` (Mac/Linux)

## Version History

### v1.4.0 (2026-01-06) — Current Release
- 🔍 **Browse & Auto-detect** — One-click project setup with recursive scanning
- 📦 **Package Manager Detection** — Auto-detects pnpm, yarn, npm
- ⚠️ **Port Conflict Warnings** — Visual warnings with preview and kill options
- 🔍 **Project Auto-Discovery** — Bulk scan and import projects
- ⭐ **Favorites System** — Star apps for quick access
- 🗑 **Delete All** — Bulk delete with safety confirmations
- ✨ **Improved Port Matching** — Two-phase algorithm with keyword extraction
- ✨ **Smart Port Detection** — No more hard-coded framework defaults

### v1.3.0 (2026-01-05)
- 7 new features (DevTools, process cleanup, port conflict detection, etc.)
- 7 UI/UX improvements (larger port numbers, better spacing, improved readability)
- 100% test coverage (20/20 tests passing)
- Comprehensive documentation (CHANGELOG.md, TESTING_SUMMARY.md)

### v1.2.0
- Fixed port kill functionality
- Added comprehensive test suite

### v1.1.0
- Initial release with core features
- Multi-theme support
- App registry and management

[Full changelog →](CHANGELOG.md)

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT © Macdara

---

**Built for developers who juggle multiple localhost apps**

🚀 [Download Latest Release](https://github.com/m4cd4r4/PortPilot/releases/latest) | 📖 [Documentation](TESTING_SUMMARY.md) | 🐛 [Report Issues](https://github.com/m4cd4r4/PortPilot/issues)
