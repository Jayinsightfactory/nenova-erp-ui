'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { extractFile } = require('@electron/asar');

const root = path.resolve(__dirname, '..');
const archive = path.join(root, 'dist/win-unpacked/resources/app.asar');
const shell = fs.readdirSync(path.join(root, 'shell')).filter(name => /\.(?:html|css|js)$/.test(name));
for (const name of ['company-calendar.cjs', ...shell.map(file => 'shell/' + file)]) {
  assert.ok(extractFile(archive, name).equals(fs.readFileSync(path.join(root, name))), 'Installed file differs: ' + name);
}
assert.equal(JSON.parse(extractFile(archive, 'package.json')).version, require('../package.json').version);
console.log('Packaged Windows home, notes, calendar bridge and app version match their release sources.');
