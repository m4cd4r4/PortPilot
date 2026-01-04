/**
 * Manual Test Report Generator
 * Monitors ports and creates a test report
 */
const { execSync } = require('child_process');

function getPortInfo(port) {
  try {
    const output = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf-8' });
    const lines = output.split('\n');
    for (const line of lines) {
      if (line.includes('LISTENING')) {
        const parts = line.trim().split(/\s+/);
        return {
          port,
          listening: true,
          pid: parseInt(parts[parts.length - 1]),
          address: parts[1]
        };
      }
    }
  } catch {
    return { port, listening: false };
  }
}

function getAllListeningPorts() {
  try {
    const output = execSync('netstat -ano | findstr LISTENING', { encoding: 'utf-8' });
    const lines = output.split('\n').filter(Boolean);
    const ports = new Set();

    for (const line of lines) {
      const match = line.match(/:(\d+)\s/);
      if (match) {
        const port = parseInt(match[1]);
        if (port >= 3000 && port <= 9000) {
          ports.add(port);
        }
      }
    }

    return Array.from(ports).sort((a, b) => a - b);
  } catch {
    return [];
  }
}

console.log('\n========================================');
console.log('  PortPilot Manual Test Report');
console.log('========================================\n');

console.log('📊 Current Port Status:\n');

const testPorts = [3000, 3001, 8080];
const allPorts = getAllListeningPorts();

console.log(`Total listening ports (3000-9000 range): ${allPorts.length}`);
console.log(`Ports: ${allPorts.join(', ')}\n`);

console.log('Test Server Status:');
for (const port of testPorts) {
  const info = getPortInfo(port);
  if (info.listening) {
    console.log(`  ✅ Port ${port}: RUNNING (PID ${info.pid})`);
  } else {
    console.log(`  ❌ Port ${port}: NOT RUNNING`);
  }
}

console.log('\n========================================');
console.log('  Manual Test Instructions');
console.log('========================================\n');

console.log('1. PortPilot should be running');
console.log('2. Click "Scan Ports" to see all active ports');
console.log('3. Find one of the test ports (3000, 3001, or 8080)');
console.log('4. Click the red "✕" kill button');
console.log('5. Confirm the dialog');
console.log('6. Run this script again to verify the port was killed\n');

console.log('🎯 Expected Result:');
console.log('   The killed port should change from ✅ to ❌\n');

console.log('========================================\n');
