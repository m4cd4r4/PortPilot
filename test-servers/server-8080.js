// Test server on port 8080
const http = require('http');

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<h1>Test Server 8080</h1><p>Running for PortPilot testing</p>');
});

server.listen(8080, () => {
  console.log('Test server running on http://localhost:8080');
});

process.on('SIGTERM', () => {
  console.log('Server 8080 shutting down...');
  server.close(() => process.exit(0));
});
