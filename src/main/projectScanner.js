const fs = require('fs').promises;
const path = require('path');

/**
 * ProjectScanner - Detects development projects in filesystem
 * Supports Node.js, Docker, Python, and Static sites
 */

// ============ Project Detectors ============

class ProjectDetector {
  constructor(name, priority) {
    this.name = name;
    this.priority = priority;
  }

  async detect(dirPath) {
    throw new Error('detect() must be implemented');
  }
}

class NodeDetector extends ProjectDetector {
  constructor() {
    super('Node.js', 100);
  }

  async detect(dirPath) {
    const packagePath = path.join(dirPath, 'package.json');

    try {
      const exists = await fileExists(packagePath);
      if (!exists) return null;

      const content = await fs.readFile(packagePath, 'utf8');
      const pkg = JSON.parse(content);

      // Detect package manager
      let packageManager = 'npm';
      if (pkg.packageManager) {
        // Extract manager name from "pnpm@8.15.0" format
        packageManager = pkg.packageManager.split('@')[0];
      } else {
        // Check for lock files
        if (await fileExists(path.join(dirPath, 'pnpm-lock.yaml'))) {
          packageManager = 'pnpm';
        } else if (await fileExists(path.join(dirPath, 'yarn.lock'))) {
          packageManager = 'yarn';
        }
      }

      // Determine which script to use - enhanced for monorepos
      let scriptName = null;

      if (pkg.scripts) {
        // Check if this is a monorepo
        const isMonorepo = pkg.workspaces ||
                          Object.values(pkg.scripts).some(script =>
                            script.includes('workspace') || script.includes('--filter'));

        if (isMonorepo) {
          // Prioritize common monorepo entry point scripts
          const monorepoScripts = ['web', 'app', 'frontend', 'client', 'main', 'dev', 'start'];
          for (const script of monorepoScripts) {
            if (pkg.scripts[script]) {
              scriptName = script;
              break;
            }
          }
        }

        // If not found yet, use standard priority
        if (!scriptName) {
          if (pkg.scripts.dev) scriptName = 'dev';
          else if (pkg.scripts.start) scriptName = 'start';
          else if (pkg.scripts.serve) scriptName = 'serve';
          else if (pkg.scripts.web) scriptName = 'web';
          else if (pkg.scripts.app) scriptName = 'app';
          else {
            // Pick the first script that looks like a start command
            const startScripts = Object.keys(pkg.scripts).filter(name =>
              name.includes('dev') || name.includes('start') || name.includes('serve')
            );
            if (startScripts.length > 0) scriptName = startScripts[0];
          }
        }
      }

      // Construct proper command
      let command;
      if (scriptName) {
        if (packageManager === 'yarn') {
          command = `yarn ${scriptName}`;
        } else {
          command = `${packageManager} run ${scriptName}`;
        }
      } else {
        command = 'npm run dev'; // Fallback
      }

      // Detect port - ONLY from explicit config, not framework defaults
      let port = null;

      // 1. Check scripts for explicit port
      if (pkg.scripts) {
        port = extractPortFromScripts(pkg.scripts);
      }

      // 2. Check for vite config (common for modern projects)
      if (!port) {
        const viteConfigPath = path.join(dirPath, 'vite.config.js');
        const viteConfigTsPath = path.join(dirPath, 'vite.config.ts');
        if (await fileExists(viteConfigPath) || await fileExists(viteConfigTsPath)) {
          try {
            const configPath = await fileExists(viteConfigPath) ? viteConfigPath : viteConfigTsPath;
            const viteConfig = await fs.readFile(configPath, 'utf8');
            const portMatch = viteConfig.match(/port:\s*(\d+)/);
            if (portMatch) port = parseInt(portMatch[1]);
          } catch (err) {
            // Ignore read errors
          }
        }
      }

      // 3. Check .env files for PORT variable
      if (!port) {
        const envPath = path.join(dirPath, '.env');
        const envLocalPath = path.join(dirPath, '.env.local');
        for (const envFile of [envPath, envLocalPath]) {
          if (await fileExists(envFile)) {
            try {
              const envContent = await fs.readFile(envFile, 'utf8');
              const portMatch = envContent.match(/^PORT=(\d+)/m);
              if (portMatch) {
                port = parseInt(portMatch[1]);
                break;
              }
            } catch (err) {
              // Ignore read errors
            }
          }
        }
      }

      // DON'T use framework defaults - leave as null if not explicitly configured
      // This prevents false positives where everything gets port 3000

      return {
        type: 'Node.js',
        name: pkg.name || path.basename(dirPath),
        command,
        port,
        path: dirPath,
        confidence: 0.95,
        env: {}
      };
    } catch (err) {
      return null; // Invalid package.json
    }
  }
}

