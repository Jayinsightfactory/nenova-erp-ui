import assert from 'node:assert/strict';
import { buildPivotAvailableWeeksSql, defaultPivotBoardWeek, mergePivotAvailableWeeks, normalizePivotAvailableWeeks, selectedPivotWeekValue } from '../lib/pivotAvailableWeeks.js';

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
assert.deepEqual(mergePivotAvailableWeeks(['40-01', '39-01'], ['41-01', '40-01']), ['41-01', '40-01', '39-01']);
assert.equal(defaultPivotBoardWeek(['41-01', '40-02'], ['40-03', '40-01']), '41-01', '기본 차수는 실제 입고가 있는 최신 차수를 우선한다');
assert.equal(defaultPivotBoardWeek([], ['40-03', '40-01']), '40-03', '입고 기록이 없으면 최신 주문 차수로 대체한다');

const scopeSql = buildPivotAvailableWeeksSql();
for (const table of ['OrderMaster', 'WarehouseMaster', 'ShipmentMaster', 'StockMaster']) {
  assert.match(scopeSql, new RegExp(`${table}[\\s\\S]*?OrderYear=@year`), `${table} 입력 이력은 선택 연도로 격리해야 한다.`);
}
const orderOnlySql = buildPivotAvailableWeeksSql('orders');
assert.match(orderOnlySql, /FROM OrderMaster[\s\S]*OrderYear=@year/, '네덜란드·중국 물량표 선택지는 주문 입력 차수를 연도와 함께 조회해야 한다.');
assert.doesNotMatch(orderOnlySql, /StockMaster|WarehouseMaster|ShipmentMaster/, '주문이 없는 미래 재고 차수를 네덜란드·중국 물량표 선택지에 섞으면 안 된다.');
const chinaIncomingSql = buildPivotAvailableWeeksSql('incoming', 'china');
assert.match(chinaIncomingSql, /FROM dbo\.ViewWarehouse[\s\S]*OrderYear=@year[\s\S]*OutQuantity,0\)>0[\s\S]*CounName LIKE N'%중국%'[\s\S]*CountryFlower LIKE N'%중국%'/, '중국의 연도별 양수 입고를 EXE와 같은 ViewWarehouse에서 CounName 또는 CountryFlower로 선택한다.');
assert.doesNotMatch(chinaIncomingSql, /WarehouseDetail\.isDeleted|Product\.isDeleted/, 'ViewWarehouse와 다르게 삭제된 라인/품목을 추가 필터링하지 않는다.');
const dutchIncomingSql = buildPivotAvailableWeeksSql('incoming', 'netherlands');
assert.match(dutchIncomingSql, /네덜란드.*Netherlands.*Holland.*Dutch/, '네덜란드 국가 표기 변형 입고를 포함한다.');
assert.match(chinaIncomingSql, /ISNULL\(OutQuantity,0\)>0/, '양수 입고가 없는 주는 기본 차수 후보에서 제외한다.');

console.log('pivotAvailableWeeks tests passed');
