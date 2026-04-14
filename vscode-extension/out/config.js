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
exports.getConfigPath = getConfigPath;
exports.readConfig = readConfig;
exports.writeConfig = writeConfig;
exports.generateId = generateId;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
function getConfigPath() {
    const platform = os.platform();
    let configDir;
    if (platform === 'win32') {
        configDir = path.join(process.env.APPDATA || '', 'PortPilot');
    }
    else if (platform === 'darwin') {
        configDir = path.join(os.homedir(), 'Library', 'Application Support', 'PortPilot');
    }
    else {
        configDir = path.join(os.homedir(), '.config', 'PortPilot');
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
function writeConfig(config) {
    const configPath = getConfigPath();
    const configDir = path.dirname(configPath);
    if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
    }
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}
function generateId() {
    return `app-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
//# sourceMappingURL=config.js.map