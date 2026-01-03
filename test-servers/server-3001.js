// Test server on port 3001
const http = require('http');

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<h1>Test Server 3001</h1><p>Running for PortPilot testing</p>');
});

server.listen(3001, () => {
  console.log('Test server running on http://localhost:3001');
});

process.on('SIGTERM', () => {
  console.log('Server 3001 shutting down...');
  server.close(() => process.exit(0));
});
