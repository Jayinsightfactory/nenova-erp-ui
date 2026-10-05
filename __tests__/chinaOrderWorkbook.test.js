import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { buildChinaOrderWorkbook } from '../lib/chinaOrderWorkbook.js';
import { buildChinaOrderReport, selectChinaOrderSubweek } from '../lib/chinaOrderDownload.js';

const report = {
  scope: { year: 2026, majorWeek: '40' }, queriedAt: '2026-10-05T01:30:00.000Z', warnings: ['일부 HF 코드 검토 필요'],
  cycles: [37, 38, 39, 40, 41, 42, 43].map((majorWeek, index) => ({ key: `2026${majorWeek}`, year: 2026, majorWeek: String(majorWeek).padStart(2, '0'), offset: index - 3 })),
  rows: [
    { prodKey: 10, prodCode: '0007', prodName: '=2+2', unit: '단', quantities: { '2026/37-02': 2, '2026/37-03': 4, '2026/37-03A': 5, '2026/38-01': 3, '2026/38-02': 6, '2026/40-01': 8, '2026/41-01': 9, '2026/42-01': 10 }, total: 47 },
    { prodKey: 11, prodCode: '0008', prodName: 'Review product 꽃 이름이 길어졌을 때 표 셀 안에서 원문 전체가 줄바꿈되어 읽힐 수 있도록 충분한 행 높이가 자동으로 계산되는 검증용 중국 품목명입니다', unit: '박스', quantities: { '2026/39-01': 7 }, total: 7 },
    { prodKey: 12, prodCode: '0012', prodName: 'Blank HF literal', unit: '단', quantities: { 202637: 0, 202638: 0 }, total: 0 },
  ],
  products: [
    { prodKey: 10, prodCode: '0007', prodName: '=2+2', country: '중국', flower: '장미', unit: '단' },
    { prodKey: 11, prodCode: '0008', prodName: 'Review product 꽃 이름이 길어졌을 때 표 셀 안에서 원문 전체가 줄바꿈되어 읽힐 수 있도록 충분한 행 높이가 자동으로 계산되는 검증용 중국 품목명입니다', country: '중국', flower: '장미', unit: '박스' },
    { prodKey: 12, prodCode: '0012', prodName: 'Blank HF literal', country: '중국', flower: '장미', unit: '단' },
  ],
  orders: [
    { orderYear: 2026, orderWeek: '37-02', custKey: 7, custName: '=CMD()', custOrderCode: 'CL2', orderCode: 'WRONG-ORDER-CODE', custCode: 'WRONG-CUST-CODE', prodKey: 10, prodCode: '0007', prodName: '=2+2', unit: '단', quantity: 2 },
    { orderYear: 2026, orderWeek: '38-01', custKey: 7, custName: '=CMD()', custOrderCode: 'CL2', prodKey: 10, prodCode: '0007', prodName: '=2+2', unit: '단', quantity: 3 },
    { orderYear: 2026, orderWeek: '37-03', custKey: 8, custName: '고객 B', custOrderCode: 'CLS', prodKey: 10, prodCode: '0007', prodName: '=2+2', unit: '단', quantity: 4 },
    { orderYear: 2026, orderWeek: '37-03A', custKey: 8, custName: '고객 B', custOrderCode: 'CLS', prodKey: 10, prodCode: '0007', prodName: '=2+2', unit: '단', quantity: 5 },
    { orderYear: 2026, orderWeek: '38-02', custKey: 9, custName: '고객 C', custOrderCode: 'CL2', prodKey: 10, prodCode: '0007', prodName: '=2+2', unit: '단', quantity: 6 },
    { orderYear: 2026, orderWeek: '39-01', custKey: 7, custName: '=CMD()', custOrderCode: 'CL2', prodKey: 11, prodCode: '0008', prodName: 'Review product 꽃 이름이 길어졌을 때 표 셀 안에서 원문 전체가 줄바꿈되어 읽힐 수 있도록 충분한 행 높이가 자동으로 계산되는 검증용 중국 품목명입니다', unit: '박스', quantity: 7 },
    { orderYear: 2026, orderWeek: '40-01', custKey: 10, custName: '업체 D', custOrderCode: '', custCode: 'DO-NOT-INFER', prodKey: 10, prodCode: '0007', prodName: '=2+2', unit: '단', quantity: 8 },
    { orderYear: 2026, orderWeek: '41-01', custKey: 11, custName: '업체 E', custOrderCode: '=CL2()', prodKey: 10, prodCode: '0007', prodName: '=2+2', unit: '단', quantity: 9 },
    { orderYear: 2026, orderWeek: '42-01', custKey: 12, custName: '업체 F', custOrderCode: '0008', prodKey: 10, prodCode: '0007', prodName: '=2+2', unit: '단', quantity: 10 },
  ],
  columns: [
    ['37-02', '37-03', '37-03A'], ['38-01', '38-02'], ['39-01'], ['40-01'], ['41-01'], ['42-01'], [null],
  ].flatMap((weeks, index) => weeks.map(week => week == null
    ? { key: `2026${37 + index}/empty`, cycleKey: `2026${37 + index}`, year: 2026, majorWeek: String(37 + index).padStart(2, '0'), orderWeek: null, label: '주문 없음', offset: index - 3, empty: true }
    : { key: `2026/${week}`, cycleKey: `2026${37 + index}`, year: 2026, majorWeek: String(37 + index).padStart(2, '0'), orderWeek: week, label: week, offset: index - 3, empty: false })),
  totals: [
    { unit: '단', quantities: { '2026/37-02': 2, '2026/37-03': 4, '2026/37-03A': 5, '2026/38-01': 3, '2026/38-02': 6, '2026/40-01': 8, '2026/41-01': 9, '2026/42-01': 10 }, total: 47 },
    { unit: '박스', quantities: { '2026/39-01': 7 }, total: 7 },
  ],
};
const mapping = { sourceFile: 'hf.xlsx', sourceSheet: 'Sheet', rows: [
  { prodKey: 10, prodCode: '0007', prodName: '=2+2', country: '중국', hfCode: '001234', reviewStatus: 'Match', sourceRow: 2 },
  { prodKey: 11, prodCode: '0008', prodName: 'Review product', country: '중국', hfCode: 'HF002', reviewStatus: 'No match', sourceRow: 3 },
  { prodKey: 12, prodCode: '0012', prodName: 'Blank HF literal', country: '중국', hfCode: '', reviewStatus: 'No match', sourceRow: 4 },
] };
const built = await buildChinaOrderWorkbook(report, mapping);
const bytes = await built.xlsx.writeBuffer();
const reopened = new ExcelJS.Workbook();
await reopened.xlsx.load(bytes);
assert.deepEqual(reopened.worksheets.map(sheet => sheet.name), ['발주현황', '업체별발주', '주문상세', '조회기준']);
const overview = reopened.getWorksheet('발주현황');
assert.equal(overview.getRow(1).getCell(1).value, '품목번호');
assert.equal(overview.getRow(2).getCell(1).value, '10');
assert.equal(overview.getRow(2).getCell(2).value, '0007');
assert.equal(overview.getRow(2).getCell(3).value, '=2+2');
assert.equal(overview.getRow(2).getCell(3).formula, undefined, 'formula-looking product name stays literal');
assert.equal(overview.getColumn(3).alignment.wrapText, true, 'overview product names retain wrapping after alignment override');
assert.equal(overview.getRow(2).getCell(4).value, '001234');
assert.equal(overview.getRow(2).getCell(5).value, '일치');
assert.equal(overview.getRow(2).getCell(7).value, 2, 'quantities remain numeric');
assert.equal(overview.getRow(2).getCell(8).value, 4);
assert.equal(overview.getRow(2).getCell(17).value, 47);
assert.equal(overview.getRow(1).getCell(7).value, '2026-37-02');
assert.equal(overview.getRow(1).getCell(8).value, '2026-37-03');
assert.equal(overview.getRow(1).getCell(9).value, '2026-37-03A', '03A is a distinct detail-week column');
assert.equal(overview.getRow(1).getCell(16).value, '2026-43 (주문 없음)');
assert.equal(overview.getRow(3).getCell(5).value, '검토 (No match)');
const longName = String(overview.getRow(3).getCell(3).value);
const nameCapacity = 38 - 2;
let nameLines = 1;
let currentLineWidth = 0;
for (const character of longName) {
  currentLineWidth += character.codePointAt(0) >= 0x2e80 ? 2 : 1;
  if (currentLineWidth > nameCapacity) {
    nameLines += 1;
    currentLineWidth = character.codePointAt(0) >= 0x2e80 ? 2 : 1;
  }
}
const requiredLongNameHeight = Math.min(120, nameLines * 16 + 6);
assert.ok(overview.getRow(3).height >= requiredLongNameHeight, `긴 CJK 품목명의 예상 ${nameLines}줄 전체를 표시할 행 높이 확보`);
assert.ok(overview.getRow(3).height <= 120, '행 높이는 설정한 상한을 넘지 않음');
assert.equal(overview.getRow(2).getCell(1).numFmt, '@');
assert.equal(overview.views[0].state, 'frozen');
assert.equal(overview.views[0].ySplit, 1);
assert.equal(overview.autoFilter, 'A1:Q6');
assert.equal(overview.getRow(2).getCell(1).border.left.style, 'thin');
assert.equal(overview.getRow(2).getCell(1).fill.fgColor.argb, 'FFF3F4F6');
assert.equal(overview.getRow(3).getCell(1).fill.fgColor.argb, 'FFFFFFFF');
assert.equal(overview.getRow(4).getCell(4).value, '');
assert.equal(overview.getRow(4).getCell(4).formula, undefined, 'empty HF stays an empty literal after reloading the generated ZIP');
assert.equal(overview.getRow(4).getCell(5).value, '미매칭 (No match)');
assert.equal(overview.getRow(5).getCell(3).value, '단 합계');
assert.equal(overview.getRow(5).getCell(6).value, '단');
assert.equal(overview.getRow(5).getCell(7).value, 2);
assert.equal(overview.getRow(5).getCell(8).value, 4);
assert.equal(overview.getRow(5).getCell(17).value, 47);
assert.equal(overview.getRow(6).getCell(3).value, '박스 합계');
assert.equal(overview.getRow(6).getCell(6).value, '박스');
assert.equal(overview.getRow(6).getCell(7).value, 0);
assert.equal(overview.getRow(6).getCell(8).value, 0);
assert.equal(overview.getRow(6).getCell(17).value, 7);
assert.equal(overview.getRow(5).getCell(3).font.bold, true);

