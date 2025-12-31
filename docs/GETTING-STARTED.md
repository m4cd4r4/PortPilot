# PortPilot Getting Started Guide

## Quick Start

### Prerequisites
- [Node.js](https://nodejs.org/) 18+
- Git (optional, for cloning)

### Installation

```bash
# Clone the repository
git clone https://github.com/m4cd4r4/PortPilot.git
cd PortPilot

# Install dependencies
npm install

# Run the app
npm start
```

> **VSCode/Claude Code Users:** If you encounter module resolution errors, use `launch.bat` instead which clears the `ELECTRON_RUN_AS_NODE` environment variable.

---

## Running PortPilot

### Development Mode
```bash
npm start        # Standard launch
npm run dev      # Development mode with debug flags
```

### From File Explorer
Double-click `launch.bat` to start PortPilot.

---

## Building Installers

PortPilot uses [electron-builder](https://www.electron.build/) for packaging.

### Build Commands

| Command | Output |
|---------|--------|
| `npm run build` | Windows NSIS installer |
| `npm run build:portable` | Portable .exe (no install needed) |
| `npm run build:all` | Both installer + portable |

### Output Location

All builds are saved to the `dist/` folder:

```
dist/
├── PortPilot-1.0.0-x64.exe       # NSIS installer (~82 MB)
├── PortPilot-1.0.0-portable.exe  # Portable version (~82 MB)
├── win-unpacked/                  # Unpacked app folder
└── latest.yml                     # Auto-update manifest
```

### Windows Symlink Note

If you encounter errors about "Cannot create symbolic link" during builds, this is a Windows permission issue with the electron-builder cache. The build configuration includes `signAndEditExecutable: false` to work around this.

---

## Configuration

### App Config Location

User configuration is stored at:
- **Windows:** `%APPDATA%/portpilot/portpilot-config.json`
- **macOS:** `~/Library/Application Support/portpilot/portpilot-config.json`
- **Linux:** `~/.config/portpilot/portpilot-config.json`

### Build Configuration

Build settings are in `package.json` under the `"build"` key:

```json
{
  "build": {
    "appId": "com.macdara.portpilot",
    "productName": "PortPilot",
    "win": {
      "target": ["nsis", "portable"],
      "icon": "public/icon.png"
    },
    "nsis": {
      "oneClick": false,
      "allowToChangeInstallationDirectory": true
    }
  }
}
```

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+R` | Refresh/Scan ports |
| `Ctrl+N` | Add new app |
| `Ctrl+1` | Switch to Ports tab |
| `Ctrl+2` | Switch to Apps tab |
| `Ctrl+3` | Switch to Knowledge tab |
| `Ctrl+4` | Switch to Settings tab |
| `Escape` | Close modal |

---

## Troubleshooting

### App won't start from npm
Use `launch.bat` instead - it clears environment variables that conflict with Electron.

### Build fails with symlink errors
This is a Windows permission issue. The build config already includes a workaround (`signAndEditExecutable: false`). If issues persist, run your terminal as Administrator or enable Developer Mode in Windows Settings.

### Port scan shows nothing
No applications are using TCP ports. Start a dev server (e.g., `npm run dev` in a project) and scan again.

### Docker badge shows yellow
Docker Desktop isn't running. Click the yellow badge to start it.

---

## Project Structure

```
PortPilot/
├── src/
│   ├── main/           # Electron main process
│   │   ├── main.js         # App entry point
│   │   ├── preload.js      # Context bridge
│   │   ├── ipcHandlers.js  # IPC communication
│   │   ├── portScanner.js  # Port scanning logic
│   │   ├── processManager.js # Process start/stop
│   │   └── configStore.js  # Config persistence
│   └── renderer/       # UI (browser context)
│       ├── index.html      # App HTML
│       ├── renderer.js     # UI logic
│       └── styles.css      # Themes and styles
├── public/             # Static assets (icons)
├── docs/               # Documentation
├── dist/               # Build output (gitignored)
├── package.json        # Dependencies & build config
└── launch.bat          # Windows launcher script
```

---

## Tech Stack

- **Electron 35+** - Cross-platform desktop framework
- **Node.js** - Process management and port scanning
- **Vanilla JS** - No framework dependencies
- **CSS Variables** - Multi-theme system
- **electron-builder** - Packaging and distribution
