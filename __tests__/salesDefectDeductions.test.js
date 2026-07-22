import assert from 'node:assert/strict';
import fs from 'node:fs';
import ExcelJS from 'exceljs';
import { scoreMatch } from '../lib/displayName.js';
import {
  deductionManagerIdentity,
  normalizeParentWeek,
  previousParentScope,
  normalizeDeductionRow,
  mergeSavedDeductionRows,
  partitionSelectedDeductionRows,
  lookupSelectionDelta,
} from '../lib/salesDefectDeductionCore.js';
import { getStatementProductName } from '../lib/estimatePrintFormats.js';
import {
  parseQuantityCell,
  parseSalesDefectWorkbook,
  buildSalesDefectWorkbook,
  formatSalesDefectExportRows,
} from '../lib/salesDefectDeductionExcel.js';
import { matchImportRows, buildProductSuggestions } from '../lib/orderImportMatch.js';
import { resolveImportCustomer } from '../lib/orderImportCustomerMatch.js';
import { matchSalesDefectRows } from '../lib/salesDefectDeductions.js';

assert.equal(normalizeParentWeek('29-02'), 29);
assert.equal(normalizeParentWeek('29'), 29);
assert.deepEqual(previousParentScope(2026, 29), { year: 2026, week: 28 });
assert.deepEqual(previousParentScope(2026, 1), { year: 2025, week: 52 });
assert.deepEqual(parseQuantityCell('1,250단'), { quantity: 1250, unit: '단', raw: '1,250단' });
assert.deepEqual(parseQuantityCell('5대'), { quantity: 5, unit: '스팀(대)', raw: '5대' });
assert.equal(normalizeDeductionRow({ quantity: '-5', customerName: 'A' }).quantity, 5);
assert.equal(getStatementProductName({ ProdName: 'CARNATION Moon Light' }), 'Moon Light');
assert.equal(getStatementProductName({ ProdName: 'CARNATION Novia' }), 'Novia');
const savedNewRows = mergeSavedDeductionRows(
  [
    { deductionKey: null, customerName: '상희꽃상사', productName: '카네이션', colorName: 'Moon Light', quantity: 1 },
    { deductionKey: null, customerName: '상희꽃상사', productName: '카네이션', colorName: 'Novia', quantity: 2 },
  ],
  [
    { deductionKey: 101, customerName: '상희꽃상사', colorName: 'Moon Light', quantity: 1 },
    { deductionKey: 102, customerName: '상희꽃상사', colorName: 'Novia', quantity: 2 },
  ],
  [
    { deductionKey: null, customerName: '상희꽃상사', productName: '카네이션', colorName: 'Moon Light', quantity: 1 },
    { deductionKey: null, customerName: '상희꽃상사', productName: '카네이션', colorName: 'Novia', quantity: 2 },
  ],
);
assert.deepEqual(savedNewRows.map((row) => row.deductionKey), [101, 102]);
assert.deepEqual(
  partitionSelectedDeductionRows(
    [{ deductionKey: 101 }, { deductionKey: null }, { deductionKey: 102 }],
    new Set([0, 1]),
  ),
  { indexes: [0, 1], storedKeys: [101], unsavedIndexes: [1] },
);
assert.equal(lookupSelectionDelta('ArrowRight'), 1);
assert.equal(lookupSelectionDelta('ArrowLeft'), -1);
assert.equal(lookupSelectionDelta('ArrowDown'), 1);
assert.equal(lookupSelectionDelta('Enter'), 0);
const deductionSource = fs.readFileSync('lib/salesDefectDeductions.js', 'utf8');
assert.ok(deductionSource.includes('sm.OrderYear < @scopeYear'), '이전 차수 단가가 없으면 과거 연도까지 최신 유효 단가를 찾아야 한다.');
assert.ok(deductionSource.includes('COALESCE(NULLIF(sdd.Cost,0), NULLIF(sd.Cost,0), 0) > 0'), '0원 단가는 대체 단가 후보에서 제외해야 한다.');
assert.deepEqual(
  deductionManagerIdentity({ CreatedBy: 'jkim', CreatedByName: '김담당' }),
  { id: 'jkim', name: '김담당' },
);
assert.deepEqual(
  deductionManagerIdentity({ CreatedBy: '', CreatedByName: '', UpdatedBy: 'lee', UpdatedByName: '이담당' }),
  { id: 'lee', name: '이담당' },
);

const templatePath = 'data/sales-defect-deduction-template.xlsx';
assert.ok(fs.existsSync(templatePath), '원본 불량 차감 양식이 있어야 한다.');
const source = await parseSalesDefectWorkbook(fs.readFileSync(templatePath));
assert.equal(source.sheetName, '30차');
assert.equal(source.title.year, '2026');
assert.equal(source.title.week, '29');
assert.equal(source.rows[0].customerName, '광주천사');
assert.equal(source.rows[0].quantity, 5);

const buffer = await buildSalesDefectWorkbook([
  {
    customerName: '테스트거래처', productName: '카네이션', colorName: '카오리',
    countryName: '콜롬비아', quantity: 5, sourceUnit: '단', creditApplied: true, farmName: '테스트농장', note: '메모',
  },
], { year: 2026, week: 29, managerName: '테스트담당자' });
const wb = new ExcelJS.Workbook();
await wb.xlsx.load(buffer);
assert.equal(wb.worksheets[0].name, '29차');
assert.equal(String(wb.worksheets[0].getCell('D2').value).includes('( 29 )'), true);
assert.equal(wb.worksheets[0].getCell('B6').value, '테스트거래처');
assert.equal(wb.worksheets[0].getCell('G6').value, '5단');
assert.equal(wb.worksheets[0].getCell('H6').value, '✓');
assert.equal(wb.worksheets[0].getCell('B6').alignment.horizontal, 'center');
assert.ok(!wb.worksheets[0].getCell('B6').alignment.indent || wb.worksheets[0].getCell('B6').alignment.indent === 0);
assert.equal(wb.worksheets[0].getRow(6).height >= 25, true);

