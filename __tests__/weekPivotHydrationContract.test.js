const assert = require('node:assert/strict');
const fs = require('node:fs');

const page = fs.readFileSync('pages/shipment/week-pivot.js', 'utf8');
const hook = fs.readFileSync('lib/useWeekInput.js', 'utf8');
const runtimeSmoke = fs.readFileSync('scripts/week-pivot-hydration-smoke.js', 'utf8');
const deployWorkflow = fs.readFileSync('.github/workflows/deploy.yml', 'utf8');

assert.match(page, /import \{ getCurrentWeek, useWeekInput, WeekInput \} from '\.\.\/\.\.\/lib\/useWeekInput'/);
assert.match(hook, /useWeekInput\(initial, \{ deferDefault = false \} = \{\}\)/);
assert.match(hook, /deferDefault\s*\?\s*String\(initial \|\| ''\)/);
assert.match(page, /useWeekInput\('', \{ deferDefault: true \}\)/);
assert.match(page, /const \[wpColWidths, setWpColWidths\] = useState\(\{\}\)/);
assert.doesNotMatch(page, /useState\(\(\) => \{\s*try \{ return JSON\.parse\(localStorage\.getItem\('wp_col_w'/);
assert.match(page, /savedWidths = JSON\.parse\(localStorage\.getItem\('wp_col_w'\)/);
assert.match(page, /const currentWeek = getCurrentWeek\(\)/);
assert.match(page, /\|\| currentWeek/);
assert.doesNotMatch(page, /font-family: 'Malgun Gothic'/);
assert.match(runtimeSmoke, /page\.on\('pageerror'/);
assert.match(runtimeSmoke, /mount 후 YYYY-NN-NN 차수 미표시/);
assert.match(deployWorkflow, /scripts\/week-pivot-hydration-smoke\.js/);

console.log('week pivot SSR/hydration contract tests passed');
