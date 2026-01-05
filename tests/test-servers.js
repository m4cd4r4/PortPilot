/**
 * Test Servers for PortPilot Comprehensive Tests
 *
 * Spawns simple HTTP servers on ports 3000, 3001, and 8080
 * for testing port detection, filtering, and kill functionality.
 */

const http = require('http');

const servers = [];
const ports = [3000, 3001, 8080];

// Create simple HTTP servers
ports.forEach(port => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(`Test server running on port ${port}\n`);
  });

  server.listen(port, () => {
    console.log(`✓ Test server started on port ${port}`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`⚠ Port ${port} already in use`);
    } else {
      console.error(`✗ Error on port ${port}:`, err.message);
    }
  });

  servers.push(server);
});

// Keep servers running
console.log('\n========================================');
console.log('  Test Servers Running');
console.log('========================================');
console.log('Ports: 3000, 3001, 8080');
console.log('Press Ctrl+C to stop');
console.log('========================================\n');

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\nShutting down test servers...');
  servers.forEach((server, i) => {
    server.close(() => {
      console.log(`✓ Server on port ${ports[i]} closed`);
    });
  });
  setTimeout(() => {
    console.log('All servers stopped.\n');
    process.exit(0);
  }, 1000);
});

// Keep process alive
process.stdin.resume();
