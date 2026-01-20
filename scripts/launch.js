#!/usr/bin/env node
/**
 * Cross-platform launcher that clears ELECTRON_RUN_AS_NODE
 * before starting Electron (fixes VS Code/Claude Code environment issue)
 */
const { spawn } = require('child_process');
const path = require('path');

// Clear the problematic env var
delete process.env.ELECTRON_RUN_AS_NODE;

// Get electron path
const electronPath = require('electron');

// Get args (skip 'node' and 'launch.js')
const args = ['.', ...process.argv.slice(2)];

// Spawn electron
const child = spawn(electronPath, args, {
  stdio: 'inherit',
  cwd: __dirname,
  env: process.env
});

child.on('close', (code) => {
  process.exit(code);
});
