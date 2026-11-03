// Which listening port is an app's own server? The MCP server and the VS Code extension each carry
// the matcher, so every case runs against both. Pure: ports arrive with their command lines.
import assert from 'node:assert';
import { createRequire } from 'node:module';
import { matchRunning as mcpMatch, isOwnListener as mcpOwn, cmdNamesPath as mcpPath } from '../mcp-server/index.js';

const require = createRequire(import.meta.url);
const { matchRunning: extMatch, isOwnListener: extOwn, cmdNamesPath: extPath } = require('../vscode-extension/out/portScanner.js');

const impls = { 'mcp-server': mcpMatch, 'vscode-extension': extMatch };
const helpers = { 'mcp-server': [mcpOwn, mcpPath], 'vscode-extension': [extOwn, extPath] };

// The kill paths (kill_port, stop_app, the extension's Stop and Kill) refuse PortPilot's own listeners
// by name or command line, since a stdio MCP child knows no pids of the desktop app.
for (const [label, [isOwn, namesPath]] of Object.entries(helpers)) {
  assert.ok(isOwn({ processName: 'PortPilot.exe', commandLine: '' }), `${label}: PortPilot.exe is own`);
  assert.ok(isOwn({ processName: 'electron.exe', commandLine: 'electron.exe I:\\Scratch\\PortPilot-2026\\mcp-server\\index.js --port 8788' }), `${label}: the dev MCP child is own`);
  assert.strictEqual(isOwn({ processName: 'node.exe', commandLine: 'node I:\\work\\shop\\mcp-server\\index.js --tag portpilot' }), false, `${label}: a user mcp-server is not`);
  assert.ok(namesPath('sh -c "cd /x/app;npm run dev"', '/x/app'), `${label}: a path before ; is found`);
  assert.strictEqual(namesPath('node /x/app-worktree/s.js', '/x/app'), false, `${label}: a longer path is not`);
}

const solaisoft = { id: 'a', name: 'Solaisoft', cwd: 'I:\\Scratch\\solaisoft', preferredPort: 3002 };

