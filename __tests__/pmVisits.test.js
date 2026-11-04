// __tests__/pmVisits.test.js — /pm 접속 기록: 하루 1회만 기록·KST 날짜·120일 정리
// 실행: node __tests__/pmVisits.test.js (임시 파일만 사용, MSSQL 불필요)
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const src = fs.readFileSync(path.join(process.cwd(), 'lib', 'pmVisits.js'), 'utf8')
  .replace(/^import (\w+) from '(\w+)';/gm, "const $1 = require('$2');")
  .replace(/^export (const|function) /gm, '$1 ')
  + '\nmodule.exports = { readVisits, recordVisit, kstDay };';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmv-'));
const mod = path.join(dir, 'pmVisits.cjs');
fs.writeFileSync(mod, src);
const m = require(mod);
const file = path.join(dir, 'runtime', 'pm-visits.json');

// KST 날짜: UTC 2026-11-03 23:00 = KST 11-04
assert.strictEqual(m.kstDay(Date.parse('2026-11-03T23:00:00Z')), '2026-11-04');

const now = Date.parse('2026-11-04T03:00:00Z');
assert.strictEqual(m.recordVisit('설연주', { file, now }), true, '첫 기록 true');
assert.strictEqual(m.recordVisit('설연주', { file, now: now + 60000 }), false, '같은 날 중복 false');
assert.strictEqual(m.recordVisit('강현우', { file, now }), true);
assert.strictEqual(m.recordVisit('', { file, now }), false, '빈 이름 무시');
let v = m.readVisits(file);
assert.deepStrictEqual(v.days['2026-11-04'].sort(), ['강현우', '설연주']);

// 다음 날은 다시 기록
assert.strictEqual(m.recordVisit('설연주', { file, now: now + 86400e3 }), true);

// 120일 지난 날짜는 정리
const old = m.readVisits(file);
old.days['2026-01-01'] = ['옛날'];
fs.writeFileSync(file, JSON.stringify(old));
m.recordVisit('김원빈', { file, now: now + 86400e3 });
v = m.readVisits(file);
assert.ok(!v.days['2026-01-01'], '120일 초과 정리');

// 깨진 파일은 빈 상태로
fs.writeFileSync(file, '{broken');
assert.deepStrictEqual(m.readVisits(file), { days: {} });
assert.strictEqual(m.recordVisit('설연주', { file, now }), true, '깨진 파일에서도 기록 복구');

console.log('pmVisits.test.js OK');
