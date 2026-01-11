# PortPilot v1.6.0 - Compact & Sharp UI + MCP Auto-Refresh + Auto-Resize Window

**Release Date:** January 11, 2026

## ✨ New Features

### 🪟 Auto-Resize Window
**No more manual window resizing!** PortPilot now automatically adjusts window height based on number of apps.

- **Smart sizing:** Automatically grows when apps added, shrinks when removed
- **Smooth animations:** Polished, non-jarring transitions
- **Works with MCP:** Window resizes automatically when MCP adds apps
- **Intelligent constraints:** Min 400px, max 1200px
- **Formula:** `Height = 200px + (2 × 30px) + (appCount × 45px)`

See [AUTO-RESIZE-FEATURE.md](AUTO-RESIZE-FEATURE.md) for full details.

---

## 🎨 Major UI Redesign: Compact & Sharp

Complete visual overhaul implementing **Option 1: Compact & Sharp** design for improved information density while maintaining excellent readability.

### Visual Changes

**Border Radius & Corners:**
- ✨ Sharp corners: `2px` border radius (was `8px`)
- ✨ Subtle rounding: `1px` small radius (was `4px`)
- Modern, clean, professional look

**Typography:**
- Base font size: `13px` (was `14px`)
- Line height: `1.3` (was `1.4`)
- App name: `0.8rem` (was `0.9rem`)
- App meta: `0.68rem` (was `0.75rem`)
- Status badges: `0.65rem` (was `0.75rem`)
- Section titles: `0.75rem` (was `0.85rem`)

**Spacing & Padding:**
- App card padding: `5px 8px` (was `8px 12px`) - **~40% reduction**
- Card gaps: `5px` (was `8px`)
- Section header padding: `6px 10px` (was `10px 14px`)
- Section margin: `15px` (was `20px`)
- Button gap: `5px` (was `8px`)

**Component Sizes:**
- App card height: `42px` (was `52px`) - **20% more compact**
- Checkbox: `16px` (was `18px`)
- Color dot: `10px` (was `12px`)
- Status badge padding: `3px 8px` (was `4px 10px`)

**Result:** ~30-40% more apps visible on screen while maintaining clarity and usability.

---

## 🔄 MCP Auto-Refresh

**No more manual refresh needed!** PortPilot now automatically detects when MCP adds or updates apps.

### How It Works

1. **File System Watcher:** ConfigStore monitors `portpilot-config.json` for external changes
2. **Debounced Reload:** 100ms debounce prevents rapid duplicate reloads
3. **Auto-Update UI:** Renderer receives event and refreshes app list automatically
4. **User Notification:** Toast appears: *"Apps list updated (external change detected)"*

### Technical Implementation

**Backend ([configStore.js:22-55](src/main/configStore.js:22-55)):**
```javascript
watchConfigFile() {
  fs.watch(this.configPath, (eventType) => {
    if (eventType === 'change') {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        this.config = this.load();
        this.mainWindow.webContents.send('config-changed', {...});
      }, 100);
    }
  });
}
```

**Frontend ([renderer.js:207-211](src/renderer/renderer.js:207-211)):**
```javascript
window.portpilot.on('config-changed', async (data) => {
  console.log('[Renderer] Config changed externally, refreshing...');
  await loadApps();
  showToast('Apps list updated (external change detected)', 'info');
});
```

**Preload Bridge ([preload.js:51](src/main/preload.js:51)):**
```javascript
const validChannels = ['trigger-scan', 'config-changed'];
```

### Benefits
- ✅ **Seamless MCP integration** - Add apps via MCP, see them instantly
- ✅ **No user action required** - Fully automatic
- ✅ **Prevents conflicts** - Debouncing handles rapid changes
- ✅ **User awareness** - Toast notification confirms update

---

## 🐛 Bug Fixes

- Fixed toast notification styles (added `.toast.info` and `.toast.warning`)

---

## 📊 Metrics

| Metric | v1.5.0 | v1.6.0 | Change |
|--------|--------|--------|--------|
| Card height | 52px | 42px | -19% |
| Base font | 14px | 13px | -7% |
| Border radius | 8px | 2px | Sharp |
| Card padding | 96px² | 40px² | -58% |
| Vertical spacing | 8px | 5px | -37% |
| Apps visible* | ~8 | ~11 | +37% |

*On standard 1080p display

---

## 🎯 Design Philosophy

**Option 1: Compact & Sharp** was chosen for its ideal balance:
- **Sharp corners** (2px) = Modern, professional aesthetic
- **Reduced padding** (~40%) = Better information density
- **Smaller fonts** (10-15%) = More data visible without strain
- **Tight spacing** (3-5px) = Efficient use of vertical space
- **Maintained readability** = All text remains crisp and clear

Alternative designs considered:
- **Current Design (v1.5):** Baseline - 8px rounded, standard padding
- **Ultra-Compact (Option 2):** Maximum density - 0px radius, 50% less padding (rejected as too cramped)

---

## 🚀 Upgrade Notes

**No breaking changes** - v1.6.0 is a visual update with enhanced MCP integration.

**What's New:**
1. Launch PortPilot to see the new Compact & Sharp UI
2. Add apps via MCP - watch them appear automatically!
3. Enjoy 30-40% more apps visible on screen

**Compatibility:**
- MCP Server: ✅ Enhanced with auto-refresh
- All features from v1.5.0: ✅ Fully compatible
- User settings: ✅ Preserved

---

## 📝 Contributors

- **UI Redesign:** Designed and implemented by Macdara + Claude Sonnet 4.5
- **MCP Integration:** Enhanced file watching system
- **Testing:** Comprehensive visual comparison mockups

---

## 🔗 Links

- **GitHub:** https://github.com/m4cd4r4/PortPilot
- **Changelog:** [CHANGELOG-v1.6.0.md](CHANGELOG-v1.6.0.md)
- **Mockups:** [mockups/](mockups/) - Visual comparison of all design options

---

**Next Release:** v1.7.0 - Feature enhancements and additional platform support
