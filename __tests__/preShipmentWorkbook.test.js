import assert from 'node:assert/strict';
import fs from 'node:fs';
import XLSX from 'xlsx';
import { normalizePreShipmentScope, parsePreShipmentWorkbook, selectPreShipmentSheetName } from '../lib/preShipmentWorkbook.js';

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
console.log('preShipmentWorkbook.test.js passed');
