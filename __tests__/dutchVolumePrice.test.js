import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { addDutchPriceColumns, buildDutchEntriesFromPivotData, parseDutchPivotWorkbook, priceProgress } from '../lib/dutchVolumePrice.js';
const wb = XLSX.utils.book_new();
const ws = XLSX.utils.aoa_to_sheet([['차수(3501) 품종(네덜란드)'],['', '', '서울'],['', '칼라', '꽃길\nCL6', '로뎀농원\nCL99', '주문', '입고', '재고', '잔량'],['Tulip Strong Gold', 'Yellow', 10, 0, 10, 10, 0, 0],['Rose Avalanche', 'White', 5, 7, 12, 12, 0, 0],['합계', '', 15, 7, 22, 22, 0, 0]]);
ws.C4.s = { fill: { fgColor: { rgb: 'ABCDEF' } } };
ws.E4.f = 'SUM(C4:D4)';
ws['!merges'] = [{ s: { r: 1, c: 2 }, e: { r: 1, c: 3 } }];
XLSX.utils.book_append_sheet(wb, ws, '네덜란드');
const parsed = parseDutchPivotWorkbook(XLSX, wb);
assert.equal(parsed.entries.length, 3);
assert.deepEqual(parsed.entries.map(row => [row.product, row.customer, row.quantity]), [['Tulip Strong Gold', '꽃길\nCL6', 10],['Rose Avalanche', '꽃길\nCL6', 5],['Rose Avalanche', '로뎀농원\nCL99', 7]]);
const prices = { [parsed.entries[0].id]: 1.25, [parsed.entries[1].id]: 2 };
assert.deepEqual(priceProgress(parsed.entries, prices), { completed: 2, total: 3, pending: 1 });
const priced = addDutchPriceColumns(XLSX, wb, parsed.entries, prices, 'EUR');
const output = XLSX.utils.sheet_to_json(priced.workbook.Sheets['네덜란드'], { header: 1, defval: '' });
assert.deepEqual(output[2].slice(0, 8), ['', '칼라', '꽃길\nCL6', '단가\n(EUR)', '로뎀농원\nCL99', '단가\n(EUR)', '주문', '입고']);
assert.deepEqual(output[3].slice(0, 8), ['Tulip Strong Gold', 'Yellow', 10, 1.25, 0, '', 10, 10]);
assert.equal(priced.workbook.Sheets['네덜란드'].C4.s.fill.fgColor.rgb, 'ABCDEF', '원본 수량 셀 서식을 유지해야 합니다.');
assert.equal(priced.workbook.Sheets['네덜란드'].G4.f, 'SUM(C4,E4)', '주문 합계는 삽입된 단가 열을 합산하면 안 됩니다.');
assert.deepEqual(priced.workbook.Sheets['네덜란드']['!merges'][0], { s: { r: 1, c: 2 }, e: { r: 1, c: 5 } }, '업체 영역 병합은 새 단가 열까지 포함해야 합니다.');
assert.equal(priced.workbook.SheetNames.includes('NL_단가표'), false, '별도 단가 결과 시트를 만들면 안 됩니다.');
assert.equal(ws.C4.v, 10, '원본 수량 셀을 변경하면 안 됩니다.');
const live = buildDutchEntriesFromPivotData({ rows: [
  { country: '네덜란드', prodKey: 7, prodName: 'Tulip Gold', productDescr: 'Yellow', orders: { 꽃길: 10, 로뎀: 0 } },
  { country: '중국', prodKey: 8, prodName: 'Rose', orders: { 꽃길: 20 } },
] }, 2026, '35-01');
assert.deepEqual(live.map(row => [row.id, row.customer, row.quantity]), [['live:2026:35-01:꽃길:7', '꽃길', 10]], '선택 연도·차수의 네덜란드 양수 주문만 직접 조회 대상으로 만들어야 합니다.');
console.log('dutch volume price tests passed');
