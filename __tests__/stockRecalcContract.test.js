const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('pages/api/dev/stock-recalc.js', 'utf8');

assert.match(source, /isAdminUser\(req\.user\)/);
assert.match(source, /status\(403\)/);
assert.match(source, /const orderYear = String\(source\.orderYear \|\| ''\)/);
assert.match(source, /!prodKey \|\| !orderYear \|\| !orderWeek/);
assert.match(source, /!\/\^\\d\{4\}\$\//);
assert.match(source, /WHERE sm\.OrderYear=@orderYear/);
assert.match(source, /orderYear: \{ type: sql\.NVarChar, value: orderYear \}/);
assert.match(source, /loadProductStock\(prodKey, orderYear, weekFrom, weekTo\)/);

console.log('stock recalc contract tests passed');
