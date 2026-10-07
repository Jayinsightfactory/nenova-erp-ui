'use strict';

// Launches two separate Electron processes against one safe, temporary profile.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'nenova-restore-smoke-'));
const phaseScript = path.join(__dirname, 'restore-smoke.cjs');
const electronPath = require('../node_modules/electron');

function runPhase(phase) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(electronPath, [phaseScript, phase, profile], {
    cwd: path.resolve(__dirname, '../..'), env, encoding: 'utf8', timeout: 90000, windowsHide: true,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  assert.equal(result.error, undefined, `${phase} Electron process launched: ${result.error || ''}`);
  assert.equal(result.signal, null, `${phase} Electron process exited normally: ${result.signal || ''}`);
  assert.equal(result.status, 0, `${phase} Electron process succeeded (status ${result.status})`);
}

try {
  runPhase('write');
  runPhase('read');
  console.log(`Separate-process restore smoke passed. Diagnostic profile retained at ${profile}`);
} catch (error) {
  console.error(`Restore smoke failed. Diagnostic profile retained at ${profile}`);
  console.error(error && error.stack || error);
  process.exitCode = 1;
}
