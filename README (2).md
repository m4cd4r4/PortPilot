# 🚀 PortPilot

A lightweight Electron app to manage localhost ports and development apps.

## Features

- **Port Scanner** - See all active ports, which processes are using them, and kill them with one click
- **App Registry** - Register your dev apps with preferred ports and fallback ranges
- **Quick Actions** - Start/stop apps, kill port conflicts, copy localhost URLs
- **System Tray** - Minimize to tray, quick scan from context menu
- **Persistent Config** - Your apps and settings are saved locally

## Installation

```bash
# Clone or download
cd portpilot

# Install dependencies
npm install

# Run
npm start
```

## Usage

### Scan Ports
Click "Scan Ports" to discover all listening TCP ports. You'll see:
- Port number
- Process name
- PID
- Command line (Windows)

Click the ❌ button to kill any process.

### Register Apps
1. Click "Add App"
2. Fill in:
   - **Name**: Display name (e.g., "AzurePrep Frontend")
   - **Command**: Start command (e.g., `npm run dev`)
   - **Working Directory**: Project folder path
   - **Preferred Port**: The port your app should use
   - **Fallback Range**: Alternative ports if preferred is taken (e.g., `3001-3010`)
3. Click "Save App"

Now you can start/stop your apps directly from PortPilot.

### Config Location

Your config is stored at:
- **Windows**: `%APPDATA%/portpilot/portpilot-config.json`
- **macOS**: `~/Library/Application Support/portpilot/portpilot-config.json`
- **Linux**: `~/.config/portpilot/portpilot-config.json`

## Example Config

```json
{
  "apps": [
    {
      "id": "app_123",
      "name": "AzurePrep Frontend",
      "command": "npm run dev",
      "cwd": "C:\\Projects\\azureprep\\frontend",
      "preferredPort": 3000,
      "fallbackRange": [3001, 3010],
      "color": "#3B82F6"
    },
    {
      "id": "app_456",
      "name": "InvestigAI API",
      "command": "func start",
      "cwd": "C:\\Projects\\investigai\\api",
      "preferredPort": 7071
    }
  ],
  "settings": {
    "autoScan": true,
    "scanInterval": 5000
  }
}
```

## Keyboard Shortcuts

- **Ctrl+R** / **Cmd+R**: Refresh/Scan ports
- **Ctrl+N** / **Cmd+N**: Add new app
- **Escape**: Close modal

## Building for Production

```bash
# Install electron-builder
npm install --save-dev electron-builder

# Add to package.json scripts:
# "dist": "electron-builder"

# Build
npm run dist
```

## Tech Stack

- Electron 28
- Vanilla JavaScript (no framework dependencies)
- Native port scanning via `netstat`/`lsof`/`ss`
- JSON file storage

## License

MIT
