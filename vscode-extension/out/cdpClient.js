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
exports.FrameParser = void 0;
exports.encodeTextFrame = encodeTextFrame;
exports.openPageSession = openPageSession;
const http = __importStar(require("http"));
const crypto = __importStar(require("crypto"));
const browserModel_1 = require("./browserModel");
// A minimal Chrome DevTools Protocol client over a raw WebSocket. The extension targets VS Code
// 1.85 (Node 18, no global WebSocket) and ships no runtime dependencies, so this speaks just
// enough of RFC 6455 for request/response CDP: one text message per call, no extensions.
// It only ever connects to 127.0.0.1 on a profile's own debug port.
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_MESSAGE = 8_000_000;
/** One masked client text frame. The mask key is a parameter so tests are deterministic. */
function encodeTextFrame(text, mask = crypto.randomBytes(4)) {
    const payload = Buffer.from(text, 'utf8');
    const n = payload.length;
    const head = n < 126 ? Buffer.alloc(2) : n < 65536 ? Buffer.alloc(4) : Buffer.alloc(10);
    head[0] = 0x81; // FIN + text
    if (n < 126)
        head[1] = 0x80 | n;
    else if (n < 65536) {
        head[1] = 0x80 | 126;
        head.writeUInt16BE(n, 2);
    }
    else {
        head[1] = 0x80 | 127;
        head.writeBigUInt64BE(BigInt(n), 2);
    }
    const body = Buffer.alloc(n);
    for (let i = 0; i < n; i++)
        body[i] = payload[i] ^ mask[i & 3];
    return Buffer.concat([head, mask, body]);
}
/** Reassembles server frames (unmasked, possibly fragmented, possibly split across chunks). */
class FrameParser {
    buf = Buffer.alloc(0);
    fragments = [];
    fragmentBytes = 0;
    feed(chunk) {
        this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
        const out = [];
        for (;;) {
            if (this.buf.length < 2)
                break;
            const fin = (this.buf[0] & 0x80) !== 0;
            const opcode = this.buf[0] & 0x0f;
            const masked = (this.buf[1] & 0x80) !== 0;
            let len = this.buf[1] & 0x7f;
            let off = 2;
            if (len === 126) {
                if (this.buf.length < 4)
                    break;
                len = this.buf.readUInt16BE(2);
                off = 4;
            }
            else if (len === 127) {
                if (this.buf.length < 10)
                    break;
                const big = this.buf.readBigUInt64BE(2);
                if (big > BigInt(MAX_MESSAGE))
                    throw new Error('CDP message too large');
                len = Number(big);
                off = 10;
            }
            if (len > MAX_MESSAGE)
                throw new Error('CDP message too large');
            const maskLen = masked ? 4 : 0;
            if (this.buf.length < off + maskLen + len)
                break;
            let payload = this.buf.subarray(off + maskLen, off + maskLen + len);
            if (masked) {
                const key = this.buf.subarray(off, off + 4);
                payload = Buffer.from(payload.map((b, i) => b ^ key[i & 3]));
            }
            else {
                payload = Buffer.from(payload); // detach from the shared receive buffer
            }
            this.buf = this.buf.subarray(off + maskLen + len);
            if (opcode === 0x8) {
                out.push({ kind: 'close' });
                continue;
            }
            if (opcode === 0x9) {
                out.push({ kind: 'ping', data: payload });
                continue;
            }
            if (opcode === 0xa)
                continue; // pong
            if (opcode === 0x1 || opcode === 0x0) {
                this.fragments.push(payload);
                this.fragmentBytes += payload.length;
                if (this.fragmentBytes > MAX_MESSAGE)
                    throw new Error('CDP message too large');
                if (fin) {
                    out.push({ kind: 'text', text: Buffer.concat(this.fragments).toString('utf8') });
                    this.fragments = [];
                    this.fragmentBytes = 0;
                }
            }
        }
        return out;
    }
}
exports.FrameParser = FrameParser;
/**
 * Opens one page target's DevTools socket. Rejects on any failure within `timeoutMs`.
 * `port` and `targetId` are validated here as well, so a caller cannot reach another host or path.
 */
function openPageSession(port, targetId, timeoutMs = 6000) {
    return new Promise((resolve, reject) => {
        if (!(0, browserModel_1.isValidPort)(port) || !(0, browserModel_1.isTabId)(targetId)) {
            reject(new Error('Not a valid debug target.'));
            return;
        }
        const key = crypto.randomBytes(16).toString('base64');
        const req = http.request({
            host: '127.0.0.1', port, path: `/devtools/page/${targetId}`,
            headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Key': key, 'Sec-WebSocket-Version': '13' },
        });
        const fail = (err) => { req.destroy(); reject(err); };
        const timer = setTimeout(() => fail(new Error('The browser did not answer.')), timeoutMs);
        req.on('error', fail);
        req.on('response', () => fail(new Error('The browser refused the connection.')));
        req.on('upgrade', (res, socket, head) => {
            const expect = crypto.createHash('sha1').update(key + GUID).digest('base64');
            if (res.headers['sec-websocket-accept'] !== expect) {
                socket.destroy();
                fail(new Error('Bad WebSocket handshake.'));
                return;
            }
            clearTimeout(timer);
            const parser = new FrameParser();
            let nextId = 0;
            const waiting = new Map();
            const closeAll = (why) => {
                for (const [, w] of waiting) {
                    clearTimeout(w.timer);
                    w.reject(new Error(why));
                }
                waiting.clear();
                socket.destroy();
            };
            const handle = (data) => {
                let msgs;
                try {
                    msgs = parser.feed(data);
                }
                catch (err) {
                    closeAll(err.message);
                    return;
                }
                for (const m of msgs) {
                    if (m.kind === 'close') {
                        closeAll('The browser closed the connection.');
                        return;
                    }
                    if (m.kind === 'ping') {
                        socket.write(Buffer.concat([Buffer.from([0x8a, 0x80 | m.data.length]), Buffer.alloc(4), m.data]));
                        continue;
                    }
                    let msg;
                    try {
                        msg = JSON.parse(m.text);
                    }
                    catch {
                        continue;
                    }
                    const w = typeof msg.id === 'number' ? waiting.get(msg.id) : undefined;
                    if (!w)
                        continue; // events: not used
                    waiting.delete(msg.id);
                    clearTimeout(w.timer);
                    if (msg.error)
                        w.reject(new Error(msg.error.message || 'CDP error'));
                    else
                        w.resolve(msg.result ?? {});
                }
            };
            socket.on('data', handle);
            socket.on('error', () => closeAll('The connection failed.'));
            socket.on('close', () => closeAll('The connection closed.'));
            if (head && head.length)
                handle(head);
            resolve({
                send: (method, params = {}) => new Promise((res2, rej2) => {
                    const id = ++nextId;
                    const t = setTimeout(() => { waiting.delete(id); rej2(new Error(`${method} timed out.`)); }, timeoutMs);
                    waiting.set(id, { resolve: res2, reject: rej2, timer: t });
                    socket.write(encodeTextFrame(JSON.stringify({ id, method, params })));
                }),
                close: () => closeAll('closed'),
            });
        });
        req.end();
    });
}
//# sourceMappingURL=cdpClient.js.map