class DockerDetector extends ProjectDetector {
  constructor() {
    super('Docker', 90);
  }

  async detect(dirPath) {
    const composePath = path.join(dirPath, 'docker-compose.yml');
    const dockerfilePath = path.join(dirPath, 'Dockerfile');

    const composeExists = await fileExists(composePath);
    const dockerfileExists = await fileExists(dockerfilePath);

    if (!composeExists && !dockerfileExists) return null;

    try {
      let port = null;
      let confidence = composeExists ? 0.9 : 0.6;

      if (composeExists) {
        const content = await fs.readFile(composePath, 'utf8');
        port = extractPortFromDockerCompose(content);
      }

      return {
        type: 'Docker',
        name: path.basename(dirPath),
        command: composeExists ? 'docker compose up' : 'docker build -t app . && docker run -p 8000:8000 app',
        port: port || 8000,
        path: dirPath,
        confidence,
        env: {}
      };
    } catch (err) {
      return null;
    }
  }
}

class PythonDetector extends ProjectDetector {
  constructor() {
    super('Python', 80);
  }

  async detect(dirPath) {
    const pyprojectPath = path.join(dirPath, 'pyproject.toml');
    const requirementsPath = path.join(dirPath, 'requirements.txt');
    const mainPath = path.join(dirPath, 'main.py');
    const managePath = path.join(dirPath, 'manage.py');

    const hasPyproject = await fileExists(pyprojectPath);
    const hasRequirements = await fileExists(requirementsPath);
    const hasMain = await fileExists(mainPath);
    const hasManage = await fileExists(managePath);

    if (!hasPyproject && !hasRequirements && !hasMain && !hasManage) return null;

    try {
      let framework = null;
      let command = null;
      let port = 8000;
      let confidence = 0.7;

      // Detect framework
      if (hasRequirements) {
        const content = await fs.readFile(requirementsPath, 'utf8');
        framework = detectPythonFramework(content);
      }

      if (framework === 'fastapi') {
        command = 'uvicorn main:app --reload';
        port = 8000;
        confidence = 0.85;
      } else if (framework === 'django') {
        command = 'python manage.py runserver';
        port = 8000;
        confidence = 0.9;
      } else if (framework === 'flask') {
        command = 'flask run';
        port = 5000;
        confidence = 0.85;
      } else if (hasMain) {
        command = 'python main.py';
        port = 8000;
        confidence = 0.6;
      } else {
        return null; // Can't determine command
      }

      return {
        type: 'Python',
        name: path.basename(dirPath),
        command,
        port,
        path: dirPath,
        confidence,
        env: {}
      };
    } catch (err) {
      return null;
    }
  }
}

class GoDetector extends ProjectDetector {
  constructor() {
    super('Go', 85);
  }

