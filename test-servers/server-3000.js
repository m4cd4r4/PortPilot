// Test server on port 3000
const http = require('http');

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<h1>Test Server 3000</h1><p>Running for PortPilot testing</p>');
});

server.listen(3000, () => {
  console.log('Test server running on http://localhost:3000');
});

// Keep process running
process.on('SIGTERM', () => {
  console.log('Server 3000 shutting down...');
  server.close(() => process.exit(0));
});
