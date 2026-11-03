// __tests__/pmTimesave.test.js — /pm 업무 시간: 요약 정렬·사람 슬라이스(별칭)·버킷 top8+기타
// 실행: node __tests__/pmTimesave.test.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmt-'));
const cjs = (f, extra) => fs.readFileSync(path.join(process.cwd(), 'lib', f), 'utf8')
  .replace(/^import \{ (\w+) \} from '\.\/pmStaff';/m, "const { $1 } = require('./pmStaff.cjs');")
  .replace(/^export (const|function) /gm, '$1 ') + '\n' + extra;
fs.writeFileSync(path.join(dir, 'pmStaff.cjs'), cjs('pmStaff.js', 'module.exports = { findPerson };'));
fs.writeFileSync(path.join(dir, 'pmTimesave.cjs'), cjs('pmTimesave.js', 'module.exports = { timesaveSummary, timesavePerson, topBuckets };'));
const m = require(path.join(dir, 'pmTimesave.cjs'));

const ts = {
  generatedAt: 'g', method: 'm', totals: { activeHoursPerWeek: 100.04, assignedHoursPerWeek: 60, saveHoursPerWeek: 12 },
  features: [{ title: 'a', saveHoursPerWeek: 1 }, { title: 'b', saveHoursPerWeek: 5, people: ['김지니'] }],
  unproposed: [{ person: 'x', name: 'n1', measuredHoursPerWeek: 2 }, { person: 'y', name: 'n2', measuredHoursPerWeek: 9 }],
  people: [{ name: '아드리아나', activeHoursPerWeek: 30, otherHoursPerWeek: Object.fromEntries(Array.from({ length: 10 }, (_, i) => ['app' + i, i + 1])), workflows: [{ name: 'w1', measuredHoursPerWeek: 3 }, { name: 'w2', measuredHoursPerWeek: 7 }] }],
};
const s = m.timesaveSummary(ts);
assert.strictEqual(s.totals.activeHoursPerWeek, 100);
assert.deepStrictEqual(s.features.map((f) => f.title), ['b', 'a']);
assert.deepStrictEqual(s.unproposed.map((u) => u.name), ['n2', 'n1']);
const p = m.timesavePerson(ts, '김지니');
assert.ok(p && p.name === '아드리아나', '별칭');
assert.deepStrictEqual(p.workflows.map((w) => w.name), ['w2', 'w1']);
assert.strictEqual(p.other.length, 9);
assert.strictEqual(p.other[8].name, '기타');
assert.strictEqual(p.other[8].h, 3);
assert.strictEqual(m.timesavePerson(ts, '없는사람'), null);
assert.strictEqual(m.timesaveSummary(null), null);
console.log('pmTimesave tests passed');
