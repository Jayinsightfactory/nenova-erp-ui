import assert from 'node:assert/strict';
import { buildSalesPasteRows, buildSalesPasteText, buildSalesPasteWeekChoices, salesManagerCustomers, salesManagerOptions } from '../lib/salesPasteOrder.js';

const weeks = buildSalesPasteWeekChoices(new Date(2026, 7, 31));
assert.equal(weeks.length, 8, '베이스부터 +3까지 각 1·2 세부차수를 보여야 합니다.');
assert.deepEqual([...new Set(weeks.map(row => row.offset))], [0, 1, 2, 3]);
assert.equal(weeks.filter(row => row.offset === 0).length, 2);
assert.match(buildSalesPasteText({ year: 2026, week: '36-01', customerName: '꽃길', text: '돈셀 2박스' }), /^2026년 36-01차\n꽃길\n돈셀 2박스$/);
const customers = [{ ManagerName: '김영업', CustKey: 1 }, { ManagerName: '이영업', CustKey: 2 }];
assert.deepEqual(salesManagerOptions(customers, { userName: '박영업' }), ['김영업', '박영업', '이영업']);
assert.deepEqual(salesManagerCustomers(customers, '이영업').map(row => row.CustKey), [2]);
const rows = buildSalesPasteRows([{ custName: '꽃길', items: [{ prodKey: 7, prodName: 'Doncel', qty: 2, unit: '박스' }, { inputName: '미매칭', qty: 1 }] }], [{ ProdKey: 7, CurrentQty: 3 }]);
assert.deepEqual(rows.map(row => [row.prodKey || null, row.currentQty, row.finalQty]).sort((a, b) => Number(b[0] || 0) - Number(a[0] || 0)), [[7, 3, 5], [null, 0, null]]);
const merged = buildSalesPasteRows([{ items: [{ prodKey: 7, qty: 2, unit: '박스' }, { prodKey: 7, qty: 3, unit: '박스' }] }], [{ ProdKey: 7, CurrentQty: 4 }]);
assert.deepEqual(merged.map(row => [row.qty, row.currentQty, row.finalQty]), [[5, 4, 9]], '같은 품목·단위는 등록 전 합산해야 합니다.');
const mixedUnits = buildSalesPasteRows([{ items: [{ prodKey: 7, qty: 2, unit: '박스' }, { prodKey: 7, qty: 3, unit: '단' }] }], [{ ProdKey: 7, CurrentQty: 4 }]);
assert.equal(mixedUnits.every(row => row.unitConflict && row.finalQty === null), true, '동일 품목의 혼합 단위는 환산 근거 없이 합산하면 안 됩니다.');
console.log('sales paste order helper tests passed');