  async detect(dirPath) {
    const goModPath = path.join(dirPath, 'go.mod');
    const mainGoPath = path.join(dirPath, 'main.go');

    const hasGoMod = await fileExists(goModPath);
    const hasMainGo = await fileExists(mainGoPath);

    if (!hasGoMod && !hasMainGo) return null;

    try {
      let port = 8080; // Default Go HTTP server port
      let command = 'go run .';
      let confidence = 0.8;

      // Check if this is a specific framework
      if (hasGoMod) {
        const content = await fs.readFile(goModPath, 'utf8');

        // Detect common Go frameworks
        if (content.includes('gin-gonic/gin')) {
          port = 8080;
          confidence = 0.9;
        } else if (content.includes('gofiber/fiber')) {
          port = 3000;
          confidence = 0.9;
        } else if (content.includes('labstack/echo')) {
          port = 1323;
          confidence = 0.9;
        }
      }

      // Check main.go for port configuration
      if (hasMainGo) {
        try {
          const mainContent = await fs.readFile(mainGoPath, 'utf8');
          const portMatch = mainContent.match(/:(\d{4,5})["'`]/);
          if (portMatch) {
            port = parseInt(portMatch[1]);
            confidence = 0.95;
          }
        } catch (err) {
          // Ignore read errors
        }
      }

      return {
        type: 'Go',
        name: path.basename(dirPath),
        command,
        port,
        path: dirPath,
        confidence,
        env: {}
      };
    } catch (err) {
      return null;
    }
  }
}

class DotNetDetector extends ProjectDetector {
  constructor() {
    super('.NET', 85);
  }

  async detect(dirPath) {
    try {
      const entries = await fs.readdir(dirPath);
      const csprojFiles = entries.filter(f => f.endsWith('.csproj'));
      const hasSln = entries.some(f => f.endsWith('.sln'));

      if (csprojFiles.length === 0 && !hasSln) return null;

      let port = 5000; // Default ASP.NET Core port
      let command = 'dotnet run';
      let confidence = 0.85;

      // Check launchSettings.json for port
      const launchSettingsPath = path.join(dirPath, 'Properties', 'launchSettings.json');
      if (await fileExists(launchSettingsPath)) {
        try {
          const content = await fs.readFile(launchSettingsPath, 'utf8');
          const settings = JSON.parse(content);

          // Look for applicationUrl in profiles
          for (const profile of Object.values(settings.profiles || {})) {
            if (profile.applicationUrl) {
              const portMatch = profile.applicationUrl.match(/:(\d+)/);
              if (portMatch) {
                port = parseInt(portMatch[1]);
                confidence = 0.95;
                break;
              }
            }
          }
        } catch (err) {
          // Ignore parse errors
        }
      }

      return {
        type: '.NET',
        name: csprojFiles[0]?.replace('.csproj', '') || path.basename(dirPath),
        command,
        port,
        path: dirPath,
        confidence,
        env: {}
      };
    } catch (err) {
      return null;
    }
  }
}

class RustDetector extends ProjectDetector {
  constructor() {
    super('Rust', 85);
  }

  async detect(dirPath) {
    const cargoPath = path.join(dirPath, 'Cargo.toml');

    if (!await fileExists(cargoPath)) return null;

    try {
      const content = await fs.readFile(cargoPath, 'utf8');
      let port = 8000;
      let command = 'cargo run';
      let confidence = 0.85;

      // Detect web frameworks
      if (content.includes('actix-web')) {
        port = 8080;
        confidence = 0.9;
      } else if (content.includes('rocket')) {
        port = 8000;
        confidence = 0.9;
      } else if (content.includes('axum')) {
        port = 3000;
        confidence = 0.9;
      } else if (content.includes('warp')) {
        port = 3030;
        confidence = 0.9;
      }

      // Check main.rs or lib.rs for port configuration
      const mainRsPath = path.join(dirPath, 'src', 'main.rs');
      if (await fileExists(mainRsPath)) {
        try {
          const mainContent = await fs.readFile(mainRsPath, 'utf8');
          const portMatch = mainContent.match(/(?:bind|listen)\([^)]*[":](\\d{4,5})[")]/);
          if (portMatch) {
            port = parseInt(portMatch[1]);
            confidence = 0.95;
          }
        } catch (err) {
          // Ignore read errors
        }
      }

      return {
        type: 'Rust',
        name: path.basename(dirPath),
        command,
        port,
        path: dirPath,
        confidence,
        env: {}
      };
    } catch (err) {
      return null;
    }
  }
}

class RubyDetector extends ProjectDetector {
  constructor() {
    super('Ruby', 85);
  }

