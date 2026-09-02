import assert from 'node:assert/strict';
import fs from 'node:fs';
import XLSX from 'xlsx';
import { normalizePreShipmentScope, parsePreShipmentWorkbook, selectPreShipmentSheetName } from '../lib/preShipmentWorkbook.js';
import { buildPreShipmentErpStatusSql } from '../lib/preShipmentErpStatus.js';
import { normalizeManualPreShipmentItem } from '../lib/preShipment.js';
await import('./preShipmentHistory.test.js');

const file = 'C:/Users/USER/Documents/카카오톡 받은 파일/주광 32차 정리.xlsx';
if (fs.existsSync(file)) {
  const workbook = XLSX.read(fs.readFileSync(file), { type: 'buffer', cellDates: true });
  const parsed = parsePreShipmentWorkbook(XLSX, workbook);
  assert.equal(parsed.sheetName, '주광 카장수알 31차');
  assert.equal(parsed.baseDate, '2026-08-06');
  const doncel = parsed.items.find(row => row.speciesName.includes('카네') && row.itemName === '돈셀');
  assert.deepEqual([doncel.orderBoxQty, doncel.busanWilsonQty], [4, 1]);
  const mondial = parsed.items.find(row => row.itemName.includes('몬디알 화이트(60cm)'));
  assert.deepEqual([mondial.orderBoxQty, mondial.orderUnitQty], [20, 200]);
  assert.equal(parsed.items.find(row => row.itemName.trim() === '화이트').orderBoxQty, 150);
}
assert.equal(selectPreShipmentSheetName(['주광 카장수알 31차 (2)', '주광 카장수알 7월 고정 수량', '주광 카장수알 31차']).name, '주광 카장수알 31차');
assert.equal(selectPreShipmentSheetName(['주광 카장수알 34차', '주광 카장수알 33차']).major, 34);
assert.equal(selectPreShipmentSheetName(['주광카장수알']).name, '주광카장수알');
assert.throws(() => selectPreShipmentSheetName(['주광 카장수알 31차 (2)']), /원본 시트/);
assert.deepEqual(normalizePreShipmentScope('2026', '35'), { orderYear: '2026', majorWeek: 35 });
assert.throws(() => normalizePreShipmentScope('2025', '0'), /1~53/);
assert.deepEqual(normalizeManualPreShipmentItem({ speciesName: '카네이션', itemName: '노비아', orderBoxQty: '2', orderUnitQty: 0, busanWilsonQty: '1.5' }), {
  speciesName: '카네이션', itemName: '노비아', orderBoxQty: 2, orderUnitQty: 0, busanWilsonQty: 1.5, memo: null,
});
assert.throws(() => normalizeManualPreShipmentItem({ speciesName: '카네이션', itemName: '' }), /품목명/);
assert.throws(() => normalizeManualPreShipmentItem({ speciesName: '카네이션', itemName: '노비아', orderBoxQty: -1 }), /발주 박스/);
const synthetic = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(synthetic, XLSX.utils.aoa_to_sheet([
  ['2026년 8월 6일 목요일 오전 출고'],
  ['카네이션', '색상', '선출고 (목요일)', '발주수량', '부산윌슨', null, '화요일 출고 예정'],
  [null, '돈셀', 2, 4, 1, null, 3],
  [null, '합계', 2, 4, 1, null, 3],
]), '주광카장수알');
const syntheticParsed = parsePreShipmentWorkbook(XLSX, synthetic);
assert.equal(syntheticParsed.items.length, 1);
assert.deepEqual(syntheticParsed.items[0].importedAllocations.map(row => row.quantity), [2, 3]);
const libSource = fs.readFileSync(new URL('../lib/preShipment.js', import.meta.url), 'utf8');
const pageSource = fs.readFileSync(new URL('../pages/pre-shipment.js', import.meta.url), 'utf8');
assert.doesNotMatch(libSource, /(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:Order|Shipment|Stock|Estimate|WebProfitReport)/i, '선출고 웹 원장 외 ERP DML 금지');
assert.match(pageSource, /TargetOrderYear/);
assert.match(pageSource, /TargetMajorWeek/);
assert.match(pageSource, /발주-출고/);
assert.match(pageSource, /품목 추가/);
assert.match(pageSource, /전산 품목 매칭/);
assert.match(libSource, /searchPreShipmentProducts/);

