const fs = require('fs');
const path = require('path');

// Read the markdown user guide to extract sections
const mdPath = path.join(__dirname, '../docs/USER_GUIDE.md');
const htmlPath = path.join(__dirname, '../docs/user-guide.html');

const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>PortPilot - Complete User Guide</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        :root {
            --primary: #7aa2f7; --primary-dark: #5a82d7; --secondary: #bb9af7;
            --success: #9ece6a; --warning: #e0af68; --danger: #f7768e;
            --bg: #1a1b26; --bg-light: #24283b; --bg-lighter: #414868;
            --text: #c0caf5; --text-dim: #9aa5ce; --border: #414868;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', sans-serif;
            line-height: 1.6; color: var(--text); background: var(--bg);
        }
        .container {
            max-width: 1400px; margin: 0 auto; display: grid;
            grid-template-columns: 280px 1fr; gap: 2rem; padding: 2rem;
        }
        header {
            grid-column: 1 / -1; text-align: center; padding: 3rem 0;
            background: linear-gradient(135deg, var(--primary-dark) 0%, var(--secondary) 100%);
            border-radius: 12px; margin-bottom: 2rem;
        }
        header h1 { font-size: 3rem; color: white; margin-bottom: 0.5rem; text-shadow: 2px 2px 4px rgba(0,0,0,0.3); }
        header .subtitle { font-size: 1.2rem; color: rgba(255,255,255,0.9); }
        nav {
            position: sticky; top: 2rem; height: fit-content;
            background: var(--bg-light); border-radius: 12px; padding: 1.5rem;
            border: 1px solid var(--border);
        }
        nav h2 {
            font-size: 1rem; color: var(--primary); text-transform: uppercase;
            letter-spacing: 1px; margin-bottom: 1rem; padding-bottom: 0.5rem;
            border-bottom: 2px solid var(--border);
        }
        nav ul { list-style: none; }
        nav ul li { margin-bottom: 0.5rem; }
        nav a {
            color: var(--text-dim); text-decoration: none; display: block;
            padding: 0.5rem; border-radius: 6px; transition: all 0.2s; font-size: 0.9rem;
        }
        nav a:hover { color: var(--primary); background: var(--bg-lighter); transform: translateX(4px); }
        nav a.active { color: var(--primary); background: var(--bg-lighter); font-weight: 600; }
        main {
            background: var(--bg-light); border-radius: 12px; padding: 3rem;
            border: 1px solid var(--border);
        }
        section { margin-bottom: 4rem; scroll-margin-top: 2rem; }
        h2 {
            font-size: 2rem; color: var(--primary); margin-bottom: 1rem;
            padding-bottom: 0.5rem; border-bottom: 2px solid var(--border);
        }
        h3 { font-size: 1.5rem; color: var(--secondary); margin: 2rem 0 1rem 0; }
        h4 { font-size: 1.2rem; color: var(--success); margin: 1.5rem 0 0.75rem 0; }
        p { margin-bottom: 1rem; color: var(--text); }
        ul, ol { margin-left: 2rem; margin-bottom: 1rem; }
        li { margin-bottom: 0.5rem; color: var(--text); }
        .screenshot {
            margin: 2rem 0; border-radius: 8px; overflow: hidden;
            border: 2px solid var(--border); box-shadow: 0 4px 20px rgba(0,0,0,0.3);
        }
        .screenshot img { width: 100%; display: block; }
        .screenshot-caption {
            background: var(--bg-lighter); padding: 1rem; font-size: 0.9rem;
            color: var(--text-dim); text-align: center;
        }
        code {
            background: var(--bg); color: var(--warning); padding: 0.2rem 0.4rem;
            border-radius: 4px; font-family: 'Courier New', monospace; font-size: 0.9em;
        }
        pre {
            background: var(--bg); border: 1px solid var(--border);
            border-radius: 8px; padding: 1.5rem; overflow-x: auto; margin: 1rem 0;
        }
        pre code { background: transparent; padding: 0; color: var(--text); }
        table {
            width: 100%; border-collapse: collapse; margin: 1.5rem 0;
            background: var(--bg); border-radius: 8px; overflow: hidden;
        }
        th {
            background: var(--primary); color: white; padding: 1rem;
            text-align: left; font-weight: 600;
        }
        td { padding: 1rem; border-bottom: 1px solid var(--border); }
        tr:last-child td { border-bottom: none; }
        tr:hover { background: var(--bg-lighter); }
        .badge {
            display: inline-block; padding: 0.3rem 0.8rem; border-radius: 20px;
            font-size: 0.85rem; font-weight: 600; margin-right: 0.5rem;
        }
        .badge.success { background: var(--success); color: var(--bg); }
        .info-box {
            padding: 1.5rem; border-radius: 8px; margin: 1.5rem 0; border-left: 4px solid;
        }
        .info-box.tip { background: rgba(158, 206, 106, 0.1); border-color: var(--success); }
        .info-box.warning { background: rgba(224, 175, 104, 0.1); border-color: var(--warning); }
        .info-box.info { background: rgba(122, 162, 247, 0.1); border-color: var(--primary); }
        .info-box strong { color: var(--primary); display: block; margin-bottom: 0.5rem; }
        .workflow-card {
            background: var(--bg); border: 1px solid var(--border);
            border-radius: 8px; padding: 1.5rem; margin: 1.5rem 0;
        }
        .workflow-card h4 { margin-top: 0; color: var(--primary); }
        kbd {
            background: var(--bg); border: 1px solid var(--border); border-radius: 4px;
            padding: 0.2rem 0.5rem; font-family: monospace; font-size: 0.9em;
            box-shadow: 0 2px 4px rgba(0,0,0,0.2);
        }
        footer {
            grid-column: 1 / -1; text-align: center; padding: 2rem;
            color: var(--text-dim); border-top: 1px solid var(--border); margin-top: 3rem;
        }
        @media (max-width: 1024px) {
            .container { grid-template-columns: 1fr; }
            nav { position: relative; top: 0; }
        }
        html { scroll-behavior: smooth; }
        a { color: var(--primary); text-decoration: none; }
        a:hover { color: var(--secondary); text-decoration: underline; }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>🚀 PortPilot</h1>
            <p class="subtitle">Complete User Guide - Localhost Port Manager for Developers</p>
        </header>

        <nav>
            <h2>Table of Contents</h2>
            <ul>
                <li><a href="#what-is">What is PortPilot?</a></li>
                <li><a href="#getting-started">Getting Started</a></li>
                <li><a href="#managing-ports">Managing Active Ports</a></li>
                <li><a href="#managing-apps">Managing Your Apps</a></li>
                <li><a href="#badges">Badges & Indicators</a></li>
                <li><a href="#docker">Docker Integration</a></li>
                <li><a href="#customization">Customization</a></li>
                <li><a href="#shortcuts">Keyboard Shortcuts</a></li>
                <li><a href="#workflows">Common Workflows</a></li>
                <li><a href="#troubleshooting">Troubleshooting</a></li>
                <li><a href="#tips">Tips & Best Practices</a></li>
            </ul>
        </nav>

        <main>
            <section id="what-is">
                <h2>What is PortPilot?</h2>
                <p>PortPilot is a desktop application designed to simplify port and process management for developers. If you've ever encountered these frustrations:</p>
                <ul>
                    <li>"Port 3000 is already in use"</li>
                    <li>Forgetting which terminal has your app running</li>
                    <li>Manually typing <code>netstat</code> or <code>lsof</code> commands</li>
                    <li>Struggling to kill stubborn processes</li>
                    <li>Managing multiple local dev servers</li>
                </ul>
                <p>PortPilot solves these problems with a clean, visual interface!</p>

                <div class="screenshot">
                    <img src="screenshots/guide/01-my-apps.png" alt="PortPilot My Apps Dashboard">
                    <div class="screenshot-caption">My Apps Dashboard - Your command center for managing development applications</div>
                </div>
            </section>

            <section id="getting-started">
                <h2>Getting Started</h2>
                <h3>First Launch</h3>
                <ol>
                    <li><strong>Launch PortPilot</strong> using your preferred method</li>
                    <li><strong>Initial View</strong>: You'll see four main tabs at the top</li>
                    <li><strong>First Scan</strong>: Click the "Scan Ports" button (or press <kbd>Ctrl+R</kbd>)</li>
                </ol>

                <div class="info-box tip">
                    <strong>💡 Pro Tip:</strong>
                    Use <kbd>Ctrl+1</kbd>, <kbd>Ctrl+2</kbd>, <kbd>Ctrl+3</kbd>, and <kbd>Ctrl+4</kbd> to quickly switch between tabs!
                </div>
            </section>

            <section id="managing-ports">
                <h2>Managing Active Ports</h2>

                <div class="screenshot">
                    <img src="screenshots/guide/02-active-ports.png" alt="Active Ports Scanner">
                    <div class="screenshot-caption">Active Ports - Real-time view of all listening TCP ports</div>
                </div>

                <h3>Scanning for Active Ports</h3>
                <p><strong>Purpose:</strong> Discover which ports are currently in use and by what processes.</p>

                <h3>Filtering Ports</h3>
                <div class="screenshot">
                    <img src="screenshots/guide/03-port-filter.png" alt="Port Filtering">
                    <div class="screenshot-caption">Filter ports by port number, process name, or PID</div>
                </div>

                <p>Use the search box at the top to filter ports by port number, process name, or PID.</p>

                <div class="info-box info">
                    <strong>Example:</strong>
                    Type "node" to see only Node.js processes.
                </div>

                <h3>Killing a Process</h3>
                <div class="info-box warning">
                    <strong>⚠️ Warning:</strong>
                    Killing a process will immediately terminate it. Make sure you've saved any work first.
                </div>
                <p><strong>Common use case:</strong> Freeing up port 3000 when you get "port already in use" errors.</p>
            </section>

            <section id="managing-apps">
                <h2>Managing Your Apps</h2>

                <p>The <strong>My Apps</strong> tab is where PortPilot really shines. Register your development projects once, then start/stop them with a single click.</p>

                <h3>Adding a New App</h3>
                <div class="screenshot">
                    <img src="screenshots/guide/04-add-app-modal.png" alt="Add App Modal">
                    <div class="screenshot-caption">Add App Modal - Register your development projects with start commands and ports</div>
                </div>

                <table>
                    <thead>
                        <tr>
                            <th>Field</th>
                            <th>Description</th>
                            <th>Example</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td><strong>Name</strong></td>
                            <td>A friendly name for your app</td>
                            <td>"AzurePrep Frontend"</td>
                        </tr>
                        <tr>
                            <td><strong>Command</strong></td>
                            <td>The command to start your app</td>
                            <td><code>npm run dev</code></td>
                        </tr>
                        <tr>
                            <td><strong>Working Directory</strong></td>
                            <td>Absolute path to your project folder</td>
                            <td><code>C:\\Projects\\my-app</code></td>
                        </tr>
                        <tr>
                            <td><strong>Preferred Port</strong></td>
                            <td>The port your app typically uses</td>
                            <td>3000</td>
                        </tr>
                    </tbody>
                </table>

                <h3>App with Automatic Detection</h3>
                <div class="screenshot">
                    <img src="screenshots/guide/09-app-badges.png" alt="App Badges">
                    <div class="screenshot-caption">Automatic detection of app type with visual badges (Docker 🐳, Node.js 📦, Python 🐍)</div>
                </div>
            </section>

            <section id="badges">
                <h2>Understanding Badges and Indicators</h2>

                <p>PortPilot automatically detects what type of app you're running based on the start command.</p>

                <table>
                    <thead>
                        <tr>
                            <th>Badge</th>
                            <th>Type</th>
                            <th>Detected When</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td>🐳</td>
                            <td>Docker</td>
                            <td>Command includes <code>docker</code> or <code>compose</code></td>
                        </tr>
                        <tr>
                            <td>📦</td>
                            <td>Node.js</td>
                            <td>Command includes <code>npm</code>, <code>yarn</code>, etc.</td>
                        </tr>
                        <tr>
                            <td>🐍</td>
                            <td>Python</td>
                            <td>Command includes <code>python</code>, <code>uvicorn</code></td>
                        </tr>
                        <tr>
                            <td>🗄️</td>
                            <td>Database</td>
                            <td>Command includes <code>postgres</code>, <code>mysql</code></td>
                        </tr>
                    </tbody>
                </table>
            </section>

            <section id="docker">
                <h2>Docker Integration</h2>

                <p>PortPilot includes smart Docker Desktop integration with status detection.</p>

                <h3>Docker Status</h3>
                <ul>
                    <li><strong>Yellow pulsing 🐳</strong> - Docker Desktop is not running (click to start)</li>
                    <li><strong>Green 🐳</strong> - Docker Desktop is running and ready</li>
                </ul>
            </section>

            <section id="customization">
                <h2>Customization</h2>

                <div class="screenshot">
                    <img src="screenshots/guide/06-settings.png" alt="Settings and Themes">
                    <div class="screenshot-caption">Settings - Choose from 6 beautiful themes</div>
                </div>

                <h3>Themes</h3>
                <p>PortPilot offers 6 carefully designed themes:</p>

                <h4>Brutalist Dark</h4>
                <div class="screenshot">
                    <img src="screenshots/guide/07-theme-brutalist.png" alt="Brutalist Theme">
                    <div class="screenshot-caption">Brutalist Dark - Pure black with yellow highlights, high contrast design</div>
                </div>

                <h4>Nord</h4>
                <div class="screenshot">
                    <img src="screenshots/guide/08-theme-nord.png" alt="Nord Theme">
                    <div class="screenshot-caption">Nord - Cool arctic color palette with blues and teals</div>
                </div>

                <table>
                    <thead>
                        <tr>
                            <th>Theme</th>
                            <th>Description</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td><strong>TokyoNight</strong> (default)</td>
                            <td>Dark blue background with cyan and magenta accents</td>
                        </tr>
                        <tr>
                            <td><strong>Brutalist Dark</strong></td>
                            <td>Pure black with yellow/cyan highlights, monospace font</td>
                        </tr>
                        <tr>
                            <td><strong>Brutalist Light</strong></td>
                            <td>White background with black borders, minimalist</td>
                        </tr>
                        <tr>
                            <td><strong>Nord</strong></td>
                            <td>Cool arctic blues and teals</td>
                        </tr>
                        <tr>
                            <td><strong>Dracula</strong></td>
                            <td>Popular purple and pink theme</td>
                        </tr>
                        <tr>
                            <td><strong>Solarized Light</strong></td>
                            <td>Warm, scientifically designed palette</td>
                        </tr>
                    </tbody>
                </table>
            </section>

            <section id="shortcuts">
                <h2>Keyboard Shortcuts</h2>

                <div class="screenshot">
                    <img src="screenshots/guide/05-knowledge.png" alt="Knowledge Base">
                    <div class="screenshot-caption">Knowledge Base - Built-in help with shortcuts and common ports reference</div>
                </div>

                <table>
                    <thead>
                        <tr>
                            <th>Shortcut</th>
                            <th>Action</th>
                            <th>When to Use</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td><kbd>Ctrl+R</kbd></td>
                            <td>Refresh/Scan ports</td>
                            <td>Check what's currently running</td>
                        </tr>
                        <tr>
                            <td><kbd>Ctrl+N</kbd></td>
                            <td>Add new app</td>
                            <td>Register a new project</td>
                        </tr>
                        <tr>
                            <td><kbd>Ctrl+1</kbd></td>
                            <td>Switch to Active Ports tab</td>
                            <td>View network activity</td>
                        </tr>
                        <tr>
                            <td><kbd>Ctrl+2</kbd></td>
                            <td>Switch to My Apps tab</td>
                            <td>Manage your applications</td>
                        </tr>
                        <tr>
                            <td><kbd>Ctrl+3</kbd></td>
                            <td>Switch to Knowledge tab</td>
                            <td>Look up common ports or tips</td>
                        </tr>
                        <tr>
                            <td><kbd>Ctrl+4</kbd></td>
                            <td>Switch to Settings tab</td>
                            <td>Change theme or preferences</td>
                        </tr>
                        <tr>
                            <td><kbd>Escape</kbd></td>
                            <td>Close modal/dialog</td>
                            <td>Cancel current operation</td>
                        </tr>
                    </tbody>
                </table>

                <div class="info-box tip">
                    <strong>💡 Pro Tip:</strong>
                    Use <kbd>Ctrl+1</kbd> and <kbd>Ctrl+R</kbd> together to quickly jump to Active Ports and scan in one motion.
                </div>
            </section>

            <section id="workflows">
                <h2>Common Workflows</h2>

                <div class="workflow-card">
                    <h4>Workflow 1: Starting Your Daily Development Environment</h4>
                    <p><strong>Scenario:</strong> You have 3 apps you always run together (frontend, backend, database).</p>
                    <p><span class="badge success">Benefit</span> No more remembering commands or opening multiple terminals.</p>
                </div>

                <div class="workflow-card">
                    <h4>Workflow 2: Debugging Port Conflicts</h4>
                    <p><strong>Scenario:</strong> You get "Error: Port 3000 is already in use" when starting your app.</p>
                    <p><span class="badge success">Benefit</span> Solved in 10 seconds instead of googling netstat commands.</p>
                </div>

                <div class="workflow-card">
                    <h4>Workflow 3: Managing Multiple Projects</h4>
                    <p><strong>Scenario:</strong> You work on 5 different projects throughout the week.</p>
                    <p><span class="badge success">Benefit</span> Visual dashboard of your entire dev environment.</p>
                </div>
            </section>

            <section id="troubleshooting">
                <h2>Troubleshooting</h2>

                <h3>Issue: Port scan returns no results</h3>
                <p><strong>Solutions:</strong></p>
                <ol>
                    <li>Start a known application (like a web browser or local dev server)</li>
                    <li>Scan again</li>
                    <li>Check if Windows Firewall or antivirus is blocking PortPilot</li>
                </ol>

                <h3>Issue: Can't kill a process</h3>
                <p><strong>Solutions:</strong></p>
                <ol>
                    <li>Run PortPilot as administrator</li>
                    <li>Try killing the process manually via Task Manager</li>
                </ol>

                <h3>Config File Locations</h3>
                <pre><code>Windows: %APPDATA%\\portpilot\\portpilot-config.json
