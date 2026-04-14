# PortPilot

**Localhost Port Manager for Windows & Linux** - A desktop app for developers to manage local development ports and applications.

**[View Landing Page & Download](https://m4cd4r4.github.io/PortPilot/)**

**[MCP Integration Setup](mcp-server/README.md)**

[![Version](https://img.shields.io/badge/version-2.0.0-blue.svg)](https://github.com/m4cd4r4/PortPilot/releases/tag/v2.0.0)
[![Tests](https://img.shields.io/badge/tests-36%2F36%20passing-brightgreen.svg)](TESTING_SUMMARY.md)
[![Licence](https://img.shields.io/badge/licence-MIT-green.svg)](LICENSE)
[![MCP](https://img.shields.io/badge/MCP-enabled-purple.svg)](mcp-server/README.md)

![PortPilot](docs/portpilot-demo.gif)

---

## 📑 Table of Contents

- [✨ AI Agent Integration](#-ai-agent-integration)
- [What's New in v2.0.0](#whats-new-in-v200)
- [What's New in v1.7.0](#whats-new-in-v170)
- [Features](#features)
- [Auto Detection](#auto-detection)
- [Screenshots](#screenshots)
- [Installation](#installation)
- [Usage](#usage)
- [App Badges](#app-badges)
- [Themes](#themes)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [Testing](#testing)
- [MCP Integration](#-ai-agent-integration-mcp)
- [Tech Stack](#tech-stack)
- [Version History](#version-history)
- [Contributing](#contributing)

---

### ✨ NEW: AI Agent Integration

Control PortPilot with natural language! Works with Claude Code, Cursor, Windsurf, and any MCP-compatible AI assistant.

```
"Start the azure-practice-exam-platform app"
"What's running on port 3001?"
"Kill whatever is running on port 3000"
```

**[→ Setup MCP Integration](mcp-server/README.md)**

## What's New in v2.0.0

### Full UI Redesign

- **Single-pane unified layout** - Removed the 4-tab system (Active Ports / My Apps / Knowledge / Settings)
- **Settings moved to a slide-out panel** with backdrop blur
- **Knowledge tab removed** - documentation moved to the GitHub wiki
- **All emoji replaced** with crisp SVG icons (21 inline SVGs)
- **Glassmorphism card design** with backdrop-filter blur
- **New "Glass" theme added** (7 themes total)
- **Global search bar** filters both apps and ports simultaneously
- **App cards show running status inline** (memory, uptime, PID)

### MCP Server v2.0

- Updated from SDK 0.5.0 to 1.29.0 (was broken, now fixed)
- Rewritten with modern McpServer high-level API and Zod schemas
- **6 new tools**: `get_status`, `check_port`, `bulk_start`, `bulk_stop`, `list_groups`, `move_to_group`
- `list_apps` now includes running status inline (no separate call needed)
- **18 total tools** available

### VS Code Extension v1.2.0

- Status bar item showing "PP: N running" with click-to-refresh
- Groups rendered as collapsible tree nodes
- Full CRUD: add, edit, delete apps, change ports, toggle favourites
- Syncs with the Electron app via shared config file

## What's New in v1.7.0

### UX Improvements & International Fix

- **App Search & Filter** - Live search on the My Apps tab filters by name, command, or working directory with 150ms debounce
- **Running Apps Summary** - Header shows a live count badge ("3 running" / "all stopped") at a glance
- **Sort Options** - Sort apps by name A-Z, name Z-A, running status, or port number
- **Group Colours** - Assign a colour to each group; a matching left-border and dot appear on the group header
- **Quick Add Wizard** - 8 pre-built templates (npm dev, Vite, Next.js, Angular, Flask, FastAPI, Docker Compose, Static) pre-fill the add-app form in one click
- **Keyboard Shortcuts** - `Ctrl+F` (focus search), `Ctrl+G` (new group)
- **Rich Tray Menu** - System tray now lists each running app with a one-click Stop button; tooltip shows live app count
- **Bug fix: non-English Windows** - Port scanning now works on all Windows locales (German, French, Spanish, etc.) by checking the foreign-address column instead of matching locale-specific state strings like "ABHÖREN" or "EN ÉCOUTE"

[See full changelog →](CHANGELOG.md)

## Features

- **🔍 Search & Filter** - Live search on My Apps tab, filter by name/command/cwd
- **⬆️ Sort Options** - Sort apps by name, running status, or port
- **🎨 Group Colours** - Colour-coded groups with left-border accent
- **⚡ Quick Add** - 8 one-click templates for common project types
- **⌨️ Keyboard Shortcuts** - Ctrl+F, Ctrl+G for power users
- **🖥️ Rich Tray Menu** - Running apps listed in tray with per-app Stop buttons
- **🔍 Browse & Auto-detect** - One-click project setup with recursive scanning and package manager detection
- **⚠️ Port Conflict Warnings** - Visual warnings when unknown processes block app ports, with preview and kill options
- **🔍 Project Auto-Discovery** - Scan directories to automatically find and import dev projects (Node.js, Docker, Python, static sites)
- **⭐ Favorites** - Star frequently-used apps for quick access with collapsible sections
- **🗑 Bulk Operations** - Delete all apps at once with safety confirmations
- **Port Scanner** - Discover all active TCP ports with process details (name, PID, command line)
- **One-Click Kill** - Free up stuck ports instantly
- **App Registry** - Register your dev projects with start commands and preferred ports
- **Process Management** - Start/stop apps directly from PortPilot
- **Smart Port Matching** - Two-phase algorithm with CWD validation and keyword extraction for accurate detection
- **Requirement Badges** - Visual indicators for Docker, Node.js, Python, and more
- **Docker Integration** - Click to start Docker Desktop, with status detection
- **IPv4/IPv6 Awareness** - Shows which protocol your app is bound to
- **System Tray** - Minimize to tray, "Stop All Apps" menu option, configurable window behaviour
- **Single-Instance Lock** - Only one PortPilot runs at a time, focuses existing window
- **Multi-Theme Support** - 7 themes including TokyoNight, Brutalist, Nord, Dracula, Glass
- **VS Code Extension** - Status bar counter, collapsible groups, full CRUD from the sidebar
- **MCP v2.0 with 18 tools** - Manage your entire dev environment via any MCP-compatible AI assistant

## Auto Detection

PortPilot automatically detects 8 different languages and platforms when you use **"🔍 Browse & Auto-detect Project"** or **Project Auto-Discovery**. Detection is intelligent, framework-aware, and includes confidence scoring.

### Supported Languages & Frameworks

#### 📦 Node.js
**Detection Criteria:**
- `package.json` file present
- Package manager files: `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `bun.lockb`

**Supported Frameworks:**
- React, Next.js, Vue, Angular, Vite
- Express, Fastify, Nest.js
- Gatsby, Nuxt, SvelteKit

**Port Detection:**
- Reads `package.json` scripts for port numbers (e.g., `--port 3000`)
- Checks Vite/Next.js config files
- Checks `.env` files for `PORT` variable

**Default Values:**
- Port: 3000
- Command: Auto-detected package manager (`pnpm run dev`, `yarn dev`, `npm run dev`)
- Confidence: 90-95%

---

#### 🐍 Python
**Detection Criteria:**
- `requirements.txt`, `pyproject.toml`, or `Pipfile` present
- Python files with common framework imports

**Supported Frameworks:**
- FastAPI (port 8000)
- Django (port 8000)
- Flask (port 5000)

**Port Detection:**
- Scans Python files for `uvicorn.run()`, `app.run()` with port arguments
- Checks framework-specific config files

**Default Values:**
- Port: 8000 (FastAPI/Django), 5000 (Flask)
- Command: Framework-specific (`uvicorn main:app`, `python manage.py runserver`, `flask run`)
- Confidence: 85-90%

---

#### 🐳 Docker
**Detection Criteria:**
- `docker-compose.yml` or `docker-compose.yaml` present
- `Dockerfile` present

**Port Detection:**
- Parses `docker-compose.yml` for exposed ports
- Reads port mappings (e.g., `3000:3000`, `8080:80`)

**Default Values:**
- Port: Extracted from compose file
- Command: `docker compose up` or `docker-compose up`
- Confidence: 95%

---

#### 🔷 Go
**Detection Criteria:**
- `go.mod` file present
- `main.go` file present

**Supported Frameworks:**
- Gin (port 8080)
- Fiber (port 3000)
- Echo (port 1323)

**Port Detection:**
- Scans `go.mod` for framework dependencies
- Parses `main.go` for port literals (e.g., `:8080`)

**Default Values:**
- Port: 8080 (Gin), 3000 (Fiber), 1323 (Echo)
- Command: `go run .`
- Confidence: 80-95%

---

#### ⚙️ .NET / C#
**Detection Criteria:**
- `.csproj` file present
- `.sln` solution file present

**Supported Frameworks:**
- ASP.NET Core

**Port Detection:**
- Reads `Properties/launchSettings.json` for `applicationUrl`
- Parses port from URLs (e.g., `https://localhost:5001`)

**Default Values:**
- Port: 5000
- Command: `dotnet run`
- Confidence: 85-95%

---

#### 🦀 Rust
**Detection Criteria:**
- `Cargo.toml` file present

**Supported Frameworks:**
- Actix-web (port 8080)
- Rocket (port 8000)
- Axum (port 3000)
- Warp (port 3030)

**Port Detection:**
- Scans `Cargo.toml` dependencies for framework
- Parses `src/main.rs` for `bind()` or `listen()` with port

**Default Values:**
- Port: Framework-specific (see above)
- Command: `cargo run`
- Confidence: 85-95%

---

#### 💎 Ruby
**Detection Criteria:**
- `Gemfile` file present
- `config.ru` file present
- `Rakefile` present

**Supported Frameworks:**
- Ruby on Rails (port 3000)
- Sinatra (port 4567)
- Rack (port 9292)

**Port Detection:**
- Checks for `config/application.rb` (Rails)
- Reads `Gemfile` for framework gems

**Default Values:**
- Port: 3000 (Rails), 4567 (Sinatra), 9292 (Rack)
- Command: `rails server`, `ruby app.rb`, or `rackup`
- Confidence: 70-95%

---

#### 🌐 Static Sites
**Detection Criteria:**
- `index.html` in root directory
- No backend framework files present

**Port Detection:**
- No port needed (serves HTML directly)

**Default Values:**
- Port: N/A
- Command: N/A
- Confidence: 80%

---

### Detection Priority

Detectors run in priority order (highest to lowest):

1. **Docker** (95) - Most explicit configuration
2. **Node.js** (90) - Very common, well-structured
3. **Go** (85)
4. **.NET** (85)
5. **Rust** (85)
6. **Ruby** (85)
7. **Python** (80) - Lower due to less standardized structure
8. **Static Sites** (60) - Fallback for simple projects

If multiple detectors match, the highest-priority one wins.

### Confidence Scoring

| Score | Meaning |
|-------|---------|
| **95%+** | Exact port found in config file |
| **85-94%** | Framework detected, using framework default port |
| **70-84%** | Files detected, using language default port |
| **<70%** | Weak match, manual verification recommended |

## Screenshots

Explore all PortPilot features including app management, the Active Ports scanner, Settings panel, multiple themes, and more.

![PortPilot Features](docs/portpilot-demo.gif)

## Installation

### Download (Recommended)

**Latest Release: v2.0.0**

**Windows:**
- [PortPilot-2.0.0-x64.exe](https://github.com/m4cd4r4/PortPilot/releases/download/v2.0.0/PortPilot-2.0.0-x64.exe) - NSIS Installer (~72 MB)
- [PortPilot-2.0.0-portable.exe](https://github.com/m4cd4r4/PortPilot/releases/download/v2.0.0/PortPilot-2.0.0-portable.exe) - Portable (~72 MB)

**Linux:**
- [PortPilot-2.0.0-x86_64.AppImage](https://github.com/m4cd4r4/PortPilot/releases/download/v2.0.0/PortPilot-2.0.0-x86_64.AppImage) - Universal Linux (~98 MB)
- [PortPilot-2.0.0-amd64.deb](https://github.com/m4cd4r4/PortPilot/releases/download/v2.0.0/PortPilot-2.0.0-amd64.deb) - Debian/Ubuntu (~69 MB)

**macOS:**
- Build from source (see below) - macOS is supported but not officially tested

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

- **Yellow pulsing 🐳** - Docker Desktop is not running (click to start)
- **Green 🐳** - Docker Desktop is running and ready

### IPv4/IPv6 Indicators

When apps are running, PortPilot shows `v4` or `v6` to indicate the IP protocol:
- **v4** - Bound to IPv4 (e.g., `0.0.0.0:3000`)
- **v6** - Bound to IPv6 (e.g., `[::]:3000`)

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
| **Glass** | Translucent glassmorphism with extra transparency |

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+R` | Refresh/Scan ports |
| `Ctrl+N` | Add new app |
| `Ctrl+F` | Focus global search |
| `Ctrl+G` | New group |
| `Escape` | Close modal / Settings panel |

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
# Run all tests (36 tests)
npm run test:all

# Run core functionality tests (11 tests)
npm test

# Run groups tests (8 tests)
npm run test:groups

# Run v1.7.0 feature tests (17 tests)
npm run test:v1.7

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
- ✅ App search, sort, and filter (100%)
- ✅ Group colours and management (100%)
- ✅ Quick Add wizard (100%)
- ✅ Keyboard shortcuts (100%)
- ✅ Header running summary (100%)

**Total: 36/36 tests passing** - See [TESTING_SUMMARY.md](TESTING_SUMMARY.md) for details.

## ✨ AI Agent Integration (MCP)

PortPilot includes an MCP (Model Context Protocol) server that lets any compatible AI assistant manage your development environment with natural language.

### Compatible Tools

Works with any MCP-enabled AI assistant:
- **Claude Code** (CLI)
- **Claude Desktop**
- **Cursor**
- **Windsurf**
- **Cline**

### Setup

```bash
# Install MCP server dependencies
cd mcp-server && npm install && cd ..

# Add to Claude Code
claude mcp add portpilot -- node "C:\path\to\PortPilot\mcp-server\index.js"

# Verify connection
claude mcp list
# Should show: portpilot: ... - ✓ Connected
```

**Restart your AI tool** after adding to load the new tools.

### Example Commands

Just ask in natural language:

```
"List all my PortPilot apps"
"Start the azure-practice-exam-platform app"
"What's running on port 3001?"
"Add a new app called 'hero-concepts-preview' at C:\Scratch\azure-practice-exam-platform with command 'npm run web' on port 3001"
"Stop mocksnap"
"Kill whatever is running on port 3000"
"Delete all apps from PortPilot"
"Favorite the AzurePrep app"
```

### Available Tools

| Tool | Description |
|------|-------------|
| `list_apps` | List all registered apps with running status inline |
| `get_app` | Get details of a specific app |
| `get_status` | Get overall PortPilot status summary |
| `start_app` | Start an app by name or ID |
| `stop_app` | Stop a running app |
| `bulk_start` | Start multiple apps at once |
| `bulk_stop` | Stop multiple apps at once |
| `add_app` | Register a new app |
| `update_app` | Update app configuration |
| `delete_app` | Remove an app |
| `list_running` | Show currently running apps |
| `scan_ports` | Scan for active ports |
| `check_port` | Check what is running on a specific port |
| `kill_port` | Kill process on a port |
| `toggle_favorite` | Star/unstar an app |
| `delete_all_apps` | Remove all apps (requires confirmation) |
| `list_groups` | List all app groups |
| `move_to_group` | Move an app to a different group |

See [mcp-server/README.md](mcp-server/README.md) for full documentation.

## Tech Stack

- **Electron 27** - Cross-platform desktop framework
- **Node.js** - Process management and port scanning
- **Playwright** - End-to-end testing
- **Vanilla JS** - No framework bloat, lightweight and fast
- **CSS Variables** - Powerful theme system
- **Native Commands** - `netstat` (Windows) / `lsof` (Mac/Linux)

## Version History

### v2.0.0 (2026-04-14) - Current Release
- Full UI redesign - single-pane layout replaces 4-tab system
- Settings moved to slide-out panel with backdrop blur
- Knowledge tab removed (docs moved to GitHub wiki)
- 21 inline SVG icons replace all emoji
- Glassmorphism card design with backdrop-filter blur
- New Glass theme (7 themes total)
- Global search bar filters apps and ports simultaneously
- MCP Server v2.0 - rewritten with McpServer API and Zod schemas on SDK 1.29.0
- 6 new MCP tools (18 total): get_status, check_port, bulk_start, bulk_stop, list_groups, move_to_group
- VS Code Extension v1.2.0 - status bar, collapsible groups, full CRUD

### v1.7.0 (2026-03-25)
- App search and filter on My Apps tab
- Running apps summary badge in header
- Sort options (name, status, port)
- Group colour picker with left-border accent
- Quick Add wizard with 8 project templates
- Rich tray menu with per-app Stop buttons
- Bug fix: locale-independent port scanning (non-English Windows)

[Full changelog →](CHANGELOG.md)

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Licence

MIT © Macdara

---

**Built for developers who juggle multiple localhost apps**

🚀 [Download Latest Release](https://github.com/m4cd4r4/PortPilot/releases/latest) | 📖 [Documentation](TESTING_SUMMARY.md) | 🐛 [Report Issues](https://github.com/m4cd4r4/PortPilot/issues)
