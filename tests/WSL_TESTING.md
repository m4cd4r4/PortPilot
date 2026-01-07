# Testing PortPilot in WSL

This guide explains how to test PortPilot's Linux version using Windows Subsystem for Linux (WSL).

## Prerequisites

### 1. Install WSL 2 (if not already installed)

```powershell
# In PowerShell as Administrator
wsl --install
# Or update to WSL 2
wsl --set-default-version 2
```

### 2. Install Ubuntu (or your preferred distro)

```powershell
wsl --install -d Ubuntu
```

### 3. Install Node.js in WSL

```bash
# In WSL terminal
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### 4. Install Build Dependencies

```bash
# Required for building Electron apps on Linux
sudo apt-get update
sudo apt-get install -y \
  build-essential \
  libgtk-3-dev \
  libnotify-dev \
  libnss3 \
  libxss1 \
  libxtst6 \
  xdg-utils \
  libatspi2.0-0 \
  libdrm2 \
  libgbm1 \
  libasound2
```

---

## Running Tests in WSL

### Option 1: Headless Mode (Recommended)

```bash
# Navigate to project (from Windows filesystem)
cd /mnt/c/Scratch/PortPilot_localhost-GUI

# Install dependencies
npm install

# Run tests in headless mode
xvfb-run npm run test

# Or run comprehensive tests
xvfb-run npm run test:all
```

**What is xvfb?**
Xvfb (X Virtual Frame Buffer) creates a virtual display, allowing GUI apps to run without a physical monitor.

### Option 2: With Display (WSLg on Windows 11)

Windows 11 includes WSLg (built-in X11/Wayland support):

```bash
cd /mnt/c/Scratch/PortPilot_localhost-GUI
npm install
npm run test  # Tests will open in a GUI window
```

### Option 3: Install Xvfb Manually (Ubuntu 20.04/22.04)

```bash
# Install Xvfb
sudo apt-get install -y xvfb

# Run tests with Xvfb
xvfb-run --auto-servernum --server-args="-screen 0 1280x1024x24" npm run test
```

---

## Building Linux Packages in WSL

```bash
# Build AppImage + .deb
npm run build:linux

# Output will be in dist/
ls -lh dist/
```

Expected output:
```
PortPilot-1.4.0-x64.AppImage
PortPilot-1.4.0-amd64.deb
```

---

## Testing the Built Package

### AppImage

```bash
# Make it executable
chmod +x dist/PortPilot-1.4.0-x64.AppImage

# Run it (with WSLg on Windows 11)
./dist/PortPilot-1.4.0-x64.AppImage

# Or with Xvfb
xvfb-run ./dist/PortPilot-1.4.0-x64.AppImage
```

### .deb Package

```bash
# Install the package
sudo dpkg -i dist/PortPilot-1.4.0-amd64.deb

# Run PortPilot
portpilot

# Uninstall if needed
sudo apt remove portpilot
```

---

## Troubleshooting

### "Cannot find module 'playwright'"

```bash
# Reinstall dependencies in WSL
npm install
```

### "DISPLAY environment variable not set"

```bash
# Use xvfb
xvfb-run npm run test

# Or set DISPLAY (if using X server)
export DISPLAY=:0
```

### "Permission denied" when running AppImage

```bash
chmod +x dist/PortPilot-1.4.0-x64.AppImage
```

### Port scanning requires sudo

On Linux, low port scanning (<1024) may require privileges:

```bash
# Run with sudo if needed
sudo npm run test
```

---

## Platform-Specific Test Notes

The test suite automatically detects the platform:

- **Windows**: Uses `netstat -ano`
- **Linux/WSL**: Uses `ss -tlnp` (fallback to `netstat -tlnp`)

You'll see platform info when tests run:

```
========================================
  PortPilot Comprehensive Test Suite
========================================
Platform: linux (x64)
Environment: WSL
========================================
```

---

## CI/CD with GitHub Actions

You can automate Linux builds with GitHub Actions:

```yaml
# .github/workflows/build.yml
name: Build

on: [push, pull_request]

jobs:
  build-linux:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: 18
      - run: npm install
      - run: xvfb-run npm run test
      - run: npm run build:linux
      - uses: actions/upload-artifact@v3
        with:
          name: linux-packages
          path: dist/*.{AppImage,deb}
```

---

## Performance Notes

**WSL Performance:**
- Reading from `/mnt/c/` (Windows filesystem) is slower than native Linux filesystem
- For best performance, clone project to `~/projects/` in WSL:

```bash
# Clone to WSL filesystem (faster)
cd ~
git clone https://github.com/m4cd4r4/PortPilot.git
cd PortPilot
npm install
npm run build:linux
```

**But** if you're actively developing on Windows, keep it on `/mnt/c/` for easier file access from both environments.