const detail = reopened.getWorksheet('주문상세');
assert.equal(detail.getRow(2).getCell(2).value, '37-02', '실제 세부차수 보존');
assert.equal(detail.getRow(2).getCell(3).value, '7');
assert.equal(detail.getRow(2).getCell(4).value, '=CMD()');
assert.equal(detail.getRow(2).getCell(4).formula, undefined, 'formula-looking customer remains literal');
assert.equal(detail.getRow(2).getCell(3).value, '7', '업체키는 주문코드와 분리해 내부키로 보존');
assert.equal(detail.getRow(2).getCell(5).value, 'CL2');
assert.equal(detail.getRow(2).getCell(5).formula, undefined);
assert.equal(detail.getRow(2).getCell(6).value, '10');
assert.equal(detail.getRow(2).getCell(7).value, '0007');
assert.equal(detail.getRow(2).getCell(9).value, '001234');
assert.equal(detail.getRow(2).getCell(11).value, 2, 'order quantity remains numeric');
assert.equal(detail.getRow(3).getCell(2).value, '38-01');
assert.equal(detail.getRow(3).getCell(5).value, 'CL2');
assert.equal(detail.getRow(3).getCell(10).value, '단');
assert.equal(detail.getColumn(8).alignment.wrapText, true, 'detail product names wrap');
assert.equal(detail.getColumn(5).numFmt, '@', '업체 주문코드는 text format');
assert.equal(detail.getRow(9).getCell(5).value, '=CL2()', 'formula-looking customer order code stays literal');
assert.equal(detail.getRow(9).getCell(5).formula, undefined);
assert.equal(detail.getRow(10).getCell(5).value, '0008', 'leading-zero customer order code preserved');
assert.equal(detail.getRow(8).getCell(5).value, '', 'missing CL remains blank; custCode is not used as fallback');
assert.equal(detail.views[0].state, 'frozen');
assert.equal(detail.autoFilter, 'A1:K10');

