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
exports.readBrowserProfilesCached = readBrowserProfilesCached;
exports.browserCall = browserCall;
exports.recordHumanStart = recordHumanStart;
exports.recordAppStop = recordAppStop;
exports.readRuntimeApps = readRuntimeApps;
exports.readRunsCached = readRunsCached;
exports.readRowThumbs = readRowThumbs;
exports.pinHistoryRun = pinHistoryRun;
exports.appForRun = appForRun;
exports.thumbDataUri = thumbDataUri;
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
// eslint-disable-next-line @typescript-eslint/no-var-requires
const runHistory = require(path.join(__dirname, '..', 'runtime', 'core', 'runHistory.js'));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const runView = require(path.join(__dirname, '..', 'runtime', 'core', 'runView.js'));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const browserProfiles = require(path.join(__dirname, '..', 'runtime', 'core', 'browserProfiles.js'));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const browserApi = require(path.join(__dirname, '..', 'runtime', 'core', 'browserApi.js'));
let profilesCache = null;
/** The raw `browserProfiles` list, re-read only when the config file's mtime or size moves. Empty on any read failure. */
function readBrowserProfilesCached() {
    try {
        const configPath = getConfigPath();
        const st = fs.statSync(configPath);
        const key = `${configPath}|${st.mtimeMs}|${st.size}`;
        if (profilesCache?.key !== key)
            profilesCache = { key, profiles: browserProfiles.listProfiles(configPath) };
        return profilesCache;
    }
    catch {
        return { key: 'none', profiles: [] };
    }
}
/** One browser tool (list_browser_profiles, start_browser, stop_browser, set_browser_mode). Resolves always; a throw becomes a failure result. */
async function browserCall(tool, args = {}) {
    try {
        return await browserApi.call(getConfigPath(), tool, { agent: 'VS Code', ...args }, { surface: 'vscode' });
    }
    catch (err) {
        return { success: false, code: 'INTERNAL', error: err.message || 'The browser tool failed.', action: 'Try again, or report this.' };
    }
}
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
// runs.json is the biggest file the 10s refresh touches: re-parse it only when it changes.
let runsCache = null;
let thumbCache = null;
/** The parsed runs plus a key that changes whenever the file does. Empty on any read failure. */
function readRunsCached() {
    try {
        const configPath = getConfigPath();
        const runsFile = path.join(runHistory.historyDirFor(configPath), 'runs.json');
        const st = fs.statSync(runsFile);
        const key = `${runsFile}|${st.mtimeMs}|${st.size}`;
        if (runsCache?.key !== key)
            runsCache = { key, runs: runHistory.readRuns(configPath) };
        return runsCache;
    }
    catch {
        return { key: 'none', runs: [] };
    }
}
/** Newest open run with a page thumbnail, per app. Empty on any read failure. */
function readRowThumbs() {
    try {
        const { key, runs } = readRunsCached();
        if (thumbCache?.key !== key)
            thumbCache = { key, thumbs: runView.rowThumbs(runs) };
        return thumbCache.thumbs;
    }
    catch {
        return {};
    }
}
/** Pin or unpin a run in the shared history (a 51st pin is refused). Never throws. */
function pinHistoryRun(runId, pinned) {
    try {
        return runHistory.pinRun(getConfigPath(), runId, pinned);
    }
    catch {
        return { ok: false, reason: 'error' };
    }
}
/**
 * Find or register the app a history run belongs to, so it can be started again.
 * runApp.js ships with the desktop's localhost detection; until it is bundled
 * (missing module) a registered run falls back to its own app, a detected one fails.
 */
function appForRun(run) {
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const runApp = require(path.join(__dirname, '..', 'runtime', 'core', 'runApp.js'));
        const res = runApp.appForRun(getConfigPath(), run);
        return res.ok && res.appId ? { ok: true, appId: res.appId, port: res.port ?? null } : { ok: false, error: res.error || 'unknown' };
    }
    catch (err) {
        if (err.code !== 'MODULE_NOT_FOUND')
            return { ok: false, error: err.message };
        const app = readConfig().apps.find(a => a.id === run.appId);
        return app ? { ok: true, appId: app.id, port: app.preferredPort } : { ok: false, error: 'This PortPilot build cannot start a detected server again yet.' };
    }
}
const THUMB_MAX_BYTES = 512 * 1024;
/** A run's thumbnail as a data URI (thumbnails never leave this machine), or null. */
function thumbDataUri(thumb) {
    try {
        const dir = path.resolve(runHistory.historyDirFor(getConfigPath()));
        const file = path.resolve(dir, thumb);
        // A thumb path read from runs.json must stay under history/.
        if (!file.startsWith(dir + path.sep))
            return null;
        const st = fs.statSync(file);
        if (!st.isFile() || st.size > THUMB_MAX_BYTES)
            return null;
        return `data:image/jpeg;base64,${fs.readFileSync(file).toString('base64')}`;
    }
    catch {
        return null;
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