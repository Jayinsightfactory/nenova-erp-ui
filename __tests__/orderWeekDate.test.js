import assert from 'node:assert/strict';
import {
  yearWeek1Start,
  orderWeekToDateRange,
  formatOrderWeekDateRange,
  formatOrderWeekLabelWithDate,
  parseWeekSeq,
} from '../lib/orderWeekDate.js';

const iso = (d) => d.toISOString().slice(0, 10);

// 사용자 확인 fixture (2026-09-07): 2025년 52차 종료 = 2025-12-30, 2026년 01차 시작 = 2025-12-31
assert.equal(iso(yearWeek1Start(2026)), '2025-12-31', '2026년 01-01은 2025-12-31(수)에 시작해야 한다.');
{
  const r52 = orderWeekToDateRange(2025, 52, 2);
  assert.equal(iso(r52.end), '2025-12-30', '2025년 52차(후반) 종료일은 12/30이어야 한다.');
}

// 사용자 확인 fixture: 2026년 36차 = 9/2(수)~9/8(화), 전반 9/2~9/4, 후반 9/5~9/8
{
  const r1 = orderWeekToDateRange(2026, 36, 1);
  const r2 = orderWeekToDateRange(2026, 36, 2);
  assert.equal(iso(r1.start), '2026-09-02', '36-01 시작은 9/2여야 한다.');
  assert.equal(iso(r1.end), '2026-09-04', '36-01 종료는 9/4여야 한다.');
  assert.equal(iso(r2.start), '2026-09-05', '36-02 시작은 9/5여야 한다.');
  assert.equal(iso(r2.end), '2026-09-08', '36-02 종료는 9/8이어야 한다.');
}

assert.equal(formatOrderWeekDateRange(2026, '36-01'), '9/2~9/4');
assert.equal(formatOrderWeekDateRange(2026, '36-02'), '9/5~9/8');
assert.equal(formatOrderWeekDateRange(2026, '36-01', '36-02'), '9/2~9/8', '전반~후반 범위는 전체 7일로 합쳐져야 한다.');
assert.match(formatOrderWeekDateRange(2026, '01-01'), /^\d+\/\d+~\d+\/\d+$/, '01-01도 정상적인 날짜 범위 문자열을 반환해야 한다.');

assert.equal(formatOrderWeekLabelWithDate(2026, '36-01', '36-02'), '2026 36-01~36-02 (9/2~9/8)');
assert.equal(formatOrderWeekLabelWithDate(2026, '36-01'), '2026 36-01 (9/2~9/4)');

// arrival-cost.js는 0채움 없는 'WW-S' 형식(예: '37-1')을 쓴다 — 둘 다 지원해야 한다.
assert.deepEqual(parseWeekSeq('37-1'), { week: 37, seq: 1 });
assert.deepEqual(parseWeekSeq('37-01'), { week: 37, seq: 1 });
assert.equal(parseWeekSeq(''), null);
assert.equal(parseWeekSeq('37'), null);
assert.equal(formatOrderWeekDateRange(2026, '36-1'), '9/2~9/4', '0채움 없는 표기도 동일하게 계산돼야 한다.');

// 매년 1차 시작일은 항상 수요일이어야 한다 (임의의 3개년 표본).
for (const y of [2024, 2025, 2026, 2027, 2028]) {
  assert.equal(yearWeek1Start(y).getUTCDay(), 3, `${y}년 01-01 시작일은 수요일이어야 한다.`);
}

console.log('orderWeekDate tests passed');