macOS: ~/Library/Application Support/portpilot/portpilot-config.json
Linux: ~/.config/portpilot/portpilot-config.json</code></pre>
            </section>

            <section id="tips">
                <h2>Tips & Best Practices</h2>

                <h3>1. Use Descriptive Names</h3>
                <p><strong>Use:</strong> "AzurePrep Frontend", "BlogAPI Backend", "Local PostgreSQL"</p>
                <p><strong>Why:</strong> You'll immediately know what each app is when glancing at the dashboard.</p>

                <h3>2. Color-Code Your Apps</h3>
                <p>Assign colors based on project, type, or status for visual organization.</p>

                <h3>3. Set Up Fallback Ports</h3>
                <p>Always define a fallback range (e.g., <code>3001-3010</code>) for your apps.</p>

                <h3>4. Use the Knowledge Tab</h3>
                <div class="info-box tip">
                    <strong>Tip:</strong> Press <kbd>Ctrl+3</kbd> anytime you need quick help.
                </div>

                <h3>5. Enable Auto-Scan During Active Development</h3>
                <p>Turn on auto-scan and set interval to 3-5 seconds for real-time monitoring.</p>
            </section>

            <div class="info-box info" style="margin-top: 3rem;">
                <strong>🚀 Summary</strong>
                <p>PortPilot transforms port and process management from a frustrating chore into a streamlined workflow. By centralizing your development environment in one visual dashboard, you spend less time fighting with ports and more time building your projects.</p>
                <p><strong>Key takeaways:</strong></p>
                <ul>
                    <li>Scan ports to see what's running</li>
                    <li>Register apps for one-click start/stop</li>
                    <li>Use badges and colors for visual organization</li>
                    <li>Master keyboard shortcuts for efficiency</li>
                    <li>Enable auto-scan during active development</li>
                </ul>
                <p style="margin-top: 1rem;"><strong>Happy coding with PortPilot! 🎉</strong></p>
            </div>
        </main>

        <footer>
            <p>PortPilot - Localhost Port Manager for Developers</p>
            <p><a href="https://github.com/m4cd4r4/PortPilot">GitHub Repository</a> | <a href="../README.md">Technical README</a> | <a href="index.html">Landing Page</a></p>
            <p>Made with ❤️ by <a href="https://github.com/m4cd4r4">m4cd4r4</a></p>
        </footer>
    </div>

    <script>
        // Smooth scroll to sections
        document.querySelectorAll('nav a').forEach(link => {
            link.addEventListener('click', function(e) {
                e.preventDefault();
                const targetId = this.getAttribute('href').substring(1);
                const targetSection = document.getElementById(targetId);

                if (targetSection) {
                    targetSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    document.querySelectorAll('nav a').forEach(l => l.classList.remove('active'));
                    this.classList.add('active');
                }
            });
        });

        // Highlight active section on scroll
        const sections = document.querySelectorAll('section');
        const navLinks = document.querySelectorAll('nav a');

        window.addEventListener('scroll', () => {
            let current = '';
            sections.forEach(section => {
                const sectionTop = section.offsetTop;
                if (pageYOffset >= sectionTop - 200) {
                    current = section.getAttribute('id');
                }
            });

            navLinks.forEach(link => {
                link.classList.remove('active');
                if (link.getAttribute('href') === '#' + current) {
                    link.classList.add('active');
                }
            });
        });
    </script>
</body>
</html>`;

fs.writeFileSync(htmlPath, html, 'utf8');

console.log('✅ HTML User Guide created successfully!');
console.log('📄 Location: docs/user-guide.html');
console.log('🌐 Open in browser: file:///' + path.resolve(htmlPath).replace(/\\/g, '/'));
