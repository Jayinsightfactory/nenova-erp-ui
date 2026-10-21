// 거래처별 이익 순수 함수: 배분·합계 보존(골든)·월 귀속·목표 최신행·입력검증. DB 없이 실행.
import assert from 'node:assert/strict';
import {
  allocateCents, allocateWeek, mergeAllocations, buildRows, monthOfWeek, weeksOfMonth,
  achievementPct, latestTargets, validateTargetInput, UNALLOCATED_KEY,
} from '../lib/mgmt/customerProfitCore.js';

// 센트 배분: 합 보존, 음수, 0 가중치
assert.deepEqual(allocateCents(100, [1, 1, 1]), [34, 33, 33]);
assert.equal(allocateCents(100, [1, 1, 1]).reduce((s, v) => s + v, 0), 100);
assert.equal(allocateCents(-101, [3, 1]).reduce((s, v) => s + v, 0), -101);
assert.equal(allocateCents(50, [0, 0]), null);

// 차수 배분: 카테고리별 비중, 근거 없는 카테고리는 미배분 키로 → 합계 보존
const cats = [
  { category: '콜롬비아', C: 1000.37, J: 333.33 },
  { category: '네덜란드', C: 500, J: -20.5 },
  { category: '공제', C: -50, J: -50 },
];
const sales = [
  { custKey: 1, category: '콜롬비아', amount: 700 },
  { custKey: 2, category: '콜롬비아', amount: 300 },
  { custKey: 2, category: '네덜란드', amount: 100 },
];
const w1 = allocateWeek(cats, sales);
const sum = (m, k) => [...m.values()].reduce((s, v) => s + v[k], 0);
assert.equal(sum(w1, 'profitCents'), Math.round((333.33 - 20.5 - 50) * 100));
assert.equal(sum(w1, 'salesCents'), Math.round((1000.37 + 500 - 50) * 100));
assert.ok(w1.has(UNALLOCATED_KEY), '출고 근거 없는 공제는 미배분 행');
assert.equal(w1.get(UNALLOCATED_KEY).profitCents, -5000);
assert.equal(w1.get(2).profitCents + w1.get(1).profitCents, Math.round((333.33 - 20.5) * 100));

// 여러 차수 합산 후 골든 대조
const w2 = allocateWeek([{ category: '콜롬비아', C: 200, J: 80 }], [{ custKey: 3, category: '콜롬비아', amount: 1 }]);
const merged = mergeAllocations([w1, w2]);
const reportTotal = 333.33 - 20.5 - 50 + 80;
const nameOf = new Map([[1, 'A화원'], [2, 'B꽃집'], [3, 'C']]);
const built = buildRows(merged, nameOf, new Map([[1, { targetSalesKRW: 1000, targetProfitKRW: 100 }]]), reportTotal);
assert.equal(built.golden.ok, true);
assert.equal(built.golden.diff, 0);
assert.equal(built.golden.sumByCustomer, built.totals.profitKRW);
assert.equal(built.rows.find((r) => r.custKey === 1).targetSalesKRW, 1000);
assert.equal(built.rows.find((r) => r.custKey === 2).targetSalesKRW, null);
// 보고서 총이익과 어긋나면 경고
assert.equal(buildRows(merged, nameOf, new Map(), reportTotal + 10).golden.ok, false);

// 달성률
assert.equal(achievementPct(50, 200), 25);
assert.equal(achievementPct(50, null), null);
assert.equal(achievementPct(50, 0), null);

// 월 귀속: 2026-26차 시작 수요일 = 2026-07-01(orderWeekDate 규칙 2025-12-31 시작 01차 기준)
assert.equal(monthOfWeek(2026, 1), '2025-12'); // 신년 1차 시작 2025-12-31 → 12월 귀속, OrderYear 는 2026 으로 명시 보존
assert.ok(weeksOfMonth('2025-12').some((w) => w.orderYear === '2026' && w.major === '01'));
assert.ok(weeksOfMonth('2025-12').some((w) => w.orderYear === '2025' && w.major === '52'));
const jul = weeksOfMonth('2026-07');
assert.ok(jul.length >= 4 && jul.length <= 5);
assert.equal(new Set(jul.map((w) => `${w.orderYear}-${w.major}`)).size, jul.length);
assert.deepEqual(weeksOfMonth('bad'), []);

// 목표: 최신 행(TargetKey 큼)이 현재 목표
const lt = latestTargets([
  { TargetKey: 1, CustKey: 5, TargetSalesKRW: 100, TargetProfitKRW: 10 },
  { TargetKey: 3, CustKey: 5, TargetSalesKRW: 300, TargetProfitKRW: null },
  { TargetKey: 2, CustKey: 5, TargetSalesKRW: 200, TargetProfitKRW: 20 },
]);
assert.equal(lt.get(5).targetSalesKRW, 300);
assert.equal(lt.get(5).targetProfitKRW, null);

// 입력 검증
assert.equal(validateTargetInput({ custKey: 1, targetMonth: '2026-07', targetSalesKRW: '1,000', targetProfitKRW: '' }).targetSalesKRW, 1000);
assert.ok(validateTargetInput({ custKey: 1, targetMonth: '2026-13', targetSalesKRW: 1 }).error);
assert.ok(validateTargetInput({ custKey: 0, targetMonth: '2026-07', targetSalesKRW: 1 }).error);
assert.ok(validateTargetInput({ custKey: 1, targetMonth: '2026-07' }).error);
assert.ok(validateTargetInput({ custKey: 1, targetMonth: '2026-07', targetSalesKRW: 'abc' }).error);

console.log('mgmtCustomerProfit.test.js OK');