  async detect(dirPath) {
    const gemfilePath = path.join(dirPath, 'Gemfile');
    const configRuPath = path.join(dirPath, 'config.ru');
    const rakfilePath = path.join(dirPath, 'Rakefile');

    const hasGemfile = await fileExists(gemfilePath);
    const hasConfigRu = await fileExists(configRuPath);
    const hasRakefile = await fileExists(rakfilePath);

    if (!hasGemfile && !hasConfigRu && !hasRakefile) return null;

    try {
      let port = 3000;
      let command = 'ruby app.rb';
      let confidence = 0.7;
      let framework = null;

      // Detect Rails
      const railsPath = path.join(dirPath, 'config', 'application.rb');
      if (await fileExists(railsPath)) {
        framework = 'rails';
        command = 'rails server';
        port = 3000;
        confidence = 0.95;
      }

      // Detect Sinatra
      if (hasGemfile && !framework) {
        try {
          const gemfileContent = await fs.readFile(gemfilePath, 'utf8');
          if (gemfileContent.includes('sinatra')) {
            framework = 'sinatra';
            command = 'ruby app.rb';
            port = 4567;
            confidence = 0.9;
          } else if (gemfileContent.includes('rack')) {
            command = 'rackup';
            port = 9292;
            confidence = 0.85;
          }
        } catch (err) {
          // Ignore read errors
        }
      }

      return {
        type: 'Ruby',
        name: path.basename(dirPath),
        command,
        port,
        path: dirPath,
        confidence,
        env: {}
      };
    } catch (err) {
      return null;
    }
  }
}

class StaticSiteDetector extends ProjectDetector {
  constructor() {
    super('Static Site', 50);
  }

  async detect(dirPath) {
    const indexPath = path.join(dirPath, 'index.html');
    const packagePath = path.join(dirPath, 'package.json');

    const hasIndex = await fileExists(indexPath);
    const hasPackage = await fileExists(packagePath);

    // Only detect if index.html exists but no package.json (avoid false positives with Node projects)
    if (!hasIndex || hasPackage) return null;

    return {
      type: 'Static Site',
      name: path.basename(dirPath),
      command: 'npx live-server .',
      port: null, // Don't assume port - let user assign or use Find Free
      path: dirPath,
      confidence: 0.5,
      env: {}
    };
  }
}

// ============ Core Scanning Logic ============

const DISCOVERY_CACHE = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Scan multiple directories for projects
 * @param {string[]} scanPaths - Root directories to scan
 * @param {object} options - Scanning options
 * @returns {Promise<Array>} Discovered projects
 */
async function scanDirectories(scanPaths, options = {}) {
  const {
    maxDepth = 2,
    ignorePatterns = ['node_modules', '.git', 'dist', 'build', 'venv', '__pycache__', 'target', 'bin', 'obj'],
    signal = null
  } = options;

  // Check cache
  const cacheKey = JSON.stringify({ scanPaths: scanPaths.sort(), maxDepth });
  const cached = DISCOVERY_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.results;
  }

  // Scan all paths in parallel
  const results = await Promise.all(
    scanPaths.map(rootPath => scanDirectory(rootPath, { maxDepth, ignorePatterns, signal }))
  );

  const allProjects = results.flat();
  const deduplicated = deduplicateProjects(allProjects);

  // Cache results
  DISCOVERY_CACHE.set(cacheKey, { results: deduplicated, timestamp: Date.now() });

  return deduplicated;
}

/**
 * Scan a single directory recursively
 * @param {string} rootPath - Directory to scan
 * @param {object} options - Scanning options
 * @returns {Promise<Array>} Discovered projects
 */
async function scanDirectory(rootPath, options = {}) {
  const { maxDepth = 2, ignorePatterns = [], signal = null } = options;
  const discovered = [];

  const detectors = [
    new NodeDetector(),
    new DockerDetector(),
    new GoDetector(),
    new DotNetDetector(),
    new RustDetector(),
    new RubyDetector(),
    new PythonDetector(),
    new StaticSiteDetector()
  ].sort((a, b) => b.priority - a.priority); // Higher priority first

  async function traverse(dirPath, depth) {
    if (signal?.aborted) throw new Error('Scan aborted');
    if (depth > maxDepth) return;

    try {
      // Check if current directory is a project
      for (const detector of detectors) {
        const match = await detector.detect(dirPath);
        if (match && match.confidence >= 0.5) {
          discovered.push(match);
          return; // Don't recurse into detected projects
        }
      }

      // Read directory entries
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      // Recurse into subdirectories
      for (const entry of entries) {
        if (entry.isDirectory() && !ignorePatterns.includes(entry.name)) {
          await traverse(path.join(dirPath, entry.name), depth + 1);
        }
      }
    } catch (err) {
      // Permission errors, skip directory
      if (err.code === 'EACCES' || err.code === 'EPERM') {
        console.warn(`Skipping ${dirPath}: Permission denied`);
      } else if (err.code !== 'ENOENT') {
        console.error(`Error scanning ${dirPath}:`, err.message);
      }
    }
  }

  await traverse(rootPath, 0);
  return discovered;
}

// ============ Helper Functions ============

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function extractPortFromScripts(scripts) {
  for (const script of Object.values(scripts)) {
    // Look for --port or PORT= in scripts
    const portMatch = script.match(/(?:--port|PORT=)[\s=]*(\d+)/);
    if (portMatch) return parseInt(portMatch[1]);

    // Look for :PORT in script
    const colonMatch = script.match(/:(\d{4,5})/);
    if (colonMatch) return parseInt(colonMatch[1]);
  }
  return null;
}

function detectFrameworkPort(dependencies = {}) {
  const allDeps = { ...dependencies };

  // Common framework default ports
  if (allDeps.vite) return 5173;
  if (allDeps.react || allDeps['react-scripts']) return 3000;
  if (allDeps.next) return 3000;
  if (allDeps.vue || allDeps['@vue/cli-service']) return 8080;
  if (allDeps['@angular/core']) return 4200;
  if (allDeps.express) return 3000;
  if (allDeps.fastify) return 3000;

  return null;
}

function extractPortFromDockerCompose(content) {
  // Simple regex to extract first port mapping (e.g., "8000:8000" -> 8000)
  const portMatch = content.match(/ports:\s*-\s*["']?(\d+):/);
  if (portMatch) return parseInt(portMatch[1]);
  return null;
}

function detectPythonFramework(requirementsContent) {
  const lower = requirementsContent.toLowerCase();
  if (lower.includes('fastapi')) return 'fastapi';
  if (lower.includes('django')) return 'django';
  if (lower.includes('flask')) return 'flask';
  return null;
}

function deduplicateProjects(projects) {
  const seen = new Set();
  return projects.filter(proj => {
    const key = path.normalize(proj.path).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Detect project in a directory and its subdirectories (recursive up to 2 levels)
 * Returns the highest-confidence project found, preferring shallower paths
 * @param {string} dirPath - Directory to check
 * @returns {Promise<Object|null>} Detected project or null
 */
async function detectProject(dirPath) {
  // Scan directory and subdirectories (up to 2 levels deep)
  const discovered = await scanDirectory(dirPath, {
    maxDepth: 2,
    ignorePatterns: ['node_modules', '.git', '.next', 'dist', 'build', '.vercel', 'target']
  });

  if (discovered.length === 0) {
    return null; // No projects found
  }

  // Sort by:
  // 1. Confidence (higher is better)
  // 2. Depth (shallower is better - prefer root-level projects)
  discovered.sort((a, b) => {
    if (b.confidence !== a.confidence) {
      return b.confidence - a.confidence; // Higher confidence first
    }
    // Same confidence - prefer shallower path (closer to selected root)
    const depthA = a.path.split(path.sep).length;
    const depthB = b.path.split(path.sep).length;
    return depthA - depthB; // Shallower first
  });

  return discovered[0]; // Return best match
}

module.exports = {
  scanDirectories,
  scanDirectory,
  detectProject
};