for (const [label, matchRunning] of Object.entries(impls)) {
  // A Brave started for design work, with a scratch profile whose path carries the project name.
  const brave = {
    port: 9222, pid: 1, processName: 'brave.exe',
    commandLine: '"C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe" --remote-debugging-port=9222 --user-data-dir=F:\\Temp\\claude\\i--Scratch-solaisoft\\scratchpad\\brave-profile',
  };
  assert.strictEqual(matchRunning([solaisoft], [brave]).has('a'), false, `${label}: a browser debug port is not the Solaisoft server`);

  // The real server still wins: node on a dynamic port, started from the project folder.
  const next = {
    port: 24105, pid: 2, processName: 'node.exe',
    commandLine: '"C:\\Program Files\\nodejs\\node.exe" I:\\Scratch\\solaisoft\\node_modules\\next\\dist\\bin\\next dev -p 24105',
  };
  const found = matchRunning([solaisoft], [brave, next]).get('a');
  assert.strictEqual(found && found.port, 24105, `${label}: the node server is found next to the browser`);

  // An editor and an agent that happen to have the project open hold ports too.
  const ssf = { id: 's', name: 'SSF Site (Next.js)', cwd: 'I:\\Scratch\\ssf-site' };
  const editor = { port: 24106, pid: 3, processName: 'Code.exe', commandLine: '"C:\\Program Files\\Microsoft VS Code\\Code.exe" I:\\Scratch\\ssf-site' };
  const agent = { port: 50823, pid: 4, processName: 'claude.exe', commandLine: 'claude.exe --add-dir I:\\Scratch\\ssf-site' };
  assert.strictEqual(matchRunning([ssf], [editor, agent]).has('s'), false, `${label}: an editor or an agent with the folder open is not the server`);

  // A generic word in one app's name ("clone") appears in another app's server path. Fuzzy keywords must
  // not claim that port before the other app's own preferredPort gets its turn.
  const roofing = { id: 'r', name: 'roofing-clone', cwd: 'i:\\Scratch\\solaisoft\\demos\\roofing-clone', preferredPort: 4577 };
  const hawk = { id: 'g', name: 'glancehawk-web', cwd: 'I:/Scratch/clone-outrank-experiment/web', preferredPort: 3420 };
  const hawkServer = {
    port: 3420, pid: 5, processName: 'node.exe',
    commandLine: '"C:\\Program Files\\nodejs\\node.exe" I:\\Scratch\\clone-outrank-experiment\\web\\node_modules\\next\\dist\\server\\lib\\start-server.js',
  };
  const roofingServer = { port: 4577, pid: 6, processName: 'python.exe', commandLine: 'python -m http.server 4577' };
  const both = matchRunning([roofing, hawk], [hawkServer, roofingServer]);
  assert.strictEqual(both.get('g') && both.get('g').port, 3420, `${label}: glancehawk-web keeps its own port`);
  assert.strictEqual(both.get('r') && both.get('r').port, 4577, `${label}: roofing-clone is not given glancehawk's port`);

  // PortPilot's own MCP server carries "portpilot" on its command line. The "PortPilot" app entry (the web
  // agent, npm run agent) must not be shown as running on 8788: Open would hit the MCP endpoint and Stop
  // would kill the tools out from under every Claude session. Packaged and dev command lines.
  const self = { id: 'pp', name: 'PortPilot', cwd: 'I:/Scratch/PortPilot-2026', preferredPort: 7317 };
  const packagedMcp = {
    port: 8788, pid: 7, processName: 'PortPilot.exe',
    commandLine: '"C:\\Users\\me\\AppData\\Local\\Programs\\PortPilot\\PortPilot.exe" C:\\Users\\me\\AppData\\Local\\Programs\\PortPilot\\resources\\mcp-server\\index.js --port 8788',
  };
  const devMcp = {
    port: 8788, pid: 8, processName: 'electron.exe',
    commandLine: '"I:\\Scratch\\PortPilot-2026\\node_modules\\electron\\dist\\electron.exe" I:\\Scratch\\PortPilot-2026\\mcp-server\\index.js --port 8788',
  };
  assert.strictEqual(matchRunning([self], [packagedMcp]).has('pp'), false, `${label}: the packaged MCP server is not the PortPilot app`);
  assert.strictEqual(matchRunning([self], [devMcp]).has('pp'), false, `${label}: the dev MCP server is not the PortPilot app`);
  const selfOn7317 = { ...packagedMcp, port: 7317, pid: 9 };
  assert.strictEqual(matchRunning([self], [selfOn7317]).has('pp'), false, `${label}: PortPilot.exe on the preferred port is still not the app`);
  const webAgent = { port: 7317, pid: 10, processName: 'node.exe', commandLine: 'node I:\\Scratch\\PortPilot-2026\\src\\agent\\server.js' };
  assert.strictEqual(matchRunning([self], [devMcp, webAgent]).get('pp')?.port, 7317, `${label}: the real web agent is still found`);

  // A cwd matches only at a path boundary: the parent's cwd is a prefix of its worktree's.
  const parent = { id: 'p', name: 'PortPilot', cwd: 'I:/Scratch/PortPilot-2026' };
  const child = { id: 'c', name: 'landing', cwd: 'I:/Scratch/PortPilot-2026-landing-redesign-340' };
  const childServer = { port: 7318, pid: 11, processName: 'node.exe', commandLine: 'node I:\\Scratch\\PortPilot-2026-landing-redesign-340\\src\\agent\\server.js' };
  const wt = matchRunning([parent, child], [childServer]);
  assert.strictEqual(wt.has('p'), false, `${label}: the parent does not claim its worktree's server`);
  assert.strictEqual(wt.get('c')?.port, 7318, `${label}: the worktree app gets its own server`);
}

console.log('running-match: ok');
