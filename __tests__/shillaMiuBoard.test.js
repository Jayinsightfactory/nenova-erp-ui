import assert from 'node:assert/strict';
import fs from 'node:fs';
import { allocationKey, buildBoardRows, buildMajorWeeks, getOperationalWeekSummary, getWeekBalance, normalizeMajorWeek } from '../lib/shillaMiuBoard.js';

assert.equal(normalizeMajorWeek('29'), '29');
assert.equal(normalizeMajorWeek('2026-29-02'), '29');
assert.deepEqual(buildMajorWeeks('27', '29'), ['27', '28', '29']);
assert.equal(allocationKey({ supplyWeek: '29', useWeek: '28', prodKey: 7, destination: 'miu' }), '29|28|7|MIU');

const rows = buildBoardRows({
  weeks: ['27', '28', '29'],
  openingStocks: [{ prodKey: 7, country: '콜롬비아', flower: '카네이션', prodName: 'CARNATION Moon Light', unit: '단', qty: 50 }],
  incoming: [{ week: '28', prodKey: 7, qty: 300 }],
  orders: [{ week: '28', prodKey: 7, qty: 300 }],
  shipments: [{ week: '28', prodKey: 7, shillaQty: 250, raumQty: 20, miuQty: 30, otherQty: 0 }],
  allocations: [
    { boardKey: 1, supplyWeek: '28', useWeek: '28', prodKey: 7, destination: 'RAUM', qty: 20, matched: true },
    { boardKey: 2, supplyWeek: '29', useWeek: '28', prodKey: 7, destination: 'MIU', qty: 30, matched: true },
  ],
});
assert.equal(rows.length, 1);
assert.equal(rows[0].weeks['28'].incomingQty, 300);
assert.equal(rows[0].weeks['28'].erp.shilla, 250);
assert.equal(rows[0].weeks['28'].web.MIU.qty, 30);
assert.equal(rows[0].weeks['28'].web.MIU.sources[0].supplyWeek, '29');
assert.equal(rows[0].weeks['28'].web.RAUM.matched, true);
assert.equal(getWeekBalance(rows[0], '28').erpBalance, 50);
assert.equal(getOperationalWeekSummary(rows[0], '28').shillaRemainder, 0);
assert.equal(getOperationalWeekSummary(rows[0], '28').raumRemainder, 0);

const filteredRows = buildBoardRows({
  weeks: ['28'],
  orders: [
    { week: '28', prodKey: 8, qty: 100, prodName: '기타 주문만 있는 품목' },
  ],
  incoming: [
    { week: '28', prodKey: 9, qty: 100, prodName: '기타 입고만 있는 품목' },
  ],
  shipments: [
    { week: '28', prodKey: 10, shillaQty: 0, raumQty: 0, miuQty: 0, otherQty: 100, prodName: '기타 거래처만 있는 품목' },
    { week: '28', prodKey: 11, shillaQty: 0, raumQty: 20, miuQty: 0, otherQty: 0, prodName: '라움 대상 품목' },
  ],
});
assert.deepEqual(filteredRows.map((row) => row.prodKey), [11], '신라·라움·미우 관련 품목만 노출해야 한다.');

const source = fs.readFileSync('pages/sales/shilla-miu-board.js', 'utf8');
const apiSource = fs.readFileSync('pages/api/sales/shilla-miu-board.js', 'utf8');
assert.ok(source.includes('colSpan="9"'), '차수별 가로 그룹은 9개 업무 열을 가져야 한다.');
assert.ok(source.includes('matched'), '분배 매칭 하이라이트 상태를 화면에 표시해야 한다.');
assert.ok(source.includes("miuInputQty > 0 ? 'has-input'"), '이번차수 미우 분배수량이 있는 셀만 기본 강조색을 표시해야 한다.');
assert.ok(!source.includes('c-flower'), '품종 열은 숨기고 품목명만 표시해야 한다.');
assert.ok(source.includes('전재고') && source.includes('신라잔량') && source.includes('라움잔량'), '업무에 필요한 전재고·신라/라움 잔량을 표시해야 한다.');
assert.ok(source.includes('분배 공급차수'), '공급차수와 사용차수를 분리 입력할 수 있어야 한다.');
assert.ok(apiSource.includes('SupplyWeek') && apiSource.includes('UseWeek'), '공급차수와 사용차수를 별도 저장해야 한다.');
assert.ok(apiSource.includes('ShipmentDetail') && apiSource.includes('WarehouseDetail'), '전산 출고/입고 데이터를 연결해야 한다.');
assert.ok(apiSource.includes('WebShillaMiuBoardAllocation'), '웹 분배 매칭 원장에 저장해야 한다.');

console.log('shilla miu board tests passed');
