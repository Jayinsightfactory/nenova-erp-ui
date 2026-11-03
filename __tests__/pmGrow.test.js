// __tests__/pmGrow.test.js — /pm 키우기: 서버 성장 계산(비율·상한·틈 제한·제외·후퇴 없음·상태)
// 실행: node __tests__/pmGrow.test.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmg-'));
const src = fs.readFileSync(path.join(process.cwd(), 'lib', 'pmGrow.js'), 'utf8').replace(/^export (const|function) /gm, '$1 ')
  + '\nmodule.exports = { STAGES, EXCLUDED, DAILY_CAP, stageOf, cleanLabel, moodOf, advanceGrow, growView, kstDay };';
fs.writeFileSync(path.join(dir, 'pmGrow.cjs'), src);
const m = require(path.join(dir, 'pmGrow.cjs'));

const T0 = Date.parse('2026-11-03T01:00:00Z'); // KST 10:00
const office = (status, at) => ({ staff: [
  { name: '설연주', dept: '경영지원', status, lastAt: new Date(at).toISOString(), workLabel: '발주작업 중 (16:38)' },
  { name: '손지윤', dept: '영업부', status: 'working', lastAt: new Date(at).toISOString(), workLabel: 'x' },
] });

// 1분마다 1시간 working → 10점, 제외 인원 없음
let st = null;
for (let i = 0; i <= 60; i++) st = m.advanceGrow(st, office('working', T0 + i * 60000), T0 + i * 60000);
assert.ok(Math.abs(st.people['설연주'].points - 10) < 0.01, 'working 1h = 10');
assert.ok(!st.people['손지윤'], '손지윤 제외');
assert.deepStrictEqual(Object.keys(st.people['설연주'].today.reasons), ['발주작업']);

// 피드 3시간 끊김 → 그 틈은 5분만 인정
const t1 = T0 + 60 * 60000 + 3 * 3600000;
st = m.advanceGrow(st, office('working', t1), t1);
assert.ok(st.people['설연주'].points < 10 + 1, '틈 제한');

// 하루 상한 60
let s2 = null;
for (let i = 0; i <= 12 * 60; i++) s2 = m.advanceGrow(s2, office('working', T0 + i * 60000), T0 + i * 60000);
assert.ok(Math.abs(s2.people['설연주'].today.base - 60) < 0.01, '상한 60');

// 쉬어도 점수는 그대로(후퇴 없음), 외형만 졸기/시듦
const before = s2.people['설연주'].points;
const late = T0 + 12 * 3600000 + 4 * 24 * 3600000;
s2 = m.advanceGrow(s2, office('idle', T0 + 12 * 3600000), late);
assert.strictEqual(s2.people['설연주'].points, before, '후퇴 없음');
assert.strictEqual(m.moodOf(s2.people['설연주'], late), 'wilt');
assert.strictEqual(m.moodOf({ status: 'idle', lastActiveAt: new Date(late - 100 * 60000).toISOString() }, late), 'sleep');

// 단계·진행률
assert.strictEqual(m.stageOf(0).stage, 1);
assert.strictEqual(m.stageOf(600).name, '만개');
assert.strictEqual(m.stageOf(5000).progress, 1);
assert.ok(Math.abs(m.stageOf(150).progress - 0.5) < 1e-9);

// 화면 요약: 부서 정원
const v = m.growView(st, t1);
assert.strictEqual(v.gardens[0].dept, '경영지원');
assert.strictEqual(v.people[0].name, '설연주', '직원 이름이 단계 이름에 덮이지 않음');
assert.strictEqual(v.people[0].stageName, '씨앗');
assert.strictEqual(v.people[0].points, 11); // 1시간 10 + 3시간 틈 중 5분만 인정(≈0.83)
assert.strictEqual(m.cleanLabel('콜롬비아 분배작업 중 (16:36)'), '콜롬비아 분배작업');
console.log('pmGrow ok');
