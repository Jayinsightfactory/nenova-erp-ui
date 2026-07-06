/**
 * 주문 연도·차수 분리 — 2026 차수 선택 시 2025 OrderMaster에 붙지 않도록
 */
import { normalizeOrderYear, validateOrderWeek, resolveOrderWeekQuery, orderRowMatchesWeek } from '../lib/orderUtils.js';

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

console.log(`\n=== orderYearWeek: ${pass} pass, ${fail} fail ===`);
process.exit(fail > 0 ? 1 : 0);
