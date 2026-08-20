import fs from 'node:fs';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('../pages/arrival-cost.js', import.meta.url), 'utf8');

assert.match(source, /const formElement = event\.currentTarget;/);
assert.match(source, /const file = formElement\.elements\.namedItem\('file'\)\?\.files\?\.\[0\];/);
assert.match(source, /formElement\.reset\(\);/);
assert.doesNotMatch(source, /event\.currentTarget\.reset\(\);/);
assert.doesNotMatch(source, /import Layout from/);
assert.doesNotMatch(source, /<Layout title="도착원가">/);
assert.match(source, /품종을 선택하거나 전체보기를 누르세요/);
assert.match(source, /매칭데이터/);
assert.match(source, /applySearch\(\)/);
assert.doesNotMatch(source, /<label>국가 /);
assert.match(source, /aria-selected=/);
assert.match(source, /filters\.orderYear, filters\.orderWeek/);
assert.match(source, /matchedVarieties/);
assert.match(source, /const next = \{ \.\.\.filters, flower \}/);
assert.match(source, /전산 국가·품종\(CountryFlower\)/);
assert.match(source, /aria-label="국가·품종 선택"/);

const upload = fs.readFileSync(new URL('../pages/api/arrival-cost/upload.js', import.meta.url), 'utf8');
assert.match(upload, /detectedTableCount/, '표는 있는데 도착원가 금액이 비면 다른 안내를 해야 한다.');

console.log('arrival cost upload form regression tests passed');
