import assert from 'node:assert/strict';
import { buildPivotAvailableWeeksSql, normalizePivotAvailableWeeks, selectedPivotWeekValue } from '../lib/pivotAvailableWeeks.js';

assert.deepEqual(
  normalizePivotAvailableWeeks([
    { OrderWeek: '36-2' },
    { OrderWeek: '36-01' },
    { OrderWeek: '36-02' },
    { OrderWeek: '35-04' },
    { OrderWeek: 'invalid' },
  ]),
  ['36-02', '36-01', '35-04'],
  'DB 입력 이력의 세부차수를 축약하거나 합치지 않고 최신순으로 반환해야 한다.',
);
assert.equal(selectedPivotWeekValue('2026-36-02'), '36-02');
assert.equal(selectedPivotWeekValue('36-01'), '36-01');

const scopeSql = buildPivotAvailableWeeksSql();
for (const table of ['OrderMaster', 'WarehouseMaster', 'ShipmentMaster', 'StockMaster']) {
  assert.match(scopeSql, new RegExp(`${table}[\\s\\S]*?OrderYear=@year`), `${table} 입력 이력은 선택 연도로 격리해야 한다.`);
}
const orderOnlySql = buildPivotAvailableWeeksSql('orders');
assert.match(orderOnlySql, /FROM OrderMaster[\s\S]*OrderYear=@year/, '네덜란드·중국 물량표 선택지는 주문 입력 차수를 연도와 함께 조회해야 한다.');
assert.doesNotMatch(orderOnlySql, /StockMaster|WarehouseMaster|ShipmentMaster/, '주문이 없는 미래 재고 차수를 네덜란드·중국 물량표 선택지에 섞으면 안 된다.');

console.log('pivotAvailableWeeks tests passed');