const byCustomerKey = reopened.getWorksheet('업체별발주');
assert.equal(byCustomerKey.rowCount, 8, '집계는 custKey|prodKey|unit마다 한 행이며 상세행 수에는 영향 없음');
assert.deepEqual(byCustomerKey.getRow(1).values.slice(1), [
  '업체키(내부)', '업체 주문코드(CL)', '업체명', '품목키', '품목코드', '품목명', 'HF CODE', '매칭상태', '단위',
  '2026-37-02', '2026-37-03', '2026-37-03A', '2026-38-01', '2026-38-02', '2026-39-01', '2026-40-01', '2026-41-01', '2026-42-01', '2026-43 (주문 없음)', '합계',
]);
assert.equal(byCustomerKey.autoFilter, 'A1:T8');
assert.equal(byCustomerKey.getColumn(2).numFmt, '@');
assert.equal(byCustomerKey.getColumn(1).numFmt, '@');
const summaryFor = (custKey, unit) => {
  const row = byCustomerKey.getRows(2, byCustomerKey.rowCount - 1).find(item => item.getCell(1).value === String(custKey) && item.getCell(9).value === unit);
  assert.ok(row, `missing customer summary ${custKey}/${unit}`);
  return row;
};
const cust7Bunch = summaryFor(7, '단');
assert.equal(cust7Bunch.getCell(2).value, 'CL2');
assert.equal(cust7Bunch.getCell(10).value, 2);
assert.equal(cust7Bunch.getCell(13).value, 3);
assert.equal(cust7Bunch.getCell(20).value, 5, 'same customer/product/unit orders aggregate across exact subweeks');
const cust9Bunch = summaryFor(9, '단');
assert.equal(cust9Bunch.getCell(2).value, 'CL2');
assert.equal(cust9Bunch.getCell(20).value, 6, 'same CL but different custKey remains a separate summary');
assert.notEqual(cust7Bunch.number, cust9Bunch.number);
assert.equal(summaryFor(8, '단').getCell(2).value, 'CLS');
assert.equal(summaryFor(7, '박스').getCell(20).value, 7, 'same customer/product with another unit remains separate');
assert.equal(summaryFor(10, '단').getCell(2).value, '', 'missing CL is not inferred from custCode');
assert.equal(summaryFor(11, '단').getCell(2).value, '=CL2()', 'formula-looking CL summary stays literal');
assert.equal(summaryFor(11, '단').getCell(2).formula, undefined);
assert.equal(summaryFor(12, '단').getCell(2).value, '0008', 'leading-zero CL preserved in summary');
assert.equal(summaryFor(8, '단').getCell(11).value, 4, '03 remains distinct');
assert.equal(summaryFor(8, '단').getCell(12).value, 5, '03A remains distinct');
assert.equal([...Array(byCustomerKey.rowCount - 1)].reduce((sum, _, index) => sum + Number(byCustomerKey.getRow(index + 2).getCell(20).value), 0), 54, 'grouped total equals source detail total with no dropped or duplicated orders');
assert.ok(byCustomerKey.getRow(2).getCell(1).border.left.style === 'thin');
assert.ok(byCustomerKey.getRow(2).getCell(1).fill.fgColor.argb === 'FFF3F4F6');
assert.ok(byCustomerKey.getRow(3).getCell(1).fill.fgColor.argb === 'FFFFFFFF');

