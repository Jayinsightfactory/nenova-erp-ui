import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { buildChinaOrderWorkbook } from '../lib/chinaOrderWorkbook.js';

const report = {
  scope: { year: 2026, majorWeek: '40' }, queriedAt: '2026-10-05T01:30:00.000Z', warnings: ['일부 HF 코드 검토 필요'],
  cycles: [37, 38, 39, 40, 41, 42, 43].map(majorWeek => ({ key: `2026${majorWeek}`, year: 2026, majorWeek })),
  rows: [
    { prodKey: 10, prodCode: '0007', prodName: '=2+2', unit: '단', quantities: { 202637: 2, 202638: 1 }, total: 3 },
    { prodKey: 11, prodCode: '0008', prodName: 'Review product 꽃 이름이 길어졌을 때 표 셀 안에서 원문 전체가 줄바꿈되어 읽힐 수 있도록 충분한 행 높이가 자동으로 계산되는 검증용 중국 품목명입니다', unit: '박스', quantities: { 202637: 4, 202638: 0 }, total: 4 },
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
    { orderYear: 2026, orderWeek: '38-02', custKey: 9, custName: '고객 C', custOrderCode: 'CL2', prodKey: 10, prodCode: '0007', prodName: '=2+2', unit: '단', quantity: 6 },
    { orderYear: 2026, orderWeek: '39-01', custKey: 7, custName: '=CMD()', custOrderCode: 'CL2', prodKey: 10, prodCode: '0007', prodName: '=2+2', unit: '박스', quantity: 7 },
    { orderYear: 2026, orderWeek: '40-01', custKey: 10, custName: '업체 D', custOrderCode: '', custCode: 'DO-NOT-INFER', prodKey: 10, prodCode: '0007', prodName: '=2+2', unit: '단', quantity: 8 },
    { orderYear: 2026, orderWeek: '41-01', custKey: 11, custName: '업체 E', custOrderCode: '=CL2()', prodKey: 10, prodCode: '0007', prodName: '=2+2', unit: '단', quantity: 9 },
    { orderYear: 2026, orderWeek: '42-01', custKey: 12, custName: '업체 F', custOrderCode: '0008', prodKey: 10, prodCode: '0007', prodName: '=2+2', unit: '단', quantity: 10 },
  ],
  totals: [
    { unit: '단', quantities: { 202637: 2, 202638: 1 }, total: 3 },
    { unit: '박스', quantities: { 202637: 4, 202638: 0 }, total: 4 },
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
assert.equal(overview.getRow(2).getCell(8).value, 1);
assert.equal(overview.getRow(2).getCell(14).value, 3);
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
assert.equal(overview.autoFilter, 'A1:N6');
assert.equal(overview.getRow(2).getCell(1).border.left.style, 'thin');
assert.equal(overview.getRow(2).getCell(1).fill.fgColor.argb, 'FFF3F4F6');
assert.equal(overview.getRow(3).getCell(1).fill.fgColor.argb, 'FFFFFFFF');
assert.equal(overview.getRow(4).getCell(4).value, '');
assert.equal(overview.getRow(4).getCell(4).formula, undefined, 'empty HF stays an empty literal after reloading the generated ZIP');
assert.equal(overview.getRow(4).getCell(5).value, '미매칭 (No match)');
assert.equal(overview.getRow(5).getCell(3).value, '단 합계');
assert.equal(overview.getRow(5).getCell(6).value, '단');
assert.equal(overview.getRow(5).getCell(7).value, 2);
assert.equal(overview.getRow(5).getCell(8).value, 1);
assert.equal(overview.getRow(5).getCell(14).value, 3);
assert.equal(overview.getRow(6).getCell(3).value, '박스 합계');
assert.equal(overview.getRow(6).getCell(6).value, '박스');
assert.equal(overview.getRow(6).getCell(7).value, 4);
assert.equal(overview.getRow(6).getCell(8).value, 0);
assert.equal(overview.getRow(6).getCell(14).value, 4);
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
assert.equal(detail.getRow(8).getCell(5).value, '=CL2()', 'formula-looking customer order code stays literal');
assert.equal(detail.getRow(8).getCell(5).formula, undefined);
assert.equal(detail.getRow(9).getCell(5).value, '0008', 'leading-zero customer order code preserved');
assert.equal(detail.getRow(7).getCell(5).value, '', 'missing CL remains blank; custCode is not used as fallback');
assert.equal(detail.views[0].state, 'frozen');
assert.equal(detail.autoFilter, 'A1:K9');

const byCustomerKey = reopened.getWorksheet('업체별발주');
assert.equal(byCustomerKey.rowCount, 8, '집계는 custKey|prodKey|unit마다 한 행이며 상세행 수에는 영향 없음');
assert.deepEqual(byCustomerKey.getRow(1).values.slice(1), [
  '업체키(내부)', '업체 주문코드(CL)', '업체명', '품목키', '품목코드', '품목명', 'HF CODE', '매칭상태', '단위',
  '2026-37', '2026-38', '2026-39', '2026-40', '2026-41', '2026-42', '2026-43', '합계',
]);
assert.equal(byCustomerKey.autoFilter, 'A1:Q8');
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
assert.equal(cust7Bunch.getCell(11).value, 3);
assert.equal(cust7Bunch.getCell(17).value, 5, 'same customer/product/unit orders aggregate across subweeks');
const cust9Bunch = summaryFor(9, '단');
assert.equal(cust9Bunch.getCell(2).value, 'CL2');
assert.equal(cust9Bunch.getCell(17).value, 6, 'same CL but different custKey remains a separate summary');
assert.notEqual(cust7Bunch.number, cust9Bunch.number);
assert.equal(summaryFor(8, '단').getCell(2).value, 'CLS');
assert.equal(summaryFor(7, '박스').getCell(17).value, 7, 'same customer/product with another unit remains separate');
assert.equal(summaryFor(10, '단').getCell(2).value, '', 'missing CL is not inferred from custCode');
assert.equal(summaryFor(11, '단').getCell(2).value, '=CL2()', 'formula-looking CL summary stays literal');
assert.equal(summaryFor(11, '단').getCell(2).formula, undefined);
assert.equal(summaryFor(12, '단').getCell(2).value, '0008', 'leading-zero CL preserved in summary');
assert.equal([...Array(byCustomerKey.rowCount - 1)].reduce((sum, _, index) => sum + Number(byCustomerKey.getRow(index + 2).getCell(17).value), 0), 49, 'grouped total equals source detail total with no dropped or duplicated orders');
assert.ok(byCustomerKey.getRow(2).getCell(1).border.left.style === 'thin');
assert.ok(byCustomerKey.getRow(2).getCell(1).fill.fgColor.argb === 'FFF3F4F6');
assert.ok(byCustomerKey.getRow(3).getCell(1).fill.fgColor.argb === 'FFFFFFFF');

const basis = reopened.getWorksheet('조회기준');
assert.equal(basis.getRow(4).getCell(2).value, 'hf.xlsx');
assert.equal(basis.getRow(2).getCell(2).value, '중심차수 2026-40 / 조회차수 범위 2026-37 ~ 2026-43');
assert.equal(basis.getRow(3).getCell(2).value, '2026-10-05T01:30:00.000Z');
assert.equal(basis.getRow(6).getCell(2).value, 'HF 매칭·검토 상태는 참고정보이며 원본 주문과 ERP 원장은 변경하지 않습니다.');
assert.equal(basis.getRow(7).getCell(2).value, '일부 HF 코드 검토 필요');
console.log('chinaOrderWorkbook tests passed');
