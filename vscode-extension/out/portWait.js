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
exports.portAnswers = portAnswers;
exports.waitForPort = waitForPort;
const net = __importStar(require("net"));
// Dev servers bind 127.0.0.1, ::1 or both (vite on Node 17+ often binds ::1 only),
// so a port answers when either loopback address accepts a connection.
function connects(port, host, timeoutMs) {
    return new Promise((resolve) => {
        const socket = net.connect({ port, host });
        const done = (ok) => { socket.destroy(); resolve(ok); };
        socket.setTimeout(timeoutMs, () => done(false));
        socket.once('connect', () => done(true));
        socket.once('error', () => done(false));
    });
}
/** True when something accepts a TCP connection on `port` at loopback right now. */
async function portAnswers(port) {
    const tries = await Promise.all([connects(port, '127.0.0.1', 800), connects(port, '::1', 800)]);
    return tries.some(Boolean);
}
/** Polls until the port answers. Resolves false on timeout or when `cancelled()` turns true. */
async function waitForPort(port, { timeoutMs = 60000, intervalMs = 500, cancelled = () => false } = {}) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end && !cancelled()) {
        if (await portAnswers(port))
            return true;
        await new Promise((r) => setTimeout(r, intervalMs));
    }
    return false;
}
//# sourceMappingURL=portWait.js.map