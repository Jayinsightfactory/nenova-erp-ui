import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { addDutchPriceColumns, attachDutchLiveCustomerKeys, buildDutchEntriesFromPivotData, dutchEntryPrice, dutchPriceKey, dutchUniformPricePeerKeys, isDutchIndividualPriceCustomer, migrateDutchPriceDraft, dutchQuantityPriceNumberFormat, parseDutchPivotWorkbook, priceProgress, restoreDutchPriceDraft, snapshotDutchPriceDraft } from '../lib/dutchVolumePrice.js';
import { addDutchPriceShapesToXlsx } from '../lib/dutchPriceShapes.js';
import JSZip from 'jszip';
const wb = XLSX.utils.book_new();
const ws = XLSX.utils.aoa_to_sheet([['차수(3501) 품종(네덜란드)'],['', '', '서울'],['', '칼라', '꽃길\nCL6', '로뎀농원\nCL99', '주문', '입고', '재고', '잔량'],['Tulip Strong Gold', 'Yellow', 10, 0, 10, 10, 0, 0],['Rose Avalanche', 'White', 5, 7, 12, 12, 0, 0],['합계', '', 15, 7, 22, 22, 0, 0]]);
ws.C4.s = { fill: { fgColor: { rgb: 'ABCDEF' } } };
ws.E4.f = 'SUM(C4:D4)';
ws['!merges'] = [{ s: { r: 1, c: 2 }, e: { r: 1, c: 3 } }];
XLSX.utils.book_append_sheet(wb, ws, '네덜란드');
const parsed = parseDutchPivotWorkbook(XLSX, wb);
const newWb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(newWb, XLSX.utils.aoa_to_sheet([
  ['4002-네덜란드'], [], ['꽃','품목명','칼라','검증업체\nCL1','주문','입고'],
  ['아란','ARAN Azima','레드',50,50,99], ['수국','Royal Princess','화이트',20,20,999], ['', '합계', '',70,70,1098],
]), '네덜란드');
XLSX.utils.book_append_sheet(newWb, XLSX.utils.aoa_to_sheet([
  ['type','sheet','label','key'], ['prod','네덜란드','SnowBallWhite',965], ['prod','네덜란드','Royal Princess',965],
]), '_keymap');
const newParsed = parseDutchPivotWorkbook(XLSX, newWb);
assert.equal(newParsed.entries.length, 2, 'summary/incoming quantities are not customers');
assert.deepEqual(newParsed.entries.map(row => row.cellAddress), ['D4','D5']);
assert.equal(newParsed.entries[0].sourceItem, 'ARAN Azima');
assert.equal(newParsed.entries[0].sourceColor, '레드');
assert.equal(newParsed.entries[0].product, '아란', 'legacy server species transport remains unchanged');
assert.equal(newParsed.entries[0].color, 'ARAN Azima');
assert.equal(newParsed.entries[0].layoutVersion, 3);
assert.equal(newParsed.entries[1].prodKey, undefined, 'stale or manipulated keymap is never a manual ERP override');
assert.equal(parsed.entries[0].layoutVersion, 2);
const invalidWb = { SheetNames: ['네덜란드'], Sheets: { 네덜란드: XLSX.utils.aoa_to_sheet([['네덜란드'],[],['꽃','칼라','업체','입고'],['꽃','품명',1,9]]) } };
assert.throws(() => parseDutchPivotWorkbook(XLSX, invalidWb), /주문/, 'missing customer boundary must not import incoming/farm values');
assert.equal(parsed.entries.length, 3);
assert.deepEqual(parsed.entries.map(row => [row.product, row.customer, row.quantity]), [['Tulip Strong Gold', '꽃길\nCL6', 10],['Rose Avalanche', '꽃길\nCL6', 5],['Rose Avalanche', '로뎀농원\nCL99', 7]]);
const prices = { [dutchPriceKey(parsed.entries[0])]: 1.25, [dutchPriceKey(parsed.entries[1])]: 2 };
assert.deepEqual(priceProgress(parsed.entries, prices), { completed: 3, total: 3, pending: 0 }, '같은 품목의 비주광 업체 두 곳은 균일가 한 번으로 함께 완료된다.');
const priced = addDutchPriceColumns(XLSX, wb, parsed.entries, prices, 'EUR');
const output = XLSX.utils.sheet_to_json(priced.workbook.Sheets['네덜란드'], { header: 1, defval: '' });
assert.deepEqual(output[2].slice(0, 8), ['', '칼라', '꽃길\nCL6', '로뎀농원\nCL99', '주문', '입고', '재고', '잔량']);
assert.deepEqual(output[3].slice(0, 8), ['Tulip Strong Gold', 'Yellow', 10, 0, 10, 10, 0, 0]);
assert.equal(priced.workbook.Sheets['네덜란드'].C4.s.font.name, '맑은 고딕', '브라우저 재저장 뒤에도 Pivot 본문 글꼴을 복원해야 합니다.');
assert.equal(priced.workbook.Sheets['네덜란드'].C4.s.border.left.color.rgb, 'C8C8C8', '브라우저 재저장 뒤에도 Pivot 셀 테두리를 복원해야 합니다.');
assert.equal(priced.workbook.Sheets['네덜란드'].C4.v, 10, '단가를 표시해도 수량 셀의 실제 숫자값은 보존해야 합니다.');
assert.equal(priced.workbook.Sheets['네덜란드'].C4.z, dutchQuantityPriceNumberFormat(1.25), '수량 셀 표시형식에는 단가 문자열을 섞지 않아야 합니다.');
assert.doesNotMatch(priced.workbook.Sheets['네덜란드'].C4.z, /EUR|KRW/, '엑셀 수량 셀의 단가에는 통화 문자를 넣지 않아야 합니다.');
assert.equal(priced.workbook.Sheets['네덜란드'].E4.f, 'SUM(C4:D4)', '열 삽입 없이 원본 주문 합계 수식을 그대로 보존해야 합니다.');
assert.deepEqual(priced.workbook.Sheets['네덜란드']['!merges'][0], { s: { r: 1, c: 2 }, e: { r: 1, c: 3 } }, '원본 업체 영역 병합을 그대로 보존해야 합니다.');
assert.equal(priced.workbook.Sheets['네덜란드']['!ref'], ws['!ref'], '단가 때문에 열 개수가 늘어나면 안 됩니다.');
assert.equal(priced.workbook.Sheets['네덜란드'].A1.v, '차수(3501)\n품종(네덜란드)', '차수와 품종은 두 줄 제목으로 보여야 합니다.');
assert.equal(priced.workbook.Sheets['네덜란드'].A1.s.fill.fgColor.rgb, 'D9E6F2', '브라우저 재저장 때도 Pivot 제목 디자인을 명시적으로 복원해야 합니다.');
assert.equal(priced.workbook.SheetNames.includes('NL_단가표'), false, '별도 단가 결과 시트를 만들면 안 됩니다.');
assert.equal(ws.C4.v, 10, '원본 수량 셀을 변경하면 안 됩니다.');
const uniformRows = [
  { id: 'a', product: 'Rose Avalanche', color: 'White', customer: '꽃길\nCL6' },
  { id: 'b', product: 'Rose Avalanche', color: 'White', customer: '로뎀농원\nCL99' },
  { id: 'c', product: 'Rose Avalanche', color: 'White', customer: '주광농원\nCL2' },
];
const uniformPrices = { [dutchPriceKey(uniformRows[0])]: 3.5, c: 4.2 };
assert.equal(isDutchIndividualPriceCustomer(uniformRows[2].customer), true, '주광 명칭은 업체별 개별단가 대상이다.');
assert.equal(dutchPriceKey(uniformRows[0]), dutchPriceKey(uniformRows[1]), '주광 외 동일 품목·칼라는 하나의 균일가 키를 공유한다.');
assert.notEqual(dutchPriceKey(uniformRows[0]), dutchPriceKey(uniformRows[2]), '주광은 공통 균일가 키에 포함하지 않는다.');
assert.deepEqual(uniformRows.map(row => dutchEntryPrice(row, uniformPrices)), [3.5, 3.5, 4.2], '비주광 균일가와 주광 개별단가를 분리한다.');
assert.equal(dutchEntryPrice({ ...uniformRows[1], color: 'Pink' }, uniformPrices), 0, '같은 품목이라도 칼라가 다르면 균일가를 재사용하지 않는다.');
const mixedMatchRows = [
  { id: 'matched', product: 'ERP Rose', sourceItem: 'Rose Avalanche', sourceColor: 'White', color: 'White', customer: '업체 A', prodKey: 11 },
  { id: 'unmatched', product: 'Rose Avalanche', sourceItem: 'Rose Avalanche', sourceColor: 'White', color: 'White', customer: '업체 B' },
  { id: 'different', product: 'Other ERP Rose', sourceItem: 'Rose Avalanche', sourceColor: 'White', customer: '업체 C', prodKey: 12 },
  { id: 'jookwang', product: 'Rose Avalanche', sourceItem: 'Rose Avalanche', sourceColor: 'White', customer: '주광농원', prodKey: 11 },
];
assert.deepEqual(dutchUniformPricePeerKeys(mixedMatchRows, mixedMatchRows[0]), ['uniform:prod:11', 'uniform:name:rose avalanche|color:white'], 'ERP 품목 매칭이 부분 완료되어도 미매칭 동종 행까지 공유하되 서로 다른 명시 매칭과 주광은 분리한다.');
assert.deepEqual(dutchUniformPricePeerKeys(mixedMatchRows.slice(0, 2), mixedMatchRows[1]), ['uniform:prod:11', 'uniform:name:rose avalanche|color:white'], '미매칭 행에서 입력해도 유일하게 매칭된 동종 품목에 공유한다.');
const conflictingMatchRows = [mixedMatchRows[0], mixedMatchRows[1], mixedMatchRows[2]];
assert.deepEqual(dutchUniformPricePeerKeys(conflictingMatchRows, conflictingMatchRows[1]), ['uniform:name:rose avalanche|color:white'], '미매칭 입력 시 명시 매칭 후보가 복수면 충돌 품목들을 덮지 않는다.');
const beforePriceEdit = { 'uniform:prod:11': 125, 'uniform:name:rose avalanche|color:white': 0, unrelated: 77 };
const priceEditSnapshot = snapshotDutchPriceDraft(beforePriceEdit, ['uniform:prod:11', 'uniform:name:rose avalanche|color:white', 'missing-peer']);
const afterCancelledPriceEdit = restoreDutchPriceDraft({ ...beforePriceEdit, 'uniform:prod:11': 300, 'uniform:name:rose avalanche|color:white': 300, 'missing-peer': 300 }, priceEditSnapshot);
assert.deepEqual(afterCancelledPriceEdit, beforePriceEdit, '단가 편집 취소는 연동된 모든 업체 셀의 값과 미입력 상태를 정확히 복원해야 한다.');
assert.equal(migrateDutchPriceDraft(uniformRows, { a: 2, b: 2 })[dutchPriceKey(uniformRows[0])], 2, '과거 비주광 단가가 모두 같을 때만 균일가로 승계한다.');
assert.equal(migrateDutchPriceDraft(uniformRows, { a: 2, b: 3 })[dutchPriceKey(uniformRows[0])], undefined, '과거 비주광 단가가 충돌하면 임의 균일가를 선택하지 않는다.');
const shapedBuffer = await addDutchPriceShapesToXlsx(XLSX, XLSX.write(priced.workbook, { type: 'array', bookType: 'xlsx' }), priced.workbook, parsed.entries, prices);
const shapedZip = await JSZip.loadAsync(shapedBuffer);
const drawingName = Object.keys(shapedZip.files).find(name => /^xl\/drawings\/drawing\d+\.xml$/.test(name));
assert.ok(drawingName, '단가는 셀 문자열이 아니라 실제 Excel drawing 텍스트박스로 생성해야 합니다.');
const drawingXml = await shapedZip.file(drawingName).async('string');
assert.match(drawingXml, /<a:t>1\.25<\/a:t>/, '도형에는 통화나 @ 없이 단가 숫자만 표시해야 합니다.');
assert.doesNotMatch(drawingXml, /<a:t>[^<]*(?:@|EUR|KRW)[^<]*<\/a:t>/, 'Excel 셀 위에는 통화 문자나 @가 아닌 숫자만 보여야 합니다.');
assert.match(drawingXml, /prst="rect"/, '단가는 테두리가 있는 사각 텍스트박스로 표시해야 합니다.');
assert.match(drawingXml, /sz="900"/, '단가 글씨는 수량과 같은 9pt로 표시해야 합니다.');
assert.match(drawingXml, /<xdr:to>[\s\S]*<xdr:colOff>350000<\/xdr:colOff>/, '긴 단가는 한 셀 경계를 넘어가도록 도형 폭을 확보해야 합니다.');
assert.match(drawingXml, /name="KRW 1"/, 'Excel 도형 이름에도 단가 문구를 표시하지 않아야 합니다.');
assert.match(drawingXml, /lIns="0" rIns="0" tIns="0" bIns="0"/, 'Excel 가격 도형 셀 안쪽 여백은 없애야 합니다.');
assert.doesNotMatch(drawingXml, /name="단가/, 'Excel selection pane에도 단가 라벨을 노출하지 않습니다.');
const live = buildDutchEntriesFromPivotData({ rows: [
  { country: '네덜란드', prodKey: 7, prodName: 'Tulip Gold', productDescr: 'Yellow', orders: { 꽃길: 10, 로뎀: 0 } },
  { country: '중국', prodKey: 8, prodName: 'Rose', orders: { 꽃길: 20 } },
] }, 2026, '35-01');
assert.deepEqual(live.map(row => [row.id, row.customer, row.quantity]), [['live:2026:35-01:꽃길:7', '꽃길', 10]], '선택 연도·차수의 네덜란드 양수 주문만 직접 조회 대상으로 만들어야 합니다.');
const keyedWorkbook = XLSX.utils.book_new();
keyedWorkbook.SheetNames.push('네덜란드', '_keymap');
keyedWorkbook.Sheets.네덜란드 = {};
keyedWorkbook.Sheets._keymap = XLSX.utils.aoa_to_sheet([
  ['type', 'sheet', 'label', 'key'], ['cust', '네덜란드', '북문\nCL22', 13],
  ['cust', '네덜란드', '중복\nCL22', 99], ['cust', '네덜란드', '중복\nCL22', 101],
  ['cust', '네덜란드', '삭제됨\nCL90', 90],
]);
const liveHeaderEntries = [
  { id: '네덜란드!D4', sheetName: '네덜란드', sourceCustomer: '북문\nCL22' },
  { id: '네덜란드!E4', sheetName: '네덜란드', sourceCustomer: '중복\nCL22' },
  { id: '네덜란드!F4', sheetName: '네덜란드', sourceCustomer: '삭제됨\nCL90' },
];
const trustedLive = attachDutchLiveCustomerKeys(XLSX, keyedWorkbook, liveHeaderEntries, [13, 99, 101]);
assert.deepEqual(trustedLive.map(entry => entry.sourceCustKey ?? null), [13, null, null], '직접 조회의 같은 차수 활성 DB 키만 고유 헤더에 연결하고 모호/비활성 후보는 거부한다.');
assert.equal(trustedLive[0].custKey, undefined, 'LIVE 원천 키는 사용자 수동매칭 custKey와 분리 저장한다.');
const untrustedUpload = parseDutchPivotWorkbook(XLSX, wb);
assert.equal(untrustedUpload.entries[0].custKey, undefined, '일반 업로드 파서는 숨은 키맵을 명시키로 사용하지 않는다.');
const keyedLiveRows = buildDutchEntriesFromPivotData({ customersByKey: [
  { custKey: 10, custName: '공통상호', orderCode: 'CL10', custDescr: '공통A/네-월' },
  { custKey: 20, custName: '공통상호', orderCode: 'CL20', custDescr: '공통B/네-월' },
], rows: [{ country: '네덜란드', prodKey: 7, prodName: 'Rose / White', ordersByCustKey: { '10': 3, '20': 4 } }] }, 2026, '35-01');
assert.deepEqual(keyedLiveRows.map(entry => [entry.custKey, entry.customer, entry.quantity]), [[10, '공통A\nCL10', 3], [20, '공통B\nCL20', 4]], '동일 업체명도 DB 거래처키별로 다른 수량·CL을 보존한다.');
console.log('dutch volume price tests passed');