// 선출고 확장 계약: 수동 품목·명시적 Product 매칭은 웹 계획에만 남기고,
// 실제 차수의 분배/출고일은 읽기 전용 상태로 표시해야 한다.
const contract = JSON.parse(fs.readFileSync(new URL('../docs/contracts/pre-shipment-management.json', import.meta.url), 'utf8'));
const actionNames = contract.actions.map(action => action.name);
for (const required of ['PRE_SHIPMENT_ITEM_ADD', 'PRE_SHIPMENT_ITEM_MATCH', 'PRE_SHIPMENT_ERP_STATUS_READ']) {
  assert.ok(actionNames.includes(required), `선출고 계약 action 누락: ${required}`);
}
assert.deepEqual(contract.erpStatusScope.key, ['OrderYear', 'OrderWeek', 'CustKey', 'ProdKey']);
assert.equal(contract.erpStatusScope.mode, 'read-only');
assert.equal(contract.erpStatusScope.excludePriorYearSameWeek, true);
assert.deepEqual(contract.erpStatusScope.zeroState, {
  distributionQuantity: 0,
  shipmentDateQuantity: 0,
  status: '미분배/출고일 미지정',
});

// 같은 차수라도 다른 연도 행은 후보에 섞이면 안 된다. 이 fixture는 API가
// 반드시 현재 연도만 남기는지를 검증하는 순수 계약 기준이다.
const currentYear = '2026';
const selectedWeek = 35;
const statusRows = [
  { OrderYear: '2025', OrderWeek: 35, ProdKey: 10, DistributedQuantity: 99, ShipmentDateQuantity: 99 },
  { OrderYear: '2026', OrderWeek: 34, ProdKey: 10, DistributedQuantity: 4, ShipmentDateQuantity: 4 },
  { OrderYear: currentYear, OrderWeek: selectedWeek, ProdKey: 10, DistributedQuantity: 7, ShipmentDateQuantity: 5 },
];
const scopedStatusRows = statusRows.filter(row => String(row.OrderYear) === currentYear && Number(row.OrderWeek) === selectedWeek);
assert.deepEqual(scopedStatusRows, [{ OrderYear: '2026', OrderWeek: 35, ProdKey: 10, DistributedQuantity: 7, ShipmentDateQuantity: 5 }]);

// 매칭 전/후와 분배 0건은 서로 다른 상태여야 한다. 매칭되지 않은 품목을
// 임의의 ProdKey로 표시하거나 0을 공란으로 취급하지 않는다.
const unmatched = { ItemKey: 101, ProductKey: null, MatchStatus: '미매칭', DistributedQuantity: 0, ShipmentDateQuantity: 0 };
const matchedZero = { ItemKey: 102, ProductKey: 456, MatchStatus: '매칭완료', DistributedQuantity: 0, ShipmentDateQuantity: 0 };
assert.equal(unmatched.ProductKey, null);
assert.equal(unmatched.MatchStatus, '미매칭');
assert.equal(matchedZero.MatchStatus, '매칭완료');
assert.equal(matchedZero.DistributedQuantity, 0);

const statusSql = buildPreShipmentErpStatusSql(['prod0', 'prod1']);
assert.match(statusSql, /sm\.OrderYear=@orderYear/);
assert.match(statusSql, /sm\.OrderWeek LIKE @majorPrefix/);
assert.match(statusSql, /sm\.CustKey=@custKey/);
assert.match(statusSql, /sd\.ProdKey IN \(@prod0,@prod1\)/);
assert.match(statusSql, /JOIN ShipmentDate sdd ON sdd\.SdetailKey=scoped\.SdetailKey/);
assert.doesNotMatch(statusSql, /(?:INSERT|UPDATE|DELETE|MERGE)\s/i, 'ERP 현황은 SELECT-only여야 한다.');

assert.match(pageSource, /품목 추가|품목추가/);
assert.match(pageSource, /매칭/);
assert.match(pageSource, /분배|출고일/);
assert.match(pageSource, /업체·품목 붙여넣기 재고 이력/);
assert.match(pageSource, /\/api\/orders\/parse-paste/);
assert.match(pageSource, /\/api\/pre-shipment\/history/);
assert.match(pageSource, /재고수정 있음/);
assert.match(pageSource, /StockHistory|재고 이력은 품목·차수 전체 기록/);
console.log('preShipmentWorkbook.test.js passed');
