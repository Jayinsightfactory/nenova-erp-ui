// __tests__/pmStages.test.js — /pm 복도 9단계: 키워드 규칙 매핑·미확인·복도 합계·점 방향·최근 1시간 선
// 실행: node __tests__/pmStages.test.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pms-'));
const src = fs.readFileSync(path.join(process.cwd(), 'lib', 'pmStages.js'), 'utf8').replace(/^export (const|function) /gm, '$1 ')
  + '\nmodule.exports = { STAGES, stageOf, stageLabel, personStageHours, buildCorridor, flowDirection, staffLinks, lineWidth };';
fs.writeFileSync(path.join(dir, 'pmStages.cjs'), src);
const m = require(path.join(dir, 'pmStages.cjs'));

const cases = [
  ['출고 분배', 3], ['입고 물량 거래처별 배분', 3], ['견적서 관리', 5], ['선출고 견적서 작성·확정', 5],
  ['해외 송금 신청', 8], ['송금기록', 8], ['인보이스 확인', 2], ['입고 관리', 2], ['도착원가 팝업', 2],
  ['거래처 발주내역 엑셀 정리', 1], ['신규 주문 등록', 1], ['오더 정리', 1], ['현장 출고', 4], ['출고 관리', 4],
  ['입금 확인', 7], ['채권 현황', 7], ['주차별 매출이익', 9], ['거래처 전달', 6],
  ['재고관리', 0], ['(화면 미해독)', 0], ['엑셀', 0], ['', 0], [null, 0],
];
for (const [t, want] of cases) assert.strictEqual(m.stageOf(t), want, `${t} → ${want}`);
assert.strictEqual(m.STAGES.length, 9);
assert.strictEqual(m.stageLabel(0), '미확인');
assert.strictEqual(m.stageLabel(5), '견적');

const people = [
  { name: 'A', workflows: [{ name: '입고 물량 거래처별 배분', measuredHoursPerWeek: 4.2 }, { name: '잡무', measuredHoursPerWeek: 1 }, { name: '견적서 확정', measuredHoursPerWeek: 0.5 }] },
  { name: 'B', workflows: [{ name: '정리', feature: { menu: '출고 분배' }, measuredHoursPerWeek: 2 }, { name: '0시간', measuredHoursPerWeek: 0 }] },
  { workflows: [{ name: '분배', measuredHoursPerWeek: 99 }] },
];
const c = m.buildCorridor(people);
assert.strictEqual(c.stages[2].h, 6.2);
assert.deepStrictEqual(c.stages[2].people.map((p) => p.name), ['A', 'B']);
assert.strictEqual(c.stages[4].h, 0.5);
assert.strictEqual(c.unknownH, 1);
assert.strictEqual(c.totalH, 7.7);
assert.strictEqual(c.unknownRatio, 13);
assert.deepStrictEqual(c.perPerson.B, { 3: 2 });
assert.strictEqual(m.buildCorridor(null).unknownRatio, null);

assert.strictEqual(m.flowDirection('카톡 열람'), 'toDesk');
assert.strictEqual(m.flowDirection('read'), 'toDesk');
assert.strictEqual(m.flowDirection('입력'), 'toStage');
assert.strictEqual(m.flowDirection('send'), 'toStage');
assert.strictEqual(m.flowDirection(''), 'none');
assert.strictEqual(m.flowDirection('엑셀'), 'none');

const now = Date.parse('2026-11-03T05:00:00Z');
const ago = (min) => new Date(now - min * 60e3).toISOString();
const L = m.staffLinks({ status: 'working', app: '네노바 전산', screen: '출고 분배', action: '입력', recent: [
  { screen: '견적서 관리', at: ago(10), action: '열람' }, { screen: '출고 분배', at: ago(5) }, { screen: '송금', at: ago(70) },
  { screen: '재고관리', at: ago(3) }, { screen: '입고', at: ago(20) }, { screen: '발주', at: ago(30) }, { screen: '입금', at: ago(40) },
] }, now);
assert.deepStrictEqual(L.current, { stage: 3, text: '출고 분배', dir: 'toStage' });
assert.deepStrictEqual(L.recent.map((r) => r.stage), [5, 2, 1]);
assert.strictEqual(L.recent[0].dir, 'toDesk');
assert.deepStrictEqual(m.staffLinks({ status: 'working', app: '엑셀' }, now), { current: null, recent: [] });
assert.deepStrictEqual(m.staffLinks({ status: 'off', screen: '견적' }, now), { current: null, recent: [] });

assert.strictEqual(m.lineWidth(0, 5), 2);
assert.strictEqual(m.lineWidth(5, 5), 6);
assert.strictEqual(m.lineWidth(10, 5), 6);
assert.strictEqual(m.lineWidth(2.5, 5), 3.8);
console.log('pmStages tests passed');
