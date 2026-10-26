/**
 * VS Code Browser previews (vscode-extension/src/previewModel.ts, cdpClient.ts, browserCapture.ts):
 * the setting list, the one-capture-per-10-s gate, the age label, the WebSocket framing the
 * extension speaks (no runtime dependency), and a full capture against a fake CDP server.
 * Never touches a real browser or a fixed port: the fake server binds an ephemeral port.
 * Requires the compiled modules (rebuild with `npm run compile` in vscode-extension/).
 * Run: node tests/vscode-browser-preview.test.cjs   (part of npm run test:unit)
 */
const assert = require('assert');
const crypto = require('crypto');
const http = require('http');
const path = require('path');

const out = path.join(__dirname, '..', 'vscode-extension', 'out');
const model = require(path.join(out, 'previewModel.js'));
const { FrameParser, encodeTextFrame, openPageSession } = require(path.join(out, 'cdpClient.js'));
const { captureTab, pickPreviewTab, THUMB_WIDTH } = require(path.join(out, 'browserCapture.js'));

let failed = 0;
const test = async (name, fn) => {
  try { await fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + (e && e.stack || e)); }
};

/** A server-to-client frame: unmasked, as RFC 6455 requires. */
function serverFrame(text, { opcode = 1, fin = true } = {}) {
  const p = Buffer.from(text, 'utf8');
  const head = p.length < 126 ? Buffer.from([(fin ? 0x80 : 0) | opcode, p.length])
    : p.length < 65536 ? Buffer.concat([Buffer.from([(fin ? 0x80 : 0) | opcode, 126]), Buffer.from([p.length >> 8, p.length & 255])])
      : (() => { const h = Buffer.alloc(10); h[0] = (fin ? 0x80 : 0) | opcode; h[1] = 127; h.writeBigUInt64BE(BigInt(p.length), 2); return h; })();
  return Buffer.concat([head, p]);
}

/** Reads one masked client text frame off a socket buffer. */
function readClientFrame(buf) {
  const masked = (buf[1] & 0x80) !== 0; assert.ok(masked, 'client frames must be masked');
  let len = buf[1] & 0x7f, off = 2;
  if (len === 126) { len = buf.readUInt16BE(2); off = 4; } else if (len === 127) { len = Number(buf.readBigUInt64BE(2)); off = 10; }
  const key = buf.subarray(off, off + 4);
  const body = Buffer.from(buf.subarray(off + 4, off + 4 + len).map((b, i) => b ^ key[i & 3]));
  return { text: body.toString('utf8'), used: off + 4 + len };
}