const basis = reopened.getWorksheet('조회기준');
assert.equal(basis.getRow(4).getCell(2).value, 'hf.xlsx');
assert.equal(basis.getRow(2).getCell(2).value, '중심차수 2026-40 / 조회차수 범위 2026-37 ~ 2026-43');
assert.equal(basis.getRow(3).getCell(2).value, '2026-10-05T01:30:00.000Z');
assert.equal(basis.getRow(6).getCell(2).value, 'HF 매칭·검토 상태는 참고정보이며 원본 주문과 ERP 원장은 변경하지 않습니다.');
assert.equal(basis.getRow(7).getCell(2).value, '일부 HF 코드 검토 필요');

const matrixSource = {
  ...report,
  rows: [...report.rows.slice(0, 2), { prodKey: 17, prodCode: '0017', prodName: 'A Unknown steam factor', unit: '송이', quantities: {}, total: 0, steamOf1Box: null }, ...report.rows.slice(2)],
  orders: [...report.orders.map(order => ({ ...order, country: '중국', bunchOf1Box: 4, steamOf1Box: null })),
    { country: '중국', orderYear: 2026, orderWeek: '37-03', custKey: 7, custName: '=CMD()', custOrderCode: 'CL2', prodKey: 10, prodCode: '0007', prodName: '=2+2', unit: '단', quantity: 0.5, bunchOf1Box: 4 },
    { country: '중국', orderYear: 2026, orderWeek: '37-03', custKey: 9, custName: '고객 C', custOrderCode: 'CL2', prodKey: 10, prodCode: '0007', prodName: '=2+2', unit: '단', quantity: 2.75, bunchOf1Box: 4 },
    { country: '중국', orderYear: 2026, orderWeek: '37-03', custKey: 13, custName: '업체명 헤더가 길어서 여러 줄로 표시되어야 하는 테스트 업체 이름입니다 그리고 추가로 길게 작성된 거래처 이름을 헤더 높이 검증에 사용합니다', custOrderCode: '000000000000000000000000000000000000000000000000000000000000CL', prodKey: 10, prodCode: '0007', prodName: '=2+2', unit: '단', quantity: 0.125, bunchOf1Box: 4 },
    { country: '중국', orderYear: 2026, orderWeek: '37-03', custKey: 8, custName: '고객 B', custOrderCode: 'CLS', prodKey: 11, prodCode: '0008', prodName: 'Review product', unit: '박스', quantity: 3.5 },
    { country: '중국', orderYear: 2026, orderWeek: '37-03', custKey: 8, custName: '고객 B', custOrderCode: 'CLS', prodKey: 17, prodCode: '0017', prodName: 'A Unknown steam factor', unit: '송이', quantity: 2, steamOf1Box: null },
    { country: '중국', orderYear: 2026, orderWeek: '37-03', custKey: 14, custName: 'CL 누락', custOrderCode: '', prodKey: 12, prodCode: '0012', prodName: 'Blank HF literal', unit: '단', quantity: 0.25, bunchOf1Box: 2 },
    { country: '중국', orderYear: 2026, orderWeek: '37-03', custKey: 15, custName: '선행제로 코드', custOrderCode: '0008', prodKey: 10, prodCode: '0007', prodName: '=2+2', unit: '단', quantity: 0.375, bunchOf1Box: 4 },
    { country: '중국', orderYear: 2026, orderWeek: '37-03', custKey: 16, custName: '수식형 CL', custOrderCode: '=CL2()', prodKey: 10, prodCode: '0007', prodName: '=2+2', unit: '단', quantity: 0.25, bunchOf1Box: 4 },
  ],
};
const selectedMatrixReport = selectChinaOrderSubweek(matrixSource, '2026/37-03');
const matrixWorkbook = await buildChinaOrderWorkbook(selectedMatrixReport, mapping);
const matrixReopened = new ExcelJS.Workbook();
await matrixReopened.xlsx.load(await matrixWorkbook.xlsx.writeBuffer());
assert.deepEqual(matrixReopened.worksheets.map(sheet => sheet.name), ['품목별업체수량', '수량원본', '발주현황', '업체별발주', '주문상세', '조회기준']);
const matrixSheet = matrixReopened.getWorksheet('품목별업체수량');
const sourceSheet = matrixReopened.getWorksheet('수량원본');
assert.equal(sourceSheet.state, 'veryHidden', 'numeric source is available for audit but hidden in the workbook UI');
assert.deepEqual(matrixSheet.getRow(1).values.slice(1, 4), ['품목명(HF 코드)', '단위', '총수량(박스수)']);
assert.deepEqual(matrixSheet.getRow(1).values.slice(4), ['=CL2()', '000000000000000000000000000000000000000000000000000000000000CL', '0008', 'CL2', 'CL2', 'CLS', 'CL미등록'], 'customer headers contain CL only, in shared-model prefix order');
assert.ok(matrixSheet.getRow(1).height > 30, 'long CL-only header wraps without a customer name');
assert.equal(matrixSheet.views[0].xSplit, 3, 'first three identity/total columns remain frozen');
assert.equal(matrixSheet.views[0].ySplit, 1, 'header remains frozen');
const matrixProduct10 = [...Array(matrixSheet.rowCount - 1)].map((_, index) => matrixSheet.getRow(index + 2))
  .find(row => String(row.getCell(1).value).startsWith('=2+2'));
