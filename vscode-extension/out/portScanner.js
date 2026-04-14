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
exports.scanPorts = scanPorts;
exports.killPort = killPort;
const child_process_1 = require("child_process");
const os = __importStar(require("os"));
function scanPorts() {
    const platform = os.platform();
    const ports = [];
    try {
        if (platform === 'win32') {
            const output = (0, child_process_1.execSync)('netstat -ano', { encoding: 'utf-8', timeout: 15000 });
            const lines = output.split('\n').filter(l => /^\s*TCP\b/i.test(l));
            for (const line of lines) {
                const parts = line.trim().split(/\s+/);
                if (parts.length < 5)
                    continue;
                const localPart = parts[1];
                const foreignPart = parts[2];
                const pid = parseInt(parts[4], 10);
                if (!foreignPart || !foreignPart.match(/:0$/))
                    continue;
                const portMatch = localPart.match(/:(\d+)$/);
                if (!portMatch)
                    continue;
                const port = parseInt(portMatch[1]);
                if (port >= 1024 && port <= 65535) {
                    let processName = 'Unknown';
                    try {
                        const wmicOutput = (0, child_process_1.execSync)(`wmic process where ProcessId=${pid} get Name /value`, { encoding: 'utf-8', timeout: 5000 });
                        const nameMatch = wmicOutput.match(/Name=(.+)/);
                        if (nameMatch)
                            processName = nameMatch[1].trim();
                    }
                    catch { /* ignore */ }
                    ports.push({ port, pid, processName });
                }
            }
        }
        else if (platform === 'darwin') {
            const output = (0, child_process_1.execSync)('lsof -iTCP -sTCP:LISTEN -n -P', { encoding: 'utf-8', timeout: 10000 });
            const lines = output.split('\n').filter(l => l.trim());
            for (const line of lines.slice(1)) {
                const parts = line.split(/\s+/);
                if (parts.length >= 9) {
                    const processName = parts[0];
                    const pid = parseInt(parts[1]);
                    const portMatch = parts[8]?.match(/:(\d+)$/);
                    if (portMatch) {
                        ports.push({ port: parseInt(portMatch[1]), pid, processName });
                    }
                }
            }
        }
        else {
            let output;
            try {
                output = (0, child_process_1.execSync)('ss -tlnp', { encoding: 'utf-8', timeout: 10000 });
            }
            catch {
                output = (0, child_process_1.execSync)('netstat -tlnp', { encoding: 'utf-8', timeout: 10000 });
            }
            const lines = output.split('\n').filter(l => l.trim());
            for (const line of lines) {
                const portMatch = line.match(/:(\d+)\s/);
                const pidMatch = line.match(/pid=(\d+)/);
                if (portMatch) {
                    ports.push({
                        port: parseInt(portMatch[1]),
                        pid: pidMatch ? parseInt(pidMatch[1]) : 0,
                        processName: 'Unknown'
                    });
                }
            }
        }
    }
    catch (error) {
        console.error('PortPilot: Port scan error:', error);
    }
    const uniquePorts = [...new Map(ports.map(p => [p.port, p])).values()];
    return uniquePorts.sort((a, b) => a.port - b.port);
}
function killPort(port) {
    const platform = os.platform();
    try {
        if (platform === 'win32') {
            const output = (0, child_process_1.execSync)(`netstat -ano | findstr :${port}`, { encoding: 'utf-8' });
            const match = output.match(/LISTENING\s+(\d+)/);
            if (match) {
                (0, child_process_1.execSync)(`taskkill /F /PID ${match[1]}`);
                return true;
            }
        }
        else {
            const output = (0, child_process_1.execSync)(`lsof -ti :${port}`, { encoding: 'utf-8' });
            const pid = output.trim();
            if (pid) {
                (0, child_process_1.execSync)(`kill -9 ${pid}`);
                return true;
            }
        }
    }
    catch { /* ignore */ }
    return false;
}
//# sourceMappingURL=portScanner.js.map