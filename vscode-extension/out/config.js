"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.rowStateOf = void 0;
exports.getConfigPath = getConfigPath;
exports.readConfig = readConfig;
exports.recordHumanStart = recordHumanStart;
exports.recordAppStop = recordAppStop;
exports.readRuntimeApps = readRuntimeApps;
exports.logPathFor = logPathFor;
exports.updateConfig = updateConfig;
exports.generateId = generateId;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
function getConfigPath() {
    const platform = os.platform();
    let configDir;
    // NOTE: must match Electron's app.getPath('userData'), which is derived from
    // the lowercase package.json "name" ("portpilot"). Using "PortPilot" (capital)
    // works on case-insensitive Windows but reads a DIFFERENT file on Linux/macOS,
    // so the extension would never see the desktop app's config.
    if (platform === 'win32') {
        configDir = path.join(process.env.APPDATA || '', 'portpilot');
    }
    else if (platform === 'darwin') {
        configDir = path.join(os.homedir(), 'Library', 'Application Support', 'portpilot');
    }
    else {
        configDir = path.join(os.homedir(), '.config', 'portpilot');
    }
    return path.join(configDir, 'portpilot-config.json');
}
function readConfig() {
    const configPath = getConfigPath();
    try {
        if (fs.existsSync(configPath)) {
            const data = fs.readFileSync(configPath, 'utf-8');
            return JSON.parse(data);
        }
    }
    catch (error) {
        console.error('PortPilot: Error reading config:', error);
    }
    return { apps: [], settings: {}, groups: [] };
}
// eslint-disable-next-line @typescript-eslint/no-var-requires
const configFile = require(path.join(__dirname, '..', 'runtime', 'core', 'configFile.js'));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const status = require(path.join(__dirname, '..', 'runtime', 'core', 'status.js'));
/** Record that the user started an app from VS Code (best-effort, never throws). */
function recordHumanStart(app) {
    return configFile.recordStart(getConfigPath(), app.id, status.makeStartedBy({ kind: 'human', surface: 'vscode' }), { port: app.preferredPort });
}
/** Clear an app's provenance after it stops (best-effort, never throws). */
function recordAppStop(appId) {
    return configFile.recordStop(getConfigPath(), appId);
}
/** Per-app runtime entries (provenance, crash stamp). Empty on any read failure. */
function readRuntimeApps() {
    try {
        return configFile.readRuntime(getConfigPath()).apps;
    }
    catch {
        return {};
    }
}
/** Where a detached app's output is written (logs/<appId>.log beside the config). */
function logPathFor(appId) {
    return configFile.logPathFor(getConfigPath(), appId);
}
const rowStateOf = (rec) => status.rowStateOf(rec);
exports.rowStateOf = rowStateOf;
/**
 * Locked read-modify-write against the file on disk. Do any user prompting
 * BEFORE calling this: the mutator must be synchronous, and a config object
 * held across a prompt would overwrite whatever other processes wrote meanwhile.
 */
function updateConfig(mutator) {
    return configFile.updateJson(getConfigPath(), (config) => {
        if (!config.apps)
            config.apps = [];
        return mutator(config);
    }, () => ({ apps: [], settings: {}, groups: [] })).result;
}
function generateId() {
    return `app-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
//# sourceMappingURL=config.js.map