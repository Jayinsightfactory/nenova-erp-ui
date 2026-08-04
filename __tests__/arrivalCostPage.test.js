import fs from 'node:fs';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('../pages/arrival-cost.js', import.meta.url), 'utf8');

assert.match(source, /const formElement = event\.currentTarget;/);
assert.match(source, /const file = formElement\.elements\.namedItem\('file'\)\?\.files\?\.\[0\];/);
assert.match(source, /formElement\.reset\(\);/);
assert.doesNotMatch(source, /event\.currentTarget\.reset\(\);/);
assert.doesNotMatch(source, /import Layout from/);
assert.doesNotMatch(source, /<Layout title="도착원가">/);

console.log('arrival cost upload form regression tests passed');
