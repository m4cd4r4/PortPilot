/**
 * Simple HTTP test servers for E2E testing
 * Starts servers on ports 3000, 3001, and 8080
 */
const http = require('http');

const servers = [];

function createTestServer(port, name) {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(`Test Server ${name} running on port ${port}\n`);
  });

  return new Promise((resolve, reject) => {
    server.listen(port, () => {
      console.log(`✅ Test server "${name}" started on port ${port}`);
      servers.push({ server, port, name });
      resolve(server);
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.log(`⚠️  Port ${port} already in use (server may already be running)`);
        resolve(null); // Don't fail, just skip
      } else {
        reject(err);
      }
    });
  });
}

async function startTestServers() {
  console.log('\n🚀 Starting test HTTP servers...\n');

  try {
    await Promise.all([
      createTestServer(3000, 'Server A'),
      createTestServer(3001, 'Server B'),
      createTestServer(8080, 'Server C')
    ]);

    console.log(`\n✅ ${servers.length} test servers ready\n`);
    return servers;
  } catch (error) {
    console.error('❌ Failed to start test servers:', error);
    throw error;
  }
}

function stopTestServers() {
  console.log('\n🛑 Stopping test servers...');

  servers.forEach(({ server, port, name }) => {
    try {
      server.close(() => {
        console.log(`✅ Stopped "${name}" on port ${port}`);
      });
    } catch (err) {
      console.error(`⚠️  Error stopping server on port ${port}:`, err.message);
    }
  });

  servers.length = 0; // Clear array
  console.log('✅ All test servers stopped\n');
}

module.exports = {
  startTestServers,
  stopTestServers,
  servers
};