(async () => {
  await test('parsePreviewNames keeps clean unique strings only', () => {
    assert.deepStrictEqual(model.parsePreviewNames(['google', ' Google ', '', 3, null, 'stripe']), ['google', 'stripe']);
    assert.deepStrictEqual(model.parsePreviewNames(undefined), []);
    assert.deepStrictEqual(model.parsePreviewNames('google'), []);
  });

  await test('hasPreview and withPreview ignore case', () => {
    assert.ok(model.hasPreview(['Google'], 'google'));
    assert.deepStrictEqual(model.withPreview(['a'], 'b', true), ['a', 'b']);
    assert.deepStrictEqual(model.withPreview(['a', 'B'], 'b', false), ['a']);
    assert.deepStrictEqual(model.withPreview(['a'], 'A', true), ['A']);
  });

  await test('CaptureGate: one at a time, one per profile per gap, failures count', () => {
    const g = new model.CaptureGate(10_000);
    assert.strictEqual(g.enter('a', 0), 'go');
    assert.strictEqual(g.enter('b', 1), 'busy');
    g.done();
    assert.strictEqual(g.enter('a', 5_000), 'throttled');
    assert.strictEqual(g.enter('b', 5_000), 'go');
    g.done();
    assert.strictEqual(g.enter('A', 10_000), 'go', 'gap is measured per profile, case-insensitively');
    g.done();
    g.forget('a');
    assert.strictEqual(g.enter('a', 10_001), 'go', 'a forced look skips the gap');
    g.done();
  });

  await test('ageLabel', () => {
    assert.strictEqual(model.ageLabel(1000, 1000), 'just now');
    assert.strictEqual(model.ageLabel(0, 12_000), '12 s ago');
    assert.strictEqual(model.ageLabel(0, 180_000), '3 min ago');
    assert.strictEqual(model.ageLabel(0, 7_200_000), '2 h ago');
    assert.strictEqual(model.ageLabel(5000, 1000), 'just now', 'a clock that went backwards is not negative');
  });

  await test('pickPreviewTab takes the first real web page', () => {
    const tabs = [{ id: 'a', title: '', url: 'about:blank' }, { id: 'b', title: 'x', url: 'file:///x' }, { id: 'c', title: 'Y', url: 'https://y.test/' }, { id: 'd', title: 'Z', url: 'http://z.test/' }];
    assert.strictEqual(pickPreviewTab(tabs).id, 'c');
    assert.strictEqual(pickPreviewTab([tabs[0], tabs[1]]), undefined);
  });

  await test('encodeTextFrame masks and uses the right length form', () => {
    const mask = Buffer.from([1, 2, 3, 4]);
    for (const n of [5, 125, 126, 300, 65535, 65536, 70000]) {
      const text = 'x'.repeat(n);
      const f = encodeTextFrame(text, mask);
      assert.strictEqual(f[0], 0x81);
      assert.strictEqual(readClientFrame(f).text, text, 'round trip at ' + n);
    }
  });

  await test('FrameParser: split chunks, fragments, 16- and 64-bit lengths, ping, close', () => {
    const big = 'y'.repeat(70000);
    const wire = Buffer.concat([serverFrame('one'), serverFrame(big), serverFrame('he', { fin: false }), serverFrame('llo', { opcode: 0 }), serverFrame('pp', { opcode: 9 }), Buffer.from([0x88, 0])]);
    const p = new FrameParser();
    const got = [];
    for (let i = 0; i < wire.length; i += 7) got.push(...p.feed(wire.subarray(i, i + 7)));
    assert.deepStrictEqual(got.map(g => g.kind), ['text', 'text', 'text', 'ping', 'close']);
    assert.strictEqual(got[0].text, 'one');
    assert.strictEqual(got[1].text.length, 70000);
    assert.strictEqual(got[2].text, 'hello');
  });

  await test('FrameParser refuses a frame that claims to be enormous', () => {
    const h = Buffer.alloc(10); h[0] = 0x81; h[1] = 127; h.writeBigUInt64BE(BigInt(2 ** 40), 2);
    assert.throws(() => new FrameParser().feed(h), /too large/);
  });

  // A fake DevTools endpoint: answers the WebSocket upgrade, then two CDP methods.
  const calls = [];
  const server = http.createServer((q, r) => { r.statusCode = 404; r.end(); });
  server.on('upgrade', (req, socket) => {
    calls.push(req.url);
    const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    if (req.url.endsWith('/refuse')) { socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    let buf = Buffer.alloc(0);
    socket.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 6) {
        const f = readClientFrame(buf); buf = buf.subarray(f.used);
        const msg = JSON.parse(f.text);
        calls.push(msg.method + ' ' + JSON.stringify(msg.params));
        if (msg.method === 'Page.getLayoutMetrics') socket.write(serverFrame(JSON.stringify({ id: msg.id, result: { cssVisualViewport: { clientWidth: 1440, clientHeight: 900 } } })));
        else if (msg.method === 'Page.captureScreenshot') socket.write(serverFrame(JSON.stringify({ id: msg.id, result: { data: Buffer.from('jpeg-bytes').toString('base64') } })));
        else socket.write(serverFrame(JSON.stringify({ id: msg.id, error: { message: 'no such method' } })));
      }
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  await test('captureTab downscales through the clip scale and returns the JPEG', async () => {
    const tab = { id: 'ABC123', title: 'Hello', url: 'https://x.test/' };
    const cap = await captureTab(port, tab, () => 42);
    assert.strictEqual(Buffer.from(cap.jpeg, 'base64').toString(), 'jpeg-bytes');
    assert.strictEqual(cap.at, 42);
    assert.strictEqual(cap.title, 'Hello');
    const shot = calls.find(c => c.startsWith('Page.captureScreenshot'));
    const params = JSON.parse(shot.slice('Page.captureScreenshot '.length));
    assert.strictEqual(params.format, 'jpeg');
    assert.deepStrictEqual(params.clip, { x: 0, y: 0, width: 1440, height: 900, scale: THUMB_WIDTH / 1440 });
    assert.ok(calls.includes('/devtools/page/ABC123'));
  });

  await test('a CDP error comes back as a rejection', async () => {
    const s = await openPageSession(port, 'ABC123');
    await assert.rejects(s.send('Nope.nothing'), /no such method/);
    s.close();
  });

  await test('a refused upgrade rejects', async () => {
    await assert.rejects(openPageSession(port, 'refuse'), /refused/);
  });

  await test('a bad port or target id is rejected before any connection', async () => {
    const before = calls.length;
    await assert.rejects(openPageSession(80, 'ABC'), /valid debug target/);
    await assert.rejects(openPageSession(port, '../json/close/x'), /valid debug target/);
    assert.strictEqual(calls.length, before);
  });

  await test('a port with nothing listening rejects quickly', async () => {
    const dead = await new Promise(r => { const s = http.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
    const t = Date.now();
    await assert.rejects(openPageSession(dead, 'ABC123', 2000));
    assert.ok(Date.now() - t < 3000);
  });

  server.close();
  if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
  console.log('\nall passed');
  process.exit(0);
})();
