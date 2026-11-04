// __tests__/pmAccount.test.js — /pm 로그인 계정→직원 매핑·본인 몫 권한
// 실행: node __tests__/pmAccount.test.js (MSSQL 불필요)
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const read = (f) => fs.readFileSync(path.join(process.cwd(), 'lib', f), 'utf8');
const roster = read('pmRoster.js').replace(/^export const /gm, 'const ');
const access = read('orbitReportAccess.js').replace(/^export (const|function) /gm, '$1 ');
const aliases = (read('pmStaff.js').match(/^export const NAME_ALIASES = .*$/m) || [''])[0].replace(/^export /, '');
const acct = read('pmAccount.js')
  .replace(/^import .*$/gm, '').replace(/^export \{[^}]*\};?$/gm, '')
  .replace(/^export (const|function) /gm, '$1 ');
const m = {};
new Function('module', 'require', 'process', `${roster}\n${access}\n${aliases}\n${acct}\nmodule.exports = { staffOfUser, canActFor };`)(m, require, process);
const { staffOfUser, canActFor } = m.exports;
const map = { kjh01: '강현우', bad: '없는사람' };
assert.strictEqual(staffOfUser({ userId: 'x', userName: '설연주' }, { map: {} }), '설연주');
assert.strictEqual(staffOfUser({ userId: 'x', userName: ' 아드리아나 ' }, { map: {} }), '김지니');
assert.strictEqual(staffOfUser({ userId: 'KJH01', userName: 'Kang' }, { map }), '강현우');
assert.strictEqual(staffOfUser({ userId: 'bad', userName: 'zz' }, { map }), null);
assert.strictEqual(staffOfUser({ userId: 'y', userName: '모르는사람' }, { map: {} }), null);
assert.strictEqual(canActFor({ userId: 'x', userName: '설연주' }, '설연주', { map: {} }), true);
assert.strictEqual(canActFor({ userId: 'x', userName: '설연주' }, '강현우', { map: {} }), false);
assert.strictEqual(canActFor({ userId: 'y', userName: '모르는사람' }, '강현우', { map: {} }), false);
assert.strictEqual(canActFor({ userId: 'nenovaSS3', userName: '관리자' }, '강현우', { map: {} }), true);
assert.strictEqual(canActFor(null, '강현우'), false);
console.log('pmAccount ok');