const formattedExport = formatSalesDefectExportRows([
  { customerName: '그린화원', productName: '카네이션', countryName: '콜롬비아', colorName: '문라이트', quantity: 1 },
  { customerName: '그린화원', productName: '카네이션', countryName: '콜롬비아', colorName: '노비아', quantity: 2 },
  { customerName: '그린화원', productName: '장미', countryName: '콜롬비아', colorName: '화이트', quantity: 3 },
  { customerName: '다른화원', productName: '카네이션', countryName: '네덜란드', colorName: '화이트', quantity: 4 },
]);
assert.deepEqual(formattedExport.map((row) => row.blank ? 'blank' : [row.customerName, row.productName]), [
  ['그린화원', '콜롬비아 카네이션'],
  ['', ''],
  ['', '콜롬비아 장미'],
  'blank',
  ['다른화원', '네덜란드 카네이션'],
]);

const kaoriScore = scoreMatch('카네이션 카오리', {
  ProdKey: 417,
  ProdName: 'CARNATION Kaori',
  DisplayName: '카오리',
  FlowerName: '카네이션',
  CounName: '콜롬비아',
});
assert.ok(kaoriScore >= 60, `CARNATION Kaori matching score should be registerable: ${kaoriScore}`);

const popularityProducts = [
  { ProdKey: 501, ProdName: 'CARNATION Moon Light', DisplayName: 'Moon Light', FlowerName: '카네이션', CounName: '콜롬비아' },
  { ProdKey: 502, ProdName: 'ROSE Moon Light', DisplayName: 'Moon Light', FlowerName: '장미', CounName: '에콰도르' },
];
const popularMoonLight = buildProductSuggestions('MOON LIGHT', popularityProducts, {
  usageByProdKey: new Map([[501, { usageCount: 100 }], [502, { usageCount: 1 }]]),
  limit: 2,
  minScore: 0,
});
assert.equal(popularMoonLight[0].prodKey, 501, '동점 품목은 실제 입력 사용빈도가 높은 후보가 먼저여야 한다.');
const popularCustomer = resolveImportCustomer('그린', [
  { CustKey: 601, CustName: '그린화원' },
  { CustKey: 602, CustName: '그린상사' },
], { usageByCustKey: new Map([[601, { usageCount: 100 }], [602, { usageCount: 1 }]]) });
assert.equal(popularCustomer.custKey, 601, '동점 거래처는 실제 입력 사용빈도가 높은 후보가 먼저여야 한다.');

// 불량차감은 과거 엑셀/붙여넣기 학습 매핑으로 품목을 자동 확정하지 않는다.
// 입력값은 원문으로 남고, Product DB에서 사용자가 선택한 ProdKey만 적용한다.
const matchingProducts = [{
  ProdKey: 417,
  ProdName: 'CARNATION Kaori',
  DisplayName: '카오리',
  FlowerName: '카네이션',
  CounName: '콜롬비아',
  OutUnit: '단',
  EstUnit: '단',
}];
const matchingContext = {
  allProducts: matchingProducts,
  productByKey: new Map([[417, matchingProducts[0]]]),
  prodUnitMap: {},
  savedMappings: {},
  unitCatalog: {},
};
const pasteMatch = matchImportRows([{
  rowNo: 1, inputName: '카네이션 카오리', qty: 5, unit: '단',
}], matchingContext)[0];
const defectUnselected = matchSalesDefectRows([{
  sourceRowNo: 1,
  customerName: '광주천사',
  productName: '카네이션',
  colorName: '카오리',
  quantity: 5,
  sourceUnit: '단',
}], {
  ...matchingContext,
  customers: [{ CustKey: 9001, CustName: '광주천사', CustArea: '' }],
  products: matchingProducts,
  farms: [],
});
assert.equal(defectUnselected[0].prodKey, null, '품목은 DB 후보를 사용자가 선택하기 전 자동 매칭하지 않는다.');
assert.equal(defectUnselected[0].matchedProductDbName, '', '미선택 품목은 DB 품명을 표시하지 않는다.');
assert.equal(defectUnselected[0].needsReview, true, '품목 미선택 행은 검토 필요 상태여야 한다.');
assert.equal(defectUnselected[0].custKey, 9001, '거래처는 현재 Customer DB 이름으로만 확인한다.');

const defectSelected = matchSalesDefectRows([{
  sourceRowNo: 1,
  customerName: '광주천사',
  productName: '카네이션',
  colorName: '카오리',
  prodKey: 417,
  quantity: 5,
  sourceUnit: '단',
}], {
  ...matchingContext,
  customers: [{ CustKey: 9001, CustName: '광주천사', CustArea: '' }],
  products: matchingProducts,
  farms: [],
});
assert.equal(defectSelected[0].prodKey, 417, '사용자가 선택한 DB 품목 ProdKey는 보존해야 한다.');
assert.equal(defectSelected[0].unit, pasteMatch.unit, '사용자가 선택한 DB 품목 단위를 적용해야 한다.');
assert.equal(defectSelected[0].matchedProductDbName, 'CARNATION Kaori', '선택 후에만 DB의 정확한 ProdName을 표시해야 한다.');

console.log('sales defect deduction tests passed');
