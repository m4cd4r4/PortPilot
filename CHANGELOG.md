# Changelog

All notable changes to PortPilot will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.0] - 2026-01-05

### Added
- **DevTools Setting** - Toggle to open DevTools on startup (dev mode only)
- **Process Cleanup** - Automatic cleanup after failed app starts (no more ghost "already running" errors)
- **Port Conflict Detection** - Pre-flight check and resolution dialog for port conflicts
- **Smart Startup Delay** - Visual countdown display when starting apps
- **Refresh Button** - Manual refresh for app status in My Apps tab
- **App Configuration Editing** - Add and delete apps via UI
- **Screenshot Automation** - `npm run screenshots` command for UI documentation
- **Test Infrastructure** - Test servers for 100% comprehensive test coverage

### Improved
- **Port Cards**
  - Increased padding from 8px/12px to 12px/16px for better breathing room
  - Port numbers enlarged from 1.25rem to 1.5rem for faster scanning
  - Labels (PROCESS, PID, COMMAND) now use text-secondary with 75% opacity (2x more readable)
  - Long command paths now use ellipsis truncation instead of awkward breaks
- **My Apps Tab**
  - STOPPED status badges now clearly visible (text-secondary with 80% opacity)
  - App metadata (command + port) improved visibility (text-secondary with 85% opacity)
  - App count badge ("11 apps • 5 running") larger and more prominent
- **Typography**
  - Better font weight hierarchy throughout
  - Consistent opacity levels for secondary text (75-85%)
  - Improved contrast across all themes

### Fixed
- AzurePrep monorepo configuration (npm run web instead of npm start)
- Process manager cleanup to prevent zombie process entries

### Testing
- 100% test coverage on core functionality (11/11 tests)
- 100% test coverage on v1.3.0 features (9/9 tests)
- Total: 20/20 tests passing

## [1.2.0] - 2025-12-XX

### Fixed
- Port kill functionality (critical fix)
- Port kill test now passing (11/11 comprehensive tests)

### Added
- Test for port kill functionality

## [1.1.0] - 2025-12-XX

### Added
- Initial comprehensive E2E test suite
- 11 core functionality tests covering:
  - Window and UI initialization
  - Port scanning and detection
  - Port filtering
  - Port card display
  - Copy to clipboard
  - Tab navigation
  - Settings access

### Features
- User guide and documentation
- Organized script structure
- Improved port matching logic

## [1.0.0] - 2025-12-XX

### Added
- Initial release
- Port scanning for localhost apps
- App management (start/stop)
- Multiple theme support (TokyoNight, Brutalist Dark/Light, Nord, Dracula, Solarized)
- System tray integration
- Auto-scan functionality
- Configurable scan interval
- Add/edit/delete app configurations

---

## Release Schedule

- **v1.3.0** - January 5, 2026 (Current)
- **v1.2.0** - December 2025
- **v1.1.0** - December 2025
- **v1.0.0** - December 2025

## Upgrade Guide

### From v1.2.0 to v1.3.0

No breaking changes. Config file will be automatically updated with new settings:
- `openDevTools` setting added (defaults to `false`)

All existing configurations remain compatible.

---

**Note**: For detailed testing information, see [TESTING_SUMMARY.md](TESTING_SUMMARY.md)
