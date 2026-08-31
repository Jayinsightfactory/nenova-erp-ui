import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { addDutchPriceColumns, buildDutchEntriesFromPivotData, dutchQuantityPriceNumberFormat, parseDutchPivotWorkbook, priceProgress } from '../lib/dutchVolumePrice.js';
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
assert.deepEqual(output[2].slice(0, 8), ['', '칼라', '꽃길\nCL6', '로뎀농원\nCL99', '주문', '입고', '재고', '잔량']);
assert.deepEqual(output[3].slice(0, 8), ['Tulip Strong Gold', 'Yellow', 10, 0, 10, 10, 0, 0]);
assert.equal(priced.workbook.Sheets['네덜란드'].C4.s.font.name, '맑은 고딕', '브라우저 재저장 뒤에도 Pivot 본문 글꼴을 복원해야 합니다.');
assert.equal(priced.workbook.Sheets['네덜란드'].C4.s.border.left.color.rgb, 'C8C8C8', '브라우저 재저장 뒤에도 Pivot 셀 테두리를 복원해야 합니다.');
assert.equal(priced.workbook.Sheets['네덜란드'].C4.v, 10, '단가를 표시해도 수량 셀의 실제 숫자값은 보존해야 합니다.');
assert.equal(priced.workbook.Sheets['네덜란드'].C4.z, dutchQuantityPriceNumberFormat(1.25), '단가는 수량 셀 안의 두 번째 줄에 숫자만 보여야 합니다.');
assert.doesNotMatch(priced.workbook.Sheets['네덜란드'].C4.z, /EUR|KRW/, '엑셀 수량 셀의 단가에는 통화 문자를 넣지 않아야 합니다.');
assert.equal(priced.workbook.Sheets['네덜란드'].E4.f, 'SUM(C4:D4)', '열 삽입 없이 원본 주문 합계 수식을 그대로 보존해야 합니다.');
assert.deepEqual(priced.workbook.Sheets['네덜란드']['!merges'][0], { s: { r: 1, c: 2 }, e: { r: 1, c: 3 } }, '원본 업체 영역 병합을 그대로 보존해야 합니다.');
assert.equal(priced.workbook.Sheets['네덜란드']['!ref'], ws['!ref'], '단가 때문에 열 개수가 늘어나면 안 됩니다.');
assert.ok(priced.workbook.Sheets['네덜란드']['!rows'][3].hpt >= 26, '수량과 단가 두 줄이 보이도록 해당 행 높이를 확보해야 합니다.');
assert.ok(priced.workbook.Sheets['네덜란드']['!cols'][2].wch >= 9, '단가 오버레이가 ####로 잘리지 않도록 업체 수량 열 폭을 확보해야 합니다.');
assert.equal(priced.workbook.Sheets['네덜란드'].A1.v, '차수(3501)\n품종(네덜란드)', '차수와 품종은 두 줄 제목으로 보여야 합니다.');
assert.equal(priced.workbook.Sheets['네덜란드'].A1.s.fill.fgColor.rgb, 'D9E6F2', '브라우저 재저장 때도 Pivot 제목 디자인을 명시적으로 복원해야 합니다.');
assert.equal(priced.workbook.SheetNames.includes('NL_단가표'), false, '별도 단가 결과 시트를 만들면 안 됩니다.');
assert.equal(ws.C4.v, 10, '원본 수량 셀을 변경하면 안 됩니다.');
const live = buildDutchEntriesFromPivotData({ rows: [
  { country: '네덜란드', prodKey: 7, prodName: 'Tulip Gold', productDescr: 'Yellow', orders: { 꽃길: 10, 로뎀: 0 } },
  { country: '중국', prodKey: 8, prodName: 'Rose', orders: { 꽃길: 20 } },
] }, 2026, '35-01');
assert.deepEqual(live.map(row => [row.id, row.customer, row.quantity]), [['live:2026:35-01:꽃길:7', '꽃길', 10]], '선택 연도·차수의 네덜란드 양수 주문만 직접 조회 대상으로 만들어야 합니다.');
console.log('dutch volume price tests passed');
