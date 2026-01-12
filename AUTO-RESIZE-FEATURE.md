# PortPilot v1.6.0 - Auto-Resize Window Feature

## 🎯 Feature Overview

**Auto-resize window** - The PortPilot window now automatically expands and contracts based on the number of apps, eliminating manual window resizing.

## 🚀 How It Works

### **User Experience**
- **Add apps** → Window automatically grows to accommodate
- **Remove apps** → Window automatically shrinks
- **MCP adds apps** → Window resizes instantly (works with auto-refresh!)
- **Smooth animations** → Resize is animated, not jarring
- **Smart constraints** → Min height 400px, max height 1200px

### **Technical Implementation**

#### **1. Backend Handler** ([ipcHandlers.js:349-385](src/main/ipcHandlers.js:349-385))

```javascript
ipcMain.handle('window:autoResize', async (_, appCount) => {
  // Calculate required height based on v1.6 compact design
  const BASE_HEIGHT = 200;          // Header + tabs + padding
  const APP_CARD_HEIGHT = 45;       // Card (42px) + gap (3px)
  const SECTION_HEADER_HEIGHT = 30; // Section header + margin
  const MAX_SECTIONS = 2;           // Favorites + Other Projects

  const targetHeight = Math.max(400, Math.min(1200, calculatedHeight));

  window.setBounds({ ...bounds, height: targetHeight }, true); // true = animate
});
```

#### **2. Preload Bridge** ([preload.js:68-70](src/main/preload.js:68-70))

```javascript
window: {
  autoResize: (appCount) => ipcRenderer.invoke('window:autoResize', appCount)
}
```

#### **3. Renderer Integration** ([renderer.js:472-477](src/renderer/renderer.js:472-477))

```javascript
async function loadApps() {
  // ... load apps logic

  // v1.6: Auto-resize window based on app count
  try {
    await window.portpilot.window.autoResize(state.apps.length);
  } catch (resizeError) {
    console.log('Window auto-resize skipped:', resizeError.message);
  }
}
```

---

## 📐 Height Calculation Formula

```
Total Height = BASE_HEIGHT + (SECTION_COUNT × SECTION_HEIGHT) + (APP_COUNT × CARD_HEIGHT)
```

**Variables (v1.6 Compact Design):**
- `BASE_HEIGHT`: 200px (header, tabs, padding)
- `SECTION_HEADER_HEIGHT`: 30px per section (header + margin)
- `APP_CARD_HEIGHT`: 45px per app (42px card + 3px gap)
- `MAX_SECTIONS`: 2 (Favorites + Other Projects)

**Constraints:**
- `MIN_HEIGHT`: 400px (always readable)
- `MAX_HEIGHT`: 1200px (prevents excessive height)

### **Examples**

| Apps | Calculation | Final Height |
|------|-------------|--------------|
| 0 apps | 200 + 60 + 0 = 260px | **400px** (min) |
| 5 apps | 200 + 60 + 225 = 485px | **485px** |
| 10 apps | 200 + 60 + 450 = 710px | **710px** |
| 15 apps | 200 + 60 + 675 = 935px | **935px** |
| 25 apps | 200 + 60 + 1125 = 1385px | **1200px** (max) |

---

## 🎨 Integration with v1.6 Features

### **Works Seamlessly With:**

1. **Compact & Sharp UI**
   - Uses v1.6 card height (42px) instead of old 52px
   - Tighter gaps (3px) for accurate calculations
   - Sharper sizing based on actual rendered dimensions

2. **MCP Auto-Refresh**
   - MCP adds app → config-changed event → loadApps() → auto-resize!
   - No user action needed - completely automatic
   - Smooth UX: app appears + window grows in one fluid motion

3. **Discovery & Import**
   - Discover 10 projects → Add all → Window grows automatically
   - Multi-select bulk add → Resizes once after all added

### **Trigger Points**

Auto-resize is called whenever apps change:
- ✅ Initial app load (DOMContentLoaded)
- ✅ Manual refresh (Refresh button)
- ✅ Add app (via modal or MCP)
- ✅ Delete app
- ✅ Delete all apps
- ✅ Import apps from file
- ✅ External config change (MCP)

---

## 🧪 Testing

### **Manual Test Scenarios**

1. **Add apps incrementally**
   ```
   Start with 3 apps → Notice compact window
   Add 5 more apps → Window grows smoothly
   Add 10 more apps → Window grows to accommodate
   ```

2. **Delete apps**
   ```
   Start with 15 apps → Window at ~935px
   Delete 10 apps → Window shrinks to ~485px
   Delete all → Window shrinks to 400px (min)
   ```

3. **MCP integration**
   ```
   PortPilot running with 5 apps
   Use MCP: mcp__portpilot__add_app
   Watch: App appears + window resizes automatically
   ```

4. **Constraints**
   ```
   Add 30+ apps → Window stops at 1200px (max)
   Still scrollable if more apps than fit
   ```

### **Edge Cases Handled**

- **No apps:** Falls back to min height (400px)
- **Excessive apps:** Caps at max height (1200px) + scroll
- **Window not found:** Silent fail with console log
- **Resize error:** Gracefully caught, doesn't break app load

---

## 🎯 Benefits

### **User Experience**
- ✅ **Zero manual resizing** - Window always fits content
- ✅ **Smooth animations** - Not jarring or abrupt
- ✅ **Smart constraints** - Never too small or too large
- ✅ **Works with MCP** - Automatic when MCP adds apps
- ✅ **Responsive** - Adapts to any number of apps

### **Developer Experience**
- ✅ **Simple API** - Just call `autoResize(appCount)`
- ✅ **Automatic** - Integrated into loadApps() flow
- ✅ **Failsafe** - Silent catch prevents breaking app
- ✅ **Performant** - Single calculation, single resize

---

## 🔧 Configuration Options (Future)

**Potential User Settings:**
- `autoResize`: true/false (enable/disable feature)
- `minHeight`: 400 (customisable min)
- `maxHeight`: 1200 (customisable max)
- `animateResize`: true/false (smooth vs instant)

**Not implemented yet** - could be added in v1.7.0 if requested.

---

## 📝 Implementation Notes

### **Why Smooth Animations?**
```javascript
window.setBounds({ ...bounds, height: targetHeight }, true);
//                                                      ^^^^
//                                                      animate flag
```
The `true` parameter enables Electron's built-in smooth resize animation, making the experience polished and professional.

### **Why Silent Fail on Resize Error?**
```javascript
try {
  await window.portpilot.window.autoResize(state.apps.length);
} catch (resizeError) {
  console.log('Window auto-resize skipped:', resizeError.message);
}
```
Window resizing is a **UX enhancement**, not a critical feature. If it fails (e.g., window closed, permissions issue), the app still loads fine - just without automatic resizing.

### **Why Calculate vs. Measure?**
We **calculate** height instead of measuring actual DOM because:
1. **Faster** - No DOM queries or layout recalculations
2. **Predictable** - Consistent sizing regardless of render timing
3. **Reliable** - Works before DOM is fully painted

---

## 🎉 Result

**Before v1.6:**
- User adds 10 apps → Manually drags window bigger
- User deletes 5 apps → Window too big, manually shrinks
- MCP adds app → Window doesn't adjust

**After v1.6:**
- User adds 10 apps → Window automatically grows ✨
- User deletes 5 apps → Window automatically shrinks ✨
- MCP adds app → Auto-refresh + auto-resize ✨✨

---

**Feature Status:** ✅ **IMPLEMENTED & READY**
**Version:** 1.6.0
**Implementation Date:** January 11, 2026
