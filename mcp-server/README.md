# PortPilot MCP Server

MCP (Model Context Protocol) server that allows Claude to manage local development servers via PortPilot.

## Features

Claude can now:
- **List apps** registered in PortPilot
- **Start/stop apps** by name or ID
- **Scan ports** to see what's running
- **Add new apps** directly to PortPilot
- **Kill processes** by port number
- **Manage favorites** and app configurations

## Installation

```bash
cd mcp-server
npm install
```

## Configuration

### Claude Code CLI (Recommended)

Add the MCP server using the Claude CLI:

```bash
# Add to current project only
claude mcp add portpilot -- node "C:\Scratch\PortPilot_localhost-GUI\mcp-server\index.js"

# Or add globally (available in all projects)
claude mcp add --scope user portpilot -- node "C:\Scratch\PortPilot_localhost-GUI\mcp-server\index.js"
```

Verify it's connected:
```bash
claude mcp list
# Should show: portpilot: node ... - ✓ Connected
```

**After adding, restart Claude Code** to load the new MCP tools.

### Permissions (if needed)

If prompted for permissions, add to `~/.claude/settings.json`:

```json
{
  "permissions": {
    "allow": ["mcp__portpilot__*"]
  }
}
```

### Note on mcp_settings.json

⚠️ **Important:** The `~/.claude/mcp_settings.json` file is NOT used by Claude Code CLI. Always use `claude mcp add` to register MCP servers.

## Available Tools

| Tool | Description |
|------|-------------|
| `list_apps` | List all registered apps |
| `get_app` | Get details of a specific app |
| `list_running` | List currently running apps with ports |
| `scan_ports` | Scan for active ports on the system |
| `start_app` | Start an app by ID or name |
| `stop_app` | Stop an app by ID or name |
| `add_app` | Register a new app in PortPilot |
| `update_app` | Update an existing app |
| `delete_app` | Remove an app from PortPilot |
| `delete_all_apps` | Delete ALL apps (requires confirm: true) |
| `kill_port` | Kill process on a specific port |
| `toggle_favorite` | Toggle favorite status |

## Example Usage (in Claude)

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

## Config File Location

PortPilot stores its config at:
- **Windows:** `%APPDATA%\PortPilot\portpilot-config.json`
- **macOS:** `~/Library/Application Support/PortPilot/portpilot-config.json`
- **Linux:** `~/.config/PortPilot/portpilot-config.json`

## Notes

- The MCP server reads/writes directly to PortPilot's config file
- Changes made via Claude will appear in PortPilot UI after refresh
- Start/stop operations work independently of PortPilot GUI
- Port scanning uses native system commands (netstat/lsof/ss)
