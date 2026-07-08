/**
 * 주문 연도·차수 분리 — 2026 차수 선택 시 2025 OrderMaster에 붙지 않도록
 */
import { normalizeOrderYear, validateOrderWeek, resolveOrderWeekQuery, orderRowMatchesWeek, resolveActiveOrderYear } from '../lib/orderUtils.js';

let pass = 0;
let fail = 0;
const assert = (label, cond) => {
  if (cond) pass++;
  else { fail++; console.log(`  ✗ ${label}`); }
};

const v = validateOrderWeek('2026-29-01');
assert('YYYY-WW-SS year', v.year === '2026');
assert('YYYY-WW-SS week', v.week === '29-01');
assert('normalizeOrderYear from full', normalizeOrderYear('2026-29-01') === '2026');
assert('normalizeOrderYear short week legacy', normalizeOrderYear('29-01') === '2025');
assert('resolveOrderWeekQuery 2026', resolveOrderWeekQuery('2026-29-01').year === '2026');
assert('resolveOrderWeekQuery legacy', resolveOrderWeekQuery('29-01').year === '2025');
assert('orderRowMatchesWeek', orderRowMatchesWeek({ year: '2026', week: '2026-29-01' }, '2026-29-01'));

// 현역 데이터용 연도 해석 — NN-NN 이어도 2025 레거시로 빠지면 안 됨 (2026-07-08 연도분열 사고)
const CUR = new Date().getFullYear().toString();
assert('active: NN-NN → 현재연도', resolveActiveOrderYear('28-01') === CUR);
assert('active: 명시연도 우선', resolveActiveOrderYear('28-01', '2027') === '2027');
assert('active: 주차 내장연도', resolveActiveOrderYear('2025-28-01') === '2025');
assert('active: 명시 > 내장', resolveActiveOrderYear('2025-28-01', '2026') === '2026');
assert('active: fallback 지정', resolveActiveOrderYear('28-01', '', '2024') === '2024');
assert('active: 잘못된 명시연도 무시', resolveActiveOrderYear('28-01', 'abcd') === CUR);
assert('active: 빈 입력 → 현재연도', resolveActiveOrderYear('') === CUR);

console.log(`\n=== orderYearWeek: ${pass} pass, ${fail} fail ===`);
process.exit(fail > 0 ? 1 : 0);
