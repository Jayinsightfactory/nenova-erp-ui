'use strict';
const assert = require('node:assert/strict');
const {
  averageSalesWindow, normalizeCustomerName, attachCustomerAverages,
  getReceivablesManagers, filterReceivablesRows,
} = require('../lib/ecountReceivablesPolicy.cjs');

assert.deepEqual(averageSalesWindow(new Date('2026-10-28T00:00:00.000Z')),
  { from: '2025-10-28', to: '2026-10-29', months: 12 });
assert.deepEqual(averageSalesWindow(new Date('2026-09-30T14:59:59.000Z')),
  { from: '2025-09-30', to: '2026-10-01', months: 12 });
assert.deepEqual(averageSalesWindow(new Date('2026-09-30T15:00:00.000Z')),
  { from: '2025-10-01', to: '2026-10-02', months: 12 });
assert.deepEqual(averageSalesWindow(new Date('2024-02-28T15:00:00.000Z')),
  { from: '2023-02-28', to: '2024-03-01', months: 12 }, 'KST leap day clamps to prior-year February end');
assert.equal(normalizeCustomerName('  희경(Hee   Kyoung)  '), '희경(hee kyoung)');

const customers = [
  { CustKey: 1, CustName: '미정화훼유통', managerUserId: 'jeong', managerUserName: '정재훈', managerMatchCount: 1 },
  { CustKey: 2, CustName: '월드천사', managerUserId: 'other', managerUserName: '박성수', managerMatchCount: 1 },
  { CustKey: 3, CustName: '중복상호', managerUserId: 'jeong', managerMatchCount: 1 },
  { CustKey: 4, CustName: ' 중복상호 ', managerUserId: 'other', managerMatchCount: 1 },
  { CustKey: 5, CustName: '미지정담당', managerUserId: null, managerMatchCount: 0 },
  { CustKey: 6, CustName: '삭제된 거래처', active: false, managerUserId: 'jeong', managerMatchCount: 1 },
];
const metrics = new Map([[1, { avgSalesMonthly: 1200, avgSalesCycle: 300, cycleCount: 4 }]]);
const rows = [
  { name: '미정화훼유통', sales: 9000 }, { name: '월드천사', sales: 8000 },
  { name: '중복상호', sales: 7000 }, { name: '미지정담당', sales: 6000 },
  { name: '미등록 ECOUNT 행', sales: 5000 }, { name: '삭제된 거래처', sales: 4000 },
];
assert.deepEqual(attachCustomerAverages(rows, customers, metrics, { userId: 'JEONG' }), [
  { name: '미정화훼유통', sales: 9000, custKey: 1, managerName: '정재훈', avgSalesMonthly: 1200, avgSalesCycle: 300 },
]);
const adminRows = attachCustomerAverages(rows, customers, metrics, { userId: 'nenovaSS3', admin: true });
assert.equal(adminRows.length, 6);
assert.equal(adminRows[0].managerName, '정재훈');
assert.equal(adminRows[1].managerName, '박성수');
assert.equal(adminRows[2].managerName, '담당자 미확인');
assert.equal(adminRows[0].avgSalesMonthly, 1200);
assert.equal(adminRows[2].avgSalesMonthly, null, 'duplicate customer names do not get guessed averages');
assert.equal(adminRows[4].avgSalesCycle, null, 'unmatched ECOUNT rows remain visible to admin without guessed metrics');
assert.equal(adminRows[5].avgSalesMonthly, null, 'inactive customer rows are not mapped to current Nenova sales');
assert.deepEqual(getReceivablesManagers(adminRows), ['담당자 미확인', '박성수', '정재훈']);
assert.deepEqual(filterReceivablesRows(adminRows, { search: '화훼' }).map((row) => row.name), ['미정화훼유통']);
assert.deepEqual(filterReceivablesRows(adminRows, { search: '박성수' }).map((row) => row.name), ['월드천사']);
assert.deepEqual(filterReceivablesRows(adminRows, { manager: '박성수' }).map((row) => row.name), ['월드천사']);
console.log('ecountReceivablesPolicy: ownership and rolling 12-month averages passed');
