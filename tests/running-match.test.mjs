// Which listening port is an app's own server? The MCP server and the VS Code extension each carry
// the matcher, so every case runs against both. Pure: ports arrive with their command lines.
import assert from 'node:assert';
import { createRequire } from 'node:module';
import { matchRunning as mcpMatch } from '../mcp-server/index.js';

const require = createRequire(import.meta.url);
const { matchRunning: extMatch } = require('../vscode-extension/out/portScanner.js');

const impls = { 'mcp-server': mcpMatch, 'vscode-extension': extMatch };

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
}

console.log('running-match: ok');
