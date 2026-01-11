# PortPilot v1.6.0 - Compact UI & MCP Auto-Refresh

## 🎨 Compact & Sharp UI Redesign

**30-40% More Density** - See more apps and ports without scrolling
- Sharp 2px corners (modern, clean aesthetic)
- Tighter spacing throughout
- Compact port cards with Process+PID on one line
- Smaller fonts for better information density

![Port Cards Comparison](screenshots/05-port-cards-closeup.png)

## 🔄 MCP Auto-Refresh

**External Changes Detected Automatically**
- File watcher monitors config for changes (100ms debounce)
- Toast notifications when apps list updates
- No restart required when MCP adds apps
- Seamless integration with AI assistants

## 📐 Smart Window Auto-Resize

**Dynamic Height Based on Content**
- Window grows/shrinks based on number of apps
- 400px minimum, 1200px maximum
- No wasted space, no excessive scrolling
- Works seamlessly with MCP auto-refresh

## 🧪 Enhanced Testing

**100% Test Coverage** - All 11 E2E tests passing
- Integrated test HTTP servers (ports 3000, 3001, 8080)
- Test mode support (singleton lock bypass)
- Improved reliability with better wait strategies
- Fixed visibility issues with `scrollIntoViewIfNeeded`

## 🐛 Bug Fixes

- **Critical:** Fixed ConfigStore null reference crash on startup
- **Tests:** All 11 E2E tests now passing reliably
- **Load Strategy:** Improved app initialization wait logic

## 📦 Installation

### Windows
- **Installer:** `PortPilot-1.6.0-x64.exe` (72 MB)
- **Portable:** `PortPilot-1.6.0-portable.exe` (72 MB)

### Linux
- **AppImage:** `PortPilot-1.6.0-x86_64.AppImage` (98 MB)
- **Debian/Ubuntu:** `PortPilot-1.6.0-amd64.deb` (69 MB)

## 🔗 Links

- [Landing Page](https://m4cd4r4.github.io/PortPilot/)
- [Full Changelog](CHANGELOG-v1.6.0.md)
- [MCP Integration Guide](mcp-server/README.md)

---

**Full Changelog**: https://github.com/m4cd4r4/PortPilot/compare/v1.5.0...v1.6.0
