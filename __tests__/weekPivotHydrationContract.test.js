const assert = require('node:assert/strict');
const fs = require('node:fs');

const page = fs.readFileSync('pages/shipment/week-pivot.js', 'utf8');
const hook = fs.readFileSync('lib/useWeekInput.js', 'utf8');

assert.match(hook, /useWeekInput\(initial, \{ deferDefault = false \} = \{\}\)/);
assert.match(hook, /deferDefault\s*\?\s*String\(initial \|\| ''\)/);
assert.match(page, /useWeekInput\('', \{ deferDefault: true \}\)/);
assert.match(page, /const \[wpColWidths, setWpColWidths\] = useState\(\{\}\)/);
assert.doesNotMatch(page, /useState\(\(\) => \{\s*try \{ return JSON\.parse\(localStorage\.getItem\('wp_col_w'/);
assert.match(page, /savedWidths = JSON\.parse\(localStorage\.getItem\('wp_col_w'\)/);
assert.match(page, /const currentWeek = getCurrentWeek\(\)/);
assert.match(page, /\|\| currentWeek/);

console.log('week pivot SSR/hydration contract tests passed');