assert.ok(matrixProduct10, 'formula-like product name is present as literal text');
assert.equal(matrixProduct10.getCell(1).formula, undefined);
assert.ok(String(matrixProduct10.getCell(1).value).includes('001234'), 'HF code comes from exact HF mapping, not ProdCode/ProdKey');
const duplicateClColumns = matrixSheet.getRow(1).values.flatMap((value, index) => value === 'CL2' ? [index] : []);
const [cust7Column, cust9Column] = duplicateClColumns;
const cust8Column = matrixSheet.getRow(1).values.indexOf('CLS');
const longCustomerColumn = matrixSheet.getRow(1).values.indexOf('000000000000000000000000000000000000000000000000000000000000CL');
const zeroCodeColumn = matrixSheet.getRow(1).values.indexOf('0008');
const formulaCodeColumn = matrixSheet.getRow(1).values.indexOf('=CL2()');
const missingClColumn = matrixSheet.getRow(1).values.indexOf('CL미등록');
assert.equal(matrixSheet.getRow(1).getCell(formulaCodeColumn).formula, undefined, 'formula-looking CL remains literal text');
assert.ok(zeroCodeColumn >= 4, 'leading-zero CL remains text');
assert.equal(matrixSheet.getRow(1).getCell(cust7Column).border.left.style, 'medium', 'a medium divider marks the CL prefix-group boundary');
assert.equal(matrixProduct10.getCell(3).value.result, '8(2)', 'selected total displays original quantity and derived boxes');
assert.match(matrixProduct10.getCell(3).formula, /TEXT\('수량원본'!/);
assert.match(matrixProduct10.getCell(3).formula, /ROUND\(.+,3\)=INT\(ROUND\(.+,3\)\)/, 'integer formatting survives Excel recalculation without a trailing decimal point');
assert.match(matrixProduct10.getCell(cust7Column).formula, /^IF\('수량원본'!.+=0,"",TEXT/, 'empty customer cells stay visually blank');
assert.equal(matrixProduct10.getCell(cust7Column).value.result, '0.5(0.125)', 'same-CL CustKey 7 remains separately addressable');
assert.equal(matrixProduct10.getCell(cust9Column).value.result, '2.75(0.688)', 'same-CL CustKey 9 retains its own decimal quantity');
assert.equal(matrixProduct10.getCell(cust8Column).value.result, '4(1)', 'selected customer quantity is retained');
assert.equal(matrixProduct10.getCell(longCustomerColumn).value.result, '0.125(0.031)');
assert.equal(matrixProduct10.getCell(zeroCodeColumn).value.result, '0.375(0.094)');
assert.ok(matrixProduct10.getCell(formulaCodeColumn).formula.includes("'수량원본'!"));
assert.equal(sourceSheet.getColumn(7).hidden, true, 'raw numbers are hidden from presentation');
const sourceProduct10 = sourceSheet.getRow(2);
assert.equal(sourceProduct10.getCell(3).value, 4, 'one master divisor is retained for the product row');
assert.equal(sourceProduct10.getCell(4).value.result, 8, 'numeric source total remains auditable as a SUM formula');
assert.match(sourceProduct10.getCell(4).formula, /^SUM\(/);
assert.equal(sourceProduct10.getCell(5).value.result, 2, 'box total is calculated from the stored divisor');
assert.match(sourceProduct10.getCell(5).formula, /D2\/C2/);
assert.match(sourceProduct10.getCell(5).formula, /^IF\(D2=0,0,/, 'zero raw quantity yields zero boxes even if its master factor is missing');
const cust7RawColumn = sourceSheet.getRow(1).values.indexOf('7 원수량');
assert.equal(sourceProduct10.getCell(cust7RawColumn).value, 0.5, 'raw customer quantity is stored numerically');
assert.equal(sourceProduct10.getCell(cust7RawColumn + 1).value.result, 0.125, 'box formula references the raw number and master factor');
const matrixBoxProduct = [...Array(matrixSheet.rowCount - 1)].map((_, index) => matrixSheet.getRow(index + 2))
  .find(row => String(row.getCell(1).value).startsWith('Review product'));
assert.equal(matrixBoxProduct.getCell(1).value, 'Review product (HF002)', 'only an explicit HF code is appended; review status is omitted');
assert.equal(matrixBoxProduct.getCell(2).value, '박스');
const matrixMissingProduct = [...Array(matrixSheet.rowCount - 1)].map((_, index) => matrixSheet.getRow(index + 2))
  .find(row => String(row.getCell(1).value).startsWith('Blank HF literal'));
assert.equal(matrixMissingProduct.getCell(1).value, 'Blank HF literal', 'missing HF adds no placeholder/status text');
assert.equal(matrixMissingProduct.getCell(missingClColumn).value.result, '0.25(0.125)', 'missing CL is shown with the required label and exact master factor');
const unknownFactorDisplay = [...Array(matrixSheet.rowCount - 1)].map((_, index) => matrixSheet.getRow(index + 2)).find(row => row.getCell(1).value === 'A Unknown steam factor');
assert.equal(unknownFactorDisplay.getCell(3).value.result, '2(—)', 'unknown unit factor is displayed as unknown, not zero');
const missingSourceRow = [...Array(sourceSheet.rowCount - 1)].map((_, index) => sourceSheet.getRow(index + 2)).find(row => Number(row.getCell(1).value) === 17);
assert.equal(missingSourceRow.getCell(3).value, '', 'missing divisor is not guessed or defaulted');
assert.equal(missingSourceRow.getCell(5).value.result ?? '', '', 'missing-factor box result is blank, not zero');
assert.match(missingSourceRow.getCell(7).formula, /<=0/);
const unitFooters = [...Array(matrixSheet.rowCount - 1)].map((_, index) => matrixSheet.getRow(index + 2));
const bunchFooter = unitFooters.find(row => row.getCell(1).value === '단 합계');
const boxFooter = unitFooters.find(row => row.getCell(1).value === '박스 합계');
assert.ok(bunchFooter && boxFooter, 'each unit gets a distinct total footer');
assert.equal(bunchFooter.getCell(3).value.result, '8.25(2.125)', 'other-unit unknown factors do not contaminate this footer');
assert.equal(boxFooter.getCell(3).value.result, '3.5(3.5)');
const steamFooter = unitFooters.find(row => row.getCell(1).value === '송이 합계');
assert.equal(steamFooter.getCell(3).value.result, '2(—)', 'same-unit positive unknown factor makes its footer unknown');
const sourceBunchFooter = sourceSheet.getRows(5, sourceSheet.rowCount - 4).find(row => row.getCell(1).value === '단 합계');
assert.ok(sourceBunchFooter, 'hidden source keeps the unit footer');
assert.equal(sourceBunchFooter.getCell(4).value.result, 8.25, 'raw footer quantity is a cached numeric SUM');
assert.equal(sourceBunchFooter.getCell(5).value.result, 2.125, 'footer SUM uses only its own interleaved unit rows');
assert.match(sourceBunchFooter.getCell(5).formula, /AND\(OR\(C2="",C2<=0\),D2>0\)/);
assert.match(sourceBunchFooter.getCell(5).formula, /AND\(OR\(C4="",C4<=0\),D4>0\)/);
assert.doesNotMatch(sourceBunchFooter.getCell(5).formula, /C3=/, 'interleaved 송이 missing factor is excluded from 단 footer guard');
const cust8BoxSourceColumn = sourceSheet.getRow(1).values.indexOf('8 박스수');
assert.doesNotMatch(sourceBunchFooter.getCell(cust8BoxSourceColumn).formula, /C3=/, 'customer footer guard also considers only same-unit source rows');
const sourceSteamFooter = sourceSheet.getRows(5, sourceSheet.rowCount - 4).find(row => row.getCell(1).value === '송이 합계');
assert.equal(sourceSteamFooter.getCell(5).value.result ?? '', '', 'positive same-unit unknown factor keeps its footer unknown');
assert.equal(matrixSheet.getRow(2).getCell(1).border.left.style, 'thin');
assert.equal(matrixSheet.getRow(2).getCell(1).fill.fgColor.argb, 'FFF3F4F6');
assert.equal(bunchFooter.getCell(1).font.bold, true);

for (const mutate of [
  candidate => { candidate.columns.pop(); },
  candidate => { candidate.columns[1] = { ...candidate.columns[1], key: candidate.columns[0].key }; },
  candidate => { candidate.columns[0] = { ...candidate.columns[0], cycleKey: 'foreign-cycle' }; },
  candidate => { candidate.columns[0] = { ...candidate.columns[0], label: '37-01' }; },
  candidate => { candidate.columns[0] = { ...candidate.columns[0], orderWeek: '37-03' }; },
]) {
  const invalid = structuredClone(report);
  mutate(invalid);
  await assert.rejects(() => buildChinaOrderWorkbook(invalid, mapping), /세부차수 열|세부차수 라벨/);
}

const selectedEmpty = { ...report, selectedColumnKey: '202643/empty' };
await assert.rejects(() => buildChinaOrderWorkbook(selectedEmpty, mapping), /실제 세부차수 열/);

const spanningCycles = [
  [2025, '51'], [2025, '52'], [2025, '53'], [2026, '01'], [2026, '02'], [2026, '03'], [2026, '04'],
].map(([year, majorWeek], index) => ({ year, majorWeek, key: `${year}${majorWeek}`, offset: index - 3 }));
const generated = buildChinaOrderReport({
  success: true,
  readOnly: true,
  scope: { year: 2026, majorWeek: '01' },
  cycles: spanningCycles,
  orders: [
    { country: '중국', orderYear: 2025, orderWeek: '51-01', custKey: 7, custName: '업체', custOrderCode: 'CL', prodKey: 10, prodCode: '0010', prodName: '품목', unit: '단', quantity: 2 },
    { country: '중국', orderYear: 2026, orderWeek: '01-01', custKey: 7, custName: '업체', custOrderCode: 'CL', prodKey: 10, prodCode: '0010', prodName: '품목', unit: '단', quantity: 3 },
    { country: '중국', orderYear: 2026, orderWeek: '01-01', custKey: 8, custName: '다른 업체', custOrderCode: 'CL8', prodKey: 10, prodCode: '0010', prodName: '품목', unit: '단', quantity: 13 },
    { country: '중국', orderYear: 2026, orderWeek: '01-03', custKey: 7, custName: '업체', custOrderCode: 'CL', prodKey: 10, prodCode: '0010', prodName: '품목', unit: '단', quantity: 5 },
    { country: '중국', orderYear: 2026, orderWeek: '01-03A', custKey: 7, custName: '업체', custOrderCode: 'CL', prodKey: 10, prodCode: '0010', prodName: '품목', unit: '단', quantity: 7 },
    { country: '중국', orderYear: 2026, orderWeek: '01-03a', custKey: 7, custName: '업체', custOrderCode: 'CL', prodKey: 10, prodCode: '0010', prodName: '품목', unit: '단', quantity: 11 },
  ],
});
assert.deepEqual(generated.columns.map(column => column.key), [
  '2025/51-01', '202552/empty', '202553/empty', '2026/01-01', '2026/01-03', '2026/01-03A', '2026/01-03a',
  '202602/empty', '202603/empty', '202604/empty',
]);
const generatedWorkbook = await buildChinaOrderWorkbook(generated, mapping);
const generatedReopened = new ExcelJS.Workbook();
await generatedReopened.xlsx.load(await generatedWorkbook.xlsx.writeBuffer());
const generatedCustomerSheet = generatedReopened.getWorksheet('업체별발주');
assert.equal(generatedCustomerSheet.getRow(1).getCell(10).value, '2025-51-01');
assert.deepEqual(generatedCustomerSheet.getRow(1).values.slice(13, 17), [
  '2026-01-01', '2026-01-03', '2026-01-03A', '2026-01-03a',
]);
const generatedCustomerRow = generatedCustomerSheet.getRows(2, generatedCustomerSheet.rowCount - 1).find(row => row.getCell(1).value === '7');
const actualGeneratedColumns = generated.columns.filter(column => !column.empty);
assert.deepEqual(actualGeneratedColumns.map(column => generatedCustomerRow.getCell(10 + generated.columns.indexOf(column)).value), [2, 3, 5, 7, 11],
  'year collision and uppercase/lowercase suffix weeks map to separate exact columns');
const crossYearSelected = selectChinaOrderSubweek(generated, '2026/01-03A');
const crossYearMatrixWorkbook = await buildChinaOrderWorkbook(crossYearSelected, mapping);
const crossYearMatrixSheet = crossYearMatrixWorkbook.getWorksheet('품목별업체수량');
assert.ok(crossYearMatrixSheet, 'selected cross-year/suffix report gets a matrix sheet');
assert.equal(crossYearMatrixSheet.getRow(2).getCell(3).value.result, '7(—)', 'same major week in the prior year and 03 suffix do not leak into the selected total');
const filteredSubweek = selectChinaOrderSubweek(generated, '2026/01-01', new Set(['7|10|단']));
const filteredWorkbook = await buildChinaOrderWorkbook(filteredSubweek, mapping);
const filteredReopened = new ExcelJS.Workbook();
await filteredReopened.xlsx.load(await filteredWorkbook.xlsx.writeBuffer());
const filteredOverview = filteredReopened.getWorksheet('발주현황');
const filteredCustomers = filteredReopened.getWorksheet('업체별발주');
assert.equal(filteredOverview.getRow(1).getCell(7).value, '2026-01-01');
assert.equal(filteredOverview.getRow(1).getCell(8).value, '합계');
assert.equal(filteredCustomers.getRow(1).getCell(10).value, '2026-01-01');
assert.equal(filteredCustomers.getRow(1).getCell(11).value, '합계');
assert.equal(filteredCustomers.rowCount, 2, 'filtered customer rows round-trip as a one-customer export');
assert.equal(filteredCustomers.getRow(2).getCell(1).value, '7');
assert.equal(filteredCustomers.getRow(2).getCell(10).value, 3);
assert.equal(filteredCustomers.getRow(2).getCell(11).value, 3);
assert.equal(filteredReopened.getWorksheet('조회기준').getRow(2).getCell(2).value,
  '중심차수 2026-01 / 조회차수 범위 2025-51 ~ 2026-04 / 선택 세부차수 2026-01-01');
const wrongSelectedOrders = { ...filteredSubweek, orders: [...filteredSubweek.orders, generated.orders.find(order => order.orderWeek === '01-03')] };
await assert.rejects(() => buildChinaOrderWorkbook(wrongSelectedOrders, mapping), /해당 연도·세부차수/);
console.log('chinaOrderWorkbook tests passed');
