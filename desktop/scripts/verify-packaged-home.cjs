'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { extractFile } = require('@electron/asar');

const root = path.resolve(__dirname, '..');
const archive = path.join(root, 'dist/win-unpacked/resources/app.asar');
const shell = fs.readdirSync(path.join(root, 'shell')).filter(name => /\.(?:html|css|js)$/.test(name));
for (const name of ['main.cjs', 'flight-popup.cjs', 'windows-identity.cjs', 'company-calendar.cjs', ...shell.map(file => 'shell/' + file)]) {
  assert.ok(extractFile(archive, name).equals(fs.readFileSync(path.join(root, name))), 'Installed file differs: ' + name);
}
assert.equal(JSON.parse(extractFile(archive, 'package.json')).version, require('../package.json').version);
const icon = fs.readFileSync(path.join(root, 'assets', 'icon.ico'));
for (const name of ['app-icon.ico', 'nenova-taskbar.ico']) {
  assert.deepEqual(fs.readFileSync(path.join(path.dirname(archive), name)), icon, name);
}
const sizes = new Set();
for (let i = 0; i < icon.readUInt16LE(4); i++) {
  const entry = 6 + 16 * i;
  assert.equal(icon[entry], icon[entry + 1]);
  sizes.add(icon[entry] || 256);
}
for (const required of [16, 20, 24, 32, 40, 48, 64, 128, 256]) assert.ok(sizes.has(required), 'Missing icon size ' + required);
console.log('Packaged Windows home, notes, calendar bridge and app version match their release sources.');
