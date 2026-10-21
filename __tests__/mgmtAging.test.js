// aging 순수 함수 + 합계 보존(골든: 구간 합 - 초과입금 == 채권 잔액 합계). DB 없이 실행.
import assert from 'node:assert/strict';
import { applyFifo, agingForCustomer, bucketOf, daysBetween, summarizeAging, sortAgingRows } from '../lib/mgmt/aging.js';

// 일수·구간 경계
assert.equal(daysBetween('2026-10-21', '2026-09-21'), 30);
assert.equal(daysBetween('2026-10-21', '2026-10-21'), 0);
assert.equal(bucketOf(0), 'd0_30');
assert.equal(bucketOf(30), 'd0_30');
assert.equal(bucketOf(31), 'd31_60');
assert.equal(bucketOf(60), 'd31_60');
assert.equal(bucketOf(61), 'd61_90');
assert.equal(bucketOf(90), 'd61_90');
assert.equal(bucketOf(91), 'd90p');

// FIFO: 입금은 오래된 청구부터 소진
const charges = [
  { date: '2026-10-10', amount: 300 },
  { date: '2026-06-01', amount: 100 },
  { date: '2026-08-01', amount: 200 },
];
const f = applyFifo(charges, 150);
assert.deepEqual(f.open, [{ date: '2026-08-01', amount: 150 }, { date: '2026-10-10', amount: 300 }]);
assert.equal(f.credit, 0);
assert.equal(applyFifo(charges, 0).open.length, 3);
const over = applyFifo(charges, 700);
assert.equal(over.open.length, 0);
assert.equal(over.credit, 100);

// 거래처 구간 배정 (기준일 2026-10-21)
const a = agingForCustomer(charges, 150, '2026-10-21');
assert.equal(a.d90p, 0);
assert.equal(a.d61_90, 150); // 08-01 → 81일
assert.equal(a.d0_30, 300);  // 10-10 → 11일
assert.equal(a.total, 450);
assert.equal(a.oldestDays, 81);
const b = agingForCustomer(charges, 0, '2026-10-21');
assert.equal(b.d90p, 100); // 06-01 → 142일
assert.equal(b.total, 600);

// 합계 보존: 여러 거래처, 초과입금 포함. 잔액 = 청구합 - 입금합
const fixture = [
  { custKey: 1, charges: [{ date: '2026-01-05', amount: 1000 }, { date: '2026-09-30', amount: 500 }], totalPaid: 400 },
  { custKey: 2, charges: [{ date: '2026-08-15', amount: 800 }], totalPaid: 800 },
  { custKey: 3, charges: [{ date: '2026-10-01', amount: 250 }], totalPaid: 300 }, // 초과입금 50
  { custKey: 4, charges: [{ date: '2026-07-20', amount: 600 }, { date: '2026-10-20', amount: 100 }], totalPaid: 0 },
  { custKey: 5, charges: [{ date: '', amount: 70 }], totalPaid: 10 }, // 날짜 불명
];
const arBalanceTotal = fixture.reduce((s, c) => s + c.charges.reduce((x, y) => x + y.amount, 0) - c.totalPaid, 0);
const rows = fixture.map((c) => ({ custKey: c.custKey, ...agingForCustomer(c.charges, c.totalPaid, '2026-10-21') }));
const sum = summarizeAging(rows);
assert.equal(sum.total, arBalanceTotal);
assert.equal(sum.d0_30 + sum.d31_60 + sum.d61_90 + sum.d90p - sum.credit, arBalanceTotal);
assert.equal(sum.credit, 50);
for (const r of rows) {
  const c = fixture.find((x) => x.custKey === r.custKey);
  assert.equal(r.total, c.charges.reduce((x, y) => x + y.amount, 0) - c.totalPaid);
}

// 정렬: 90+ 큰 순 우선
const sorted = sortAgingRows(rows);
assert.equal(sorted[0].custKey, 1);
assert.ok(sorted[0].d90p >= sorted[1].d90p);

// 기준일 이후 청구는 구간 제외 + futureExcluded 로 보고
const fut = agingForCustomer([{ date: '2026-10-01', amount: 100 }, { date: '2026-10-25', amount: 40 }], 0, '2026-10-21');
assert.equal(fut.total, 100); assert.equal(fut.futureExcluded, 40); assert.equal(fut.totalPaid, 0);
assert.equal(summarizeAging([fut, fut]).futureExcluded, 80);
console.log('mgmt aging tests passed');
