# PortPilot User Guide

**Complete guide to using PortPilot for managing your development environment**

---

## Table of Contents

1. [What is PortPilot?](#what-is-portpilot)
2. [Getting Started](#getting-started)
3. [Managing Active Ports](#managing-active-ports)
4. [Managing Your Apps](#managing-your-apps)
5. [Understanding Badges and Indicators](#understanding-badges-and-indicators)
6. [Docker Integration](#docker-integration)
7. [Customization](#customization)
8. [Keyboard Shortcuts](#keyboard-shortcuts)
9. [Common Workflows](#common-workflows)
10. [Troubleshooting](#troubleshooting)
11. [Tips & Best Practices](#tips--best-practices)

---

## What is PortPilot?

PortPilot is a desktop application designed to simplify port and process management for developers. If you've ever encountered these frustrations:

- "Port 3000 is already in use"
- Forgetting which terminal has your app running
- Manually typing `netstat` or `lsof` commands
- Struggling to kill stubborn processes
- Managing multiple local dev servers

PortPilot solves these problems with a clean, visual interface that lets you:
- See all active ports at a glance
- Kill processes with one click
- Start/stop your apps from one place
- Automatically detect running applications
- Manage Docker containers and services

---

## Getting Started

### First Launch

1. **Launch PortPilot** using your preferred method:
   - Double-click the desktop shortcut
   - Run `npm start` from the project directory
   - Execute `launch.bat` or `launch.js`

2. **Initial View**: You'll see four main tabs at the top:
   - **Active Ports** - Shows all listening TCP ports
   - **My Apps** - Your registered development applications
   - **Knowledge** - Built-in help and reference
   - **Settings** - Customize themes and preferences

3. **First Scan**: Click the "Scan Ports" button (or press `Ctrl+R`) to discover what's running on your machine.

### Understanding the Interface

Each tab serves a specific purpose:

- **Active Ports**: Real-time view of network activity
- **My Apps**: Your command center for starting/stopping projects
- **Knowledge**: Quick reference for common ports, troubleshooting tips, and shortcuts
- **Settings**: Theme selection and auto-scan configuration

---

## Managing Active Ports

### Scanning for Active Ports

**Purpose**: Discover which ports are currently in use and by what processes.

**How to scan:**

1. Click the **"Active Ports"** tab (or press `Ctrl+1`)
2. Click the **"Scan Ports"** button (or press `Ctrl+R`)
3. Wait for the scan to complete (usually 1-2 seconds)

**What you'll see:**

Each port entry shows:
- **Port Number** (e.g., 3000, 5432)
- **Process Name** (e.g., node.exe, postgres.exe)
- **PID** (Process ID)
- **Command Line** (full command that started the process - Windows only)
- **Kill Button** (❌) to terminate the process

### Filtering Ports

Use the search box at the top to filter ports by:
- Port number (e.g., "3000")
- Process name (e.g., "node")
- PID (e.g., "12345")

**Example**: Type "node" to see only Node.js processes.

### Killing a Process

**Warning**: Killing a process will immediately terminate it. Make sure you've saved any work first.

**Steps:**

1. Scan for active ports
2. Find the port/process you want to kill
3. Click the red ❌ button next to it
4. Confirm in the dialog that appears
5. The process will be terminated immediately

**Common use case**: Freeing up port 3000 when you get "port already in use" errors.

### Auto-Scan

Enable auto-scan in Settings to have PortPilot automatically refresh the port list every few seconds. This is useful for monitoring active development.

**To enable:**
1. Go to **Settings** tab (`Ctrl+4`)
2. Toggle **"Auto-scan ports"**
3. Ports will refresh every 5 seconds by default

---

## Managing Your Apps

The **My Apps** tab is where PortPilot really shines. Register your development projects once, then start/stop them with a single click.

### Adding a New App

1. Click the **"My Apps"** tab (`Ctrl+2`)
2. Click the **"Add App"** button (`Ctrl+N`)
3. Fill in the app details:

   **Required fields:**
   - **Name**: A friendly name for your app (e.g., "AzurePrep Frontend")
   - **Command**: The command to start your app (e.g., `npm run dev`)
   - **Working Directory**: Absolute path to your project folder
   - **Preferred Port**: The port your app typically uses (e.g., 3000)

   **Optional fields:**
   - **Fallback Range**: Alternative ports if preferred is taken (e.g., `3001-3010`)
   - **Color**: Custom color for the app card (click the color picker)

4. Click **"Save App"**

### Example: Adding a React App

```
Name: My React App
Command: npm run dev
Working Directory: C:\Projects\my-react-app
Preferred Port: 5173
Fallback Range: 5174-5180
Color: (choose a blue shade)
```

### Example: Adding a Python FastAPI App

```
Name: FastAPI Backend
Command: uvicorn main:app --reload
Working Directory: /Users/you/projects/api
Preferred Port: 8000
Fallback Range: 8001-8010
Color: (choose a green shade)
```

### Starting an App

1. Find your app card in the **My Apps** tab
2. Click the **"Start"** button
3. PortPilot will:
   - Open a terminal in the working directory
   - Execute your start command
   - Monitor the preferred port
   - Automatically detect when the app is running
4. The card will show:
   - **Running** status badge
   - **Open in Browser** button (🌐)
   - **IPv4/IPv6 indicator** (v4 or v6)
   - **Stop** button

### Stopping an App

1. Click the **"Stop"** button on a running app card
2. The process will be terminated
3. The card returns to "Not Running" state

### Editing an App

1. Click the **⚙️ (gear)** icon on the app card
2. Modify any fields
3. Click **"Save Changes"**

### Deleting an App

1. Click the **⚙️ (gear)** icon on the app card
2. Scroll to the bottom
3. Click **"Delete App"**
4. Confirm the deletion

---

## Understanding Badges and Indicators

PortPilot automatically detects what type of app you're running based on the start command.

### App Type Badges

| Badge | Type | Detected When | Example Command |
|-------|------|---------------|-----------------|
| 🐳 | Docker | Command includes `docker`, `docker-compose`, or `compose` | `docker-compose up` |
| 📦 | Node.js | Command includes `npm`, `npx`, `pnpm`, `yarn`, or `bun` | `npm run dev` |
| 🐍 | Python | Command includes `python`, `uvicorn`, `flask`, or `django` | `uvicorn main:app` |
| 🗄️ | Database | Command includes `postgres`, `mysql`, `redis`, or `mongo` | `redis-server` |
| ⚡ | Auto-start | App is configured to start when PortPilot launches | (set in app config) |
| 🌐 | Remote | App runs on a remote server/VPS | (manually flagged) |

### Status Indicators

- **Running** (green badge) - App is currently running
- **Not Running** (gray badge) - App is stopped
- **Port in Use** (yellow badge) - Preferred port is occupied by another process

### IP Protocol Indicators

When an app is running, you'll see either:
- **v4** - App is bound to IPv4 (e.g., `0.0.0.0:3000`)
- **v6** - App is bound to IPv6 (e.g., `[::]:3000`)

This ensures the "Open in Browser" button uses the correct URL.

---

## Docker Integration

PortPilot includes smart Docker Desktop integration.

### Docker Status Detection

The Docker badge (🐳) shows the current status:

- **Yellow pulsing 🐳** - Docker Desktop is not running
  - **Action**: Click the badge to attempt to start Docker Desktop

- **Green 🐳** - Docker Desktop is running and ready
  - **Action**: You can now start Docker-based apps

### Starting Docker Desktop

If you try to start a Docker app but Docker Desktop isn't running:

1. PortPilot will show a yellow pulsing Docker badge
2. Click the badge to launch Docker Desktop
3. Wait for Docker to start (usually 30-60 seconds)
4. The badge will turn green when ready
5. Now you can start your Docker apps

### Docker App Examples

```
Name: PostgreSQL Database
Command: docker-compose up postgres
Working Directory: C:\Projects\my-app
Preferred Port: 5432
```

```
Name: Full Stack Docker
Command: docker-compose up
Working Directory: /home/user/project
Preferred Port: 3000
```

---

## Customization

### Themes

PortPilot offers 6 carefully designed themes:

1. **TokyoNight** (default)
   - Dark blue background
   - Cyan and magenta accents
   - Great for long coding sessions

2. **Brutalist Dark**
   - Pure black background
   - Yellow and cyan highlights
   - Monospace font throughout
   - High contrast, no-nonsense design

3. **Brutalist Light**
   - White background
   - Black borders and text
   - Yellow highlights
   - Minimalist, functional

4. **Nord**
   - Cool arctic color palette
   - Blues and teals
   - Easy on the eyes

5. **Dracula**
   - Popular purple and pink theme
   - Dark background
   - Vibrant colors

6. **Solarized Light**
   - Warm, scientifically designed palette
   - Light background
   - Gentle on the eyes

**To change themes:**

1. Go to **Settings** tab (`Ctrl+4`)
2. Click on a theme name to preview
3. Your choice is saved automatically

### System Tray

PortPilot can minimize to the system tray (Windows) or menu bar (macOS).

**To minimize to tray:**
- Click the minimize button
- PortPilot will hide but continue running in the background

**To restore from tray:**
- Click the PortPilot icon in the system tray
- Or right-click and select "Show PortPilot"

**To quit from tray:**
- Right-click the tray icon
- Select "Quit PortPilot"

---

## Keyboard Shortcuts

Master these shortcuts to use PortPilot efficiently:

| Shortcut | Action | When to Use |
|----------|--------|-------------|
| `Ctrl+R` | Refresh/Scan ports | Check what's currently running |
| `Ctrl+N` | Add new app | Register a new project |
| `Ctrl+1` | Switch to Active Ports tab | View network activity |
| `Ctrl+2` | Switch to My Apps tab | Manage your applications |
| `Ctrl+3` | Switch to Knowledge tab | Look up common ports or tips |
| `Ctrl+4` | Switch to Settings tab | Change theme or preferences |
| `Escape` | Close modal/dialog | Cancel current operation |

**Pro tip**: Use `Ctrl+1` and `Ctrl+R` together to quickly jump to Active Ports and scan in one motion.

---

## Common Workflows

### Workflow 1: Starting Your Daily Development Environment

**Scenario**: You have 3 apps you always run together (frontend, backend, database).

**Setup** (one-time):

1. Register all three apps in **My Apps**:
   - Frontend (React on port 3000)
   - Backend (FastAPI on port 8000)
   - Database (PostgreSQL on port 5432)

2. Enable auto-start for these apps (optional):
   - Edit each app
   - Toggle "Start on launch"

**Daily workflow**:

1. Open PortPilot
2. Go to **My Apps** (`Ctrl+2`)
3. Click "Start" on each app (or they'll auto-start)
4. Click "Open in Browser" when ready

**Benefit**: No more remembering commands or opening multiple terminals.

---

### Workflow 2: Debugging Port Conflicts

**Scenario**: You get "Error: Port 3000 is already in use" when starting your app.

**Steps**:

1. Open PortPilot
2. Go to **Active Ports** (`Ctrl+1`)
3. Click **Scan Ports** (`Ctrl+R`)
4. Type "3000" in the search box
5. Find the process using port 3000
6. Click the ❌ button to kill it
7. Restart your app

**Benefit**: Solved in 10 seconds instead of googling netstat commands.

---

### Workflow 3: Managing Multiple Projects

**Scenario**: You work on 5 different projects throughout the week.

**Setup**:

1. Register all 5 projects in **My Apps**
2. Assign each a unique color and port
3. Add descriptive names

**Daily workflow**:

1. Open PortPilot
2. See at a glance which projects are running
3. Stop inactive projects to free up resources
4. Start the project you're currently working on

**Benefit**: Visual dashboard of your entire dev environment.

---

### Workflow 4: Testing with Different Ports

**Scenario**: You need to test your app on multiple ports simultaneously.

**Steps**:

1. Register your app with fallback ports (e.g., 3000-3005)
2. Start the app 3 times:
   - First instance will use 3000
   - Second instance will use 3001
   - Third instance will use 3002
3. Use the "Open in Browser" button for each
4. Test all instances
5. Stop all when done

**Benefit**: Easy parallel testing without manual port management.

---

## Troubleshooting

### Issue: Port scan returns no results

**Possible causes:**
- No applications are currently listening on TCP ports
- Firewall is blocking PortPilot's scan

**Solutions:**
1. Start a known application (like a web browser or local dev server)
2. Scan again
3. Check if Windows Firewall or antivirus is blocking PortPilot

---

### Issue: Can't kill a process

**Possible causes:**
- Process requires administrator privileges
- Process is protected by the system

**Solutions:**
1. Run PortPilot as administrator:
   - Right-click the shortcut
   - Select "Run as administrator"
2. Try killing the process manually:
   - Open Task Manager (Ctrl+Shift+Esc)
   - Find the process
   - End task

---

### Issue: App won't start

**Possible causes:**
- Incorrect working directory
- Command has syntax errors
- Dependencies not installed
- Port already in use

**Solutions:**

1. **Check the working directory**:
   - Right-click the app card
   - Verify the path exists
   - Make sure it's an absolute path (e.g., `C:\Projects\my-app`)

2. **Test the command manually**:
   - Open a terminal
   - Navigate to the working directory
   - Run the command manually
   - Fix any errors

3. **Check port availability**:
   - Go to Active Ports
   - Scan for the preferred port
   - Kill any conflicting process

4. **Verify dependencies**:
   - Make sure `npm install` or equivalent has been run
   - Check that required services (Docker, databases) are running

---

### Issue: Docker apps won't start

**Possible causes:**
- Docker Desktop is not running
- Docker Compose file is misconfigured
- Insufficient permissions

**Solutions:**

1. **Start Docker Desktop**:
   - Click the yellow pulsing Docker badge
   - Wait for Docker to start
   - Retry starting the app

2. **Check Docker Compose**:
   - Verify `docker-compose.yml` exists in the working directory
   - Test command manually: `docker-compose up`

3. **Check permissions**:
   - Make sure your user is in the `docker-users` group (Windows)
   - On macOS/Linux, verify Docker socket permissions

---

### Issue: Can't find my config file

**Config locations:**

- **Windows**:
  ```
  C:\Users\YourName\AppData\Roaming\portpilot\portpilot-config.json
  ```
  Quick access: Press `Win+R`, type `%APPDATA%\portpilot`, press Enter

- **macOS**:
  ```
  ~/Library/Application Support/portpilot/portpilot-config.json
  ```

- **Linux**:
  ```
  ~/.config/portpilot/portpilot-config.json
  ```

**To reset config:**
1. Close PortPilot
2. Delete the config file
3. Restart PortPilot (a new default config will be created)

---

### Issue: App status not detecting automatically

**Possible causes:**
- Port scan interval is too long
- App takes time to start listening on the port
- App is using a different port than expected

**Solutions:**

1. **Enable auto-scan**:
   - Settings → Enable "Auto-scan ports"
   - Set a shorter interval (3-5 seconds)

2. **Wait for app to fully start**:
   - Some apps take 10-30 seconds to start listening
   - Watch the terminal output
   - Manually scan once app is ready

3. **Check actual port**:
   - Look at your app's terminal output
   - Verify which port it's actually using
   - Update the "Preferred Port" if different

---

## Tips & Best Practices

### 1. Use Descriptive Names

Instead of:
- "App 1", "App 2", "Test"

Use:
- "AzurePrep Frontend", "BlogAPI Backend", "Local PostgreSQL"

**Why**: You'll immediately know what each app is when glancing at the dashboard.

---

### 2. Color-Code Your Apps

Assign colors based on:
- **Project**: All apps from the same project use the same color family
- **Type**: Frontend apps = blue, Backend = green, Databases = purple
- **Status**: Prod apps = red, Dev apps = blue, Test apps = yellow

**Why**: Visual organization makes it easier to find apps quickly.

---

### 3. Set Up Fallback Ports

Always define a fallback range (e.g., `3001-3010`) for your apps.

**Why**: If you accidentally start an app twice, the second instance will use a fallback port instead of failing.

---

### 4. Use the Knowledge Tab

The Knowledge tab includes:
- Common port reference (which services use which ports)
- Keyboard shortcuts
- Troubleshooting tips

**Tip**: Press `Ctrl+3` anytime you need quick help.

---

### 5. Enable Auto-Scan During Active Development

When actively coding:
- Turn on auto-scan
- Set interval to 3-5 seconds
- Keep the Active Ports tab visible

When not actively developing:
- Turn off auto-scan to reduce CPU usage

---

### 6. Use System Tray for Quick Access

Minimize PortPilot to the tray instead of closing it. This way:
- It's always one click away
- Apps keep running in the background
- You can quickly check port status without reopening

---

### 7. Backup Your Config

Your app configurations are valuable. Periodically backup:
```
%APPDATA%\portpilot\portpilot-config.json  (Windows)
~/Library/Application Support/portpilot/portpilot-config.json  (macOS)
~/.config/portpilot/portpilot-config.json  (Linux)
```

Store it in your dotfiles repo or cloud storage.

---

### 8. Group Related Apps

If you have multiple apps that work together (e.g., frontend + backend + database), use similar names:

- **AzurePrep - Frontend**
- **AzurePrep - API**
- **AzurePrep - Database**

This keeps them visually grouped when sorted alphabetically.

---

### 9. Test Commands Before Adding

Before registering a new app:
1. Open a terminal
2. Navigate to the working directory
3. Test the start command manually
4. Make sure it works
5. Then add it to PortPilot

**Why**: Easier to debug command issues in a regular terminal first.

---

### 10. Use Absolute Paths

Always use absolute paths for working directories:

✅ **Good**:
- `C:\Projects\my-app`
- `/home/user/projects/my-app`

❌ **Bad**:
- `../my-app`
- `./project`

**Why**: Relative paths can break depending on where PortPilot is launched from.

---

## Advanced Tips

### Tip: Run Multiple Instances of the Same App

Register the same app multiple times with different ports:

```
Name: API Server (Port 8000)
Command: uvicorn main:app --port 8000
Preferred Port: 8000

Name: API Server (Port 8001)
Command: uvicorn main:app --port 8001
Preferred Port: 8001
```

**Use case**: Load testing or comparing different versions.

---

### Tip: Chain Commands

Use `&&` to chain multiple commands:

```
Command: npm install && npm run dev
```

**Use case**: Ensure dependencies are installed before starting.

---

### Tip: Environment Variables

Include environment variables in your command:

**Windows (CMD)**:
```
Command: set NODE_ENV=development && npm start
```

**macOS/Linux**:
```
Command: NODE_ENV=development npm start
```

---

### Tip: Custom Scripts

Instead of long commands, create a script file:

**Example**: Create `start.sh` in your project:
```bash
#!/bin/bash
export NODE_ENV=development
npm run db:migrate
npm run dev
```

Then in PortPilot:
```
Command: ./start.sh
```

---

## Getting Help

- **In-app help**: Press `Ctrl+3` to open the Knowledge tab
- **GitHub Issues**: [github.com/m4cd4r4/PortPilot/issues](https://github.com/m4cd4r4/PortPilot/issues)
- **README**: See the main [README.md](../README.md) for technical details

---

## Summary

PortPilot transforms port and process management from a frustrating chore into a streamlined workflow. By centralizing your development environment in one visual dashboard, you spend less time fighting with ports and more time building your projects.

**Key takeaways**:
- Scan ports to see what's running
- Register apps for one-click start/stop
- Use badges and colors for visual organization
- Master keyboard shortcuts for efficiency
- Enable auto-scan during active development

Happy coding with PortPilot! 🚀
