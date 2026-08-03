const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const scope = read('docs/NENOVA_WEB_COMPATIBILITY_SCOPE.md');
const agents = read('AGENTS.md');
const claudeSkill = read('.claude/skills/nenova-erp-change-guard/SKILL.md');
const db = read('docs/DB_STRUCTURE.md');

assert.match(scope, /Nenovaweb.*nenova\.exe/s);
assert.match(scope, /Android 15\/16/);
assert.match(scope, /MOYI/);
assert.match(scope, /OrderYear.*OrderWeek.*CustKey.*ProdKey/s);
assert.match(scope, /test:erp-contract/);
assert.match(agents, /NENOVA_WEB_COMPATIBILITY_SCOPE\.md/);
assert.match(claudeSkill, /Android\/Google Play/);
assert.match(db, /PaymentDay.*5.*15.*25.*30/);

console.log('Nenovaweb compatibility scope tests passed');
