# Knowledge Card Recommendations for v1.6.1

## New Cards to Add

### 1. **Port Card Information** (Insert after "Common Dev Ports" card)

**Purpose:** Explain the new inline process details added in v1.6.1

```html
<div class="knowledge-card">
  <h3>Port Card Information</h3>
  <p>Each port card displays comprehensive process information automatically:</p>
  <ul class="knowledge-list">
    <li><strong>:port</strong> — Port number in cyan (e.g., :3000)</li>
    <li><strong>🏠 / 🌐</strong> — Bind type indicator:
      <ul style="margin-left: 20px; margin-top: 4px;">
        <li>🏠 = Localhost only (127.0.0.1) — Not accessible from network</li>
        <li>🌐 = All interfaces (0.0.0.0) — Accessible from network</li>
      </ul>
    </li>
    <li><strong>v4 / v6</strong> — IP protocol version badge</li>
    <li><strong>process.exe</strong> — Process name</li>
    <li><strong>Memory</strong> — RAM usage in MB (e.g., 142 MB)</li>
    <li><strong>Uptime</strong> — How long process has been running (e.g., 2h 15m)</li>
    <li><strong>Connections</strong> — Number of active TCP connections (e.g., 3 conn)</li>
    <li><strong>PID</strong> — Process ID for advanced troubleshooting</li>
  </ul>
  <p><em>Process details are automatically fetched when you scan ports. No extra clicks needed!</em></p>
</div>
```

### 2. **Port Actions** (Insert after "Port Card Information")

**Purpose:** Document the utility buttons added in v1.6.1

```html
<div class="knowledge-card">
  <h3>Port Actions</h3>
  <p>Quick actions available for each port:</p>
  <div class="badge-reference">
    <div class="badge-item"><span class="badge-icon">🌐</span> <strong>Open in Browser</strong> — Launch localhost:PORT in default browser</div>
    <div class="badge-item"><span class="badge-icon">📂</span> <strong>Open Folder</strong> — Open directory containing the process executable</div>
    <div class="badge-item"><span class="badge-icon">📋</span> <strong>Copy</strong> — Copy "localhost:PORT" to clipboard</div>
    <div class="badge-item"><span class="badge-icon">✕</span> <strong>Kill Process</strong> — Terminate the process using this port</div>
  </div>
  <p><strong>Tip:</strong> Click any command line to expand and view the full path if it's longer than 80 characters.</p>
  <p><strong>Expand/Collapse All:</strong> Use toolbar buttons to expand or collapse all port cards at once.</p>
</div>
```

## Optional Enhancements

### 3. **Update "Troubleshooting" Card**

Add a new FAQ item about process details:

```html
<details class="faq-item">
  <summary>Why does a port show "N/A" for memory or uptime?</summary>
  <p>PortPilot couldn't retrieve process details (permission denied or process ended). The port scan shows what's listening, but extended info requires process access. Try running PortPilot as Administrator for system processes.</p>
</details>

<details class="faq-item">
  <summary>What does 🏠 vs 🌐 mean on port cards?</summary>
  <p>🏠 means the service only listens on localhost (127.0.0.1) and isn't accessible from other computers. 🌐 means it's bound to all network interfaces (0.0.0.0) and can be accessed from other devices on your network.</p>
</details>
```

### 4. **Update "IPv4 vs IPv6" Card** (Minor enhancement)

Add note about the new v4/v6 badges:

```html
<!-- After existing content -->
<p><strong>New in v1.6.1:</strong> Port cards now show v4/v6 badges inline for instant visibility.</p>
```

## Implementation Order

1. **Port Card Information** — Explains what all the new info means
2. **Port Actions** — Explains what the buttons do
3. **Troubleshooting updates** — Handles common questions about new features
4. **IPv4/IPv6 note** — Quick callout to new inline badges

## Benefits

- **Users understand new features immediately** — No guessing what Memory/Uptime/Connections mean
- **Utility button discovery** — Users learn about browser/folder/copy actions
- **Reduced support questions** — FAQ addresses common confusion about "N/A" values
- **Highlights v1.6.1 improvements** — Makes users aware of the optimisations

## Alternative: Single "What's New" Card

If you prefer minimal changes, create a single "v1.6.1 Features" card:

```html
<div class="knowledge-card">
  <h3>What's New in v1.6.1</h3>
  <p><strong>Port Card Optimisation:</strong> All process details now display inline—no expansion needed!</p>
  <ul class="knowledge-list">
    <li>🏠/🌐 indicators show localhost vs network accessibility</li>
    <li>Memory, Uptime, and Connections visible by default</li>
    <li>Browser button (🌐) opens localhost:PORT instantly</li>
    <li>Folder button (📂) opens process directory</li>
    <li>Copy button (📋) copies localhost:PORT to clipboard</li>
    <li>Expand/Collapse All toolbar buttons for quick management</li>
  </ul>
  <p><em>Long command paths (>80 chars) can be clicked to expand.</em></p>
</div>
```

---

**Recommendation:** Add cards #1 and #2 for comprehensive coverage, then optionally update Troubleshooting.
