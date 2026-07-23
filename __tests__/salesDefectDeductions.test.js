import assert from 'node:assert/strict';
import fs from 'node:fs';
import ExcelJS from 'exceljs';
import { scoreMatch } from '../lib/displayName.js';
import {
  deductionManagerIdentity,
  normalizeParentWeek,
  previousParentScope,
  normalizeDeductionRow,
  managerFilterForUser,
  partitionRegistrationPreflight,
  mergeSavedDeductionRows,
  partitionSelectedDeductionRows,
  lookupSelectionDelta,
  shiftParentWeek,
} from '../lib/salesDefectDeductionCore.js';
import { getStatementProductName } from '../lib/estimatePrintFormats.js';
import {
  parseQuantityCell,
  parseSalesDefectWorkbook,
  buildSalesDefectWorkbook,
  formatSalesDefectExportRows,
  customerExportName,
} from '../lib/salesDefectDeductionExcel.js';
import { matchImportRows, buildProductMappingStats, buildProductSuggestions } from '../lib/orderImportMatch.js';
import { resolveImportCustomer } from '../lib/orderImportCustomerMatch.js';
import { matchSalesDefectRows } from '../lib/salesDefectDeductions.js';

assert.equal(normalizeParentWeek('29-02'), 29);
assert.equal(normalizeParentWeek('29'), 29);
assert.deepEqual(previousParentScope(2026, 29), { year: 2026, week: 28 });
assert.deepEqual(previousParentScope(2026, 1), { year: 2025, week: 52 });
assert.deepEqual(shiftParentWeek(2026, 29, -1), { year: 2026, week: 28 });
assert.deepEqual(shiftParentWeek(2026, 29, 1), { year: 2026, week: 30 });
assert.deepEqual(shiftParentWeek(2026, 1, -1), { year: 2025, week: 52 });
assert.deepEqual(shiftParentWeek(2026, 52, 1), { year: 2027, week: 1 });
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
assert.equal(managerFilterForUser('nenovaSD3', { userId: 'nenovaSD3', userName: '조현욱' }), '조현욱');
assert.equal(managerFilterForUser('조현욱', { userId: 'nenovaSD3', userName: '조현욱' }), '조현욱');
assert.equal(managerFilterForUser('', { userId: 'nenovaSD3', userName: '조현욱' }), '');
assert.deepEqual(
  partitionRegistrationPreflight([
    { deductionKey: 1, error: '' },
    { deductionKey: 2, error: '출고 없음' },
  ]),
  { valid: [{ deductionKey: 1, error: '' }], invalid: [{ deductionKey: 2, error: '출고 없음' }] },
);
const deductionSource = fs.readFileSync('lib/salesDefectDeductions.js', 'utf8');
const pageSource = fs.readFileSync('pages/sales/defect-deductions.js', 'utf8');
assert.ok(pageSource.includes('useState(false)'), '수정 이력은 기본적으로 닫혀 있어야 한다.');
assert.ok(pageSource.includes('defect-inline-lookup'), '검색 결과는 입력 행 위의 인라인 패널로 표시되어야 한다.');
assert.ok(pageSource.includes('shiftParentWeek'), '차수 앞뒤 이동은 공통 경계 규칙을 사용해야 한다.');
assert.ok(pageSource.includes('handleQuantityKeyDown'), '차감수량 키보드 입력은 빈 행 추가 흐름을 사용해야 한다.');
assert.ok(pageSource.includes('handleUnitGroupKeyDown'), '수량 다음에는 단/박스/스팀 키보드 선택 그룹으로 이동해야 한다.');
assert.ok(pageSource.includes('data-defect-action={`unit-group-${index}`}'), '단위 선택 그룹은 행별 포커스 대상이어야 한다.');
assert.ok(pageSource.includes('data-defect-action="empty-row-add"'), '차감수량 다음 Tab 대상인 빈 행 추가 버튼이 있어야 한다.');
assert.ok(pageSource.includes('handleAddModeKeyDown'), '빈 행 추가 후 세 가지 입력 방식을 방향키·Enter 키보드로 선택해야 한다.');
assert.ok(pageSource.includes('add-mode-${index}-new-customer'), '빈 행 추가 방식에 신규업체 추가가 포함되어야 한다.');
assert.ok(pageSource.includes('handleRelatedAddKeyDown'), '동일업체 추가 선택은 방향키·Enter 키보드를 지원해야 한다.');
assert.ok(pageSource.includes('const closeLookup'), '다음 입력칸으로 이동할 때 검색 결과를 닫는 공통 함수가 있어야 한다.');
assert.ok(pageSource.includes('수입부 확인'), '수입부 전체 확인 탭이 있어야 한다.');
assert.ok(pageSource.includes("view: 'incoming'"), '수입부 탭은 담당자 필터 없이 차수 전체를 조회해야 한다.');
assert.ok(pageSource.includes("action: 'incoming-confirm'"), '수입부 확정은 전용 저장 액션을 사용해야 한다.');
assert.ok(pageSource.includes('confirmIncomingRow'), '수입부 행별 확정 버튼이 있어야 한다.');
assert.ok(pageSource.includes('보완 필요'), '수입부 보완 필요 체크가 있어야 한다.');
assert.ok(pageSource.includes('incoming-note-input'), '수입부 행별 비고 입력이 있어야 한다.');
assert.ok(pageSource.includes('reviewRequiredCount'), '영업담당자 화면에 수입부 보완 필요 건수를 표시해야 한다.');
assert.ok(pageSource.includes('resolveReview'), '영업담당자 화면에 보완 해결 완료 동작이 있어야 한다.');
assert.ok(pageSource.includes('해결 완료'), '보완 필요 행에 해결 완료 버튼이 있어야 한다.');
assert.ok(pageSource.includes('sales-row-review-alert'), '보완 필요 행은 담당자 화면에 빨간 알림으로 표시해야 한다.');
assert.ok(pageSource.includes('onFocusCapture={handleGridFocusCapture}'), '다른 입력칸으로 포커스가 이동하면 이전 검색 패널을 닫아야 한다.');
assert.ok(pageSource.includes("if (event.key === 'Tab') {\n      closeLookup();"), '검색 입력에서 Tab으로 빠져나갈 때 검색 패널을 닫아야 한다.');
assert.ok(pageSource.includes('position: fixed'), '검색 결과는 표의 가로 스크롤에 갇히지 않는 고정 팝업이어야 한다.');
assert.ok(pageSource.includes(':global(.defect-inline-lookup)'), 'body 포털로 이동한 검색 팝업에도 위치·스크롤 스타일이 적용되어야 한다.');
assert.ok(pageSource.includes('createPortal(panel, document.body'), '검색 팝업은 표의 stacking context에 가려지지 않도록 body 포털로 표시해야 한다.');
assert.ok(pageSource.includes('lookupPanelRef.current?.getBoundingClientRect().height'), '검색 결과는 실제 팝업 높이를 측정해 화면 안에 배치해야 한다.');
assert.ok(pageSource.includes('const showAbove = availableAbove >= panelHeight || availableBelow < panelHeight;'), '검색 결과는 현재 행 아래 공간이 남아도 위쪽 배치를 우선해야 한다.');
assert.ok(pageSource.includes('rect.top - panelHeight - 8'), '검색 결과는 입력창 위쪽에 실제 높이만큼 띄워 배치해야 한다.');
assert.ok(pageSource.includes('focusUnitGroup(index)'), '수량 Enter/Tab은 단위 선택 그룹을 먼저 포커스해야 한다.');
assert.ok(pageSource.includes('related-row-action:focus'), '동일업체 추가 선택 버튼은 키보드 포커스 하이라이트가 있어야 한다.');
assert.ok(pageSource.includes('display: flex; align-items: flex-start;'), '품목 검색 결과는 국가·품종·품명을 일정한 열로 정렬해야 한다.');
assert.equal(pageSource.includes('defect-lookup-usage'), false, '품목 검색 결과에는 사용 횟수·매칭 건수를 표시하지 않아야 한다.');
assert.ok(pageSource.includes('overflow-x: hidden'), '품목 검색 결과는 가로 드래그 없이 세로 스크롤만 사용해야 한다.');
assert.ok(pageSource.includes('defect-product-match'), '전산 매칭 전체 품명 표시 영역이 있어야 한다.');
assert.ok(pageSource.includes('white-space: normal; overflow: visible; text-overflow: clip;'), '전산 매칭 품명은 말줄임 없이 전체가 보여야 한다.');
assert.ok(pageSource.includes('partitionRegistrationPreflight'), '견적서 등록은 유효행과 오류행을 분리해 처리해야 한다.');
assert.ok(deductionSource.includes('sm.OrderYear < @scopeYear'), '이전 차수 단가가 없으면 과거 연도까지 최신 유효 단가를 찾아야 한다.');
assert.ok(deductionSource.includes('COALESCE(NULLIF(sdd.Cost,0), NULLIF(sd.Cost,0), 0) > 0'), '0원 단가는 대체 단가 후보에서 제외해야 한다.');
assert.ok(deductionSource.includes('confirmIncomingDeductions'), '수입부 확인 전용 저장 경로가 있어야 한다.');
assert.ok(deductionSource.includes('ImportConfirmedAt=GETDATE()'), '수입부 확정 시 감사 시각을 저장해야 한다.');
assert.ok(deductionSource.includes('ImportReviewRequired=@reviewRequired'), '수입부 보완 필요 체크를 저장해야 한다.');
assert.ok(deductionSource.includes('Note=@note'), '수입부 비고를 확정 시 저장해야 한다.');
assert.ok(deductionSource.includes('resolveIncomingReview'), '수입부 보완 필요 해제 전용 저장 경로가 있어야 한다.');
assert.ok(deductionSource.includes('ImportReviewRequired=0'), '해결 완료 시 보완 필요 상태를 해제해야 한다.');
assert.ok(deductionSource.includes("action: 'INCOMING_REVIEW_RESOLVE'"), '보완 해결 완료 이력을 기록해야 한다.');
assert.ok(deductionSource.includes('ImportConfirmed=CASE WHEN @importReset=1 THEN 0'), '영업부가 수입부 확정 후 농장/크레딧/비고를 바꾸면 재확인이 필요해야 한다.');
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
assert.equal(wb.worksheets[0].getColumn('F').width, 37.5, '엑셀 품명 열은 원본 대비 2.5배 폭이어야 한다.');
assert.equal(wb.worksheets[0].getCell('B6').alignment.horizontal, 'center');
assert.ok(!wb.worksheets[0].getCell('B6').alignment.indent || wb.worksheets[0].getCell('B6').alignment.indent === 0);
assert.equal(wb.worksheets[0].getRow(6).height >= 25, true);

const formattedExport = formatSalesDefectExportRows([
  { customerName: '그린화원(전산)', customerAlias: '그린화원/화요일', productName: '카네이션', countryName: '콜롬비아', colorName: '문라이트', quantity: 1 },
  { customerName: '그린화원(전산)', customerAlias: '그린화원/화요일', productName: '카네이션', countryName: '콜롬비아', colorName: '노비아', quantity: 2 },
  { customerName: '그린화원(전산)', customerAlias: '그린화원/화요일', productName: '장미', countryName: '콜롬비아', colorName: '화이트', quantity: 3 },
  { customerName: '그린화원(전산)', customerAlias: '그린화원/화요일', productName: '장미', countryName: '중국', colorName: '프라우드', quantity: 1 },
  { customerName: '다른화원', productName: '카네이션', countryName: '네덜란드', colorName: '화이트', quantity: 4 },
]);
assert.equal(customerExportName({ customerName: '그린화원(전산)', customerAlias: '그린화원/화요일' }), '그린화원');
assert.deepEqual(formattedExport.map((row) => row.blank ? 'blank' : [row.customerName, row.productName]), [
  ['그린화원', '콜롬비아 카네이션'],
  ['', ''],
  ['', '콜롬비아 장미'],
  ['', '중국 장미'],
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
const countryRankedProducts = [
  { ProdKey: 701, ProdName: 'CARNATION Moon Light', DisplayName: null, FlowerName: '카네이션', CounName: '콜롬비아' },
  { ProdKey: 702, ProdName: 'Carnation CHINA / 문라이트 (Moonlight)', DisplayName: null, FlowerName: '카네이션', CounName: '중국' },
];
const countryRanked = buildProductSuggestions('문라이트', countryRankedProducts, {
  usageByProdKey: new Map([[701, { usageCount: 2298 }], [702, { usageCount: 2 }]]),
  mappingByProdKey: buildProductMappingStats({ '콜롬비아 카네이션 문라이트': { prodKey: 701 } }),
  limit: 2,
  minScore: 20,
});
assert.equal(countryRanked[0].prodKey, 701, '한글 별칭 검색은 실제 빈출 콜롬비아 카네이션을 먼저 보여야 한다.');
const candlelightCandidate = buildProductSuggestions('문라이트', [
  { ProdKey: 801, ProdName: 'CARNATION Moon Light', DisplayName: null, FlowerName: '카네이션', CounName: '콜롬비아' },
  { ProdKey: 802, ProdName: 'ROSE / Candlelight 50cm', DisplayName: null, FlowerName: '장미', CounName: '콜롬비아' },
], { limit: 5, minScore: 20 });
assert.equal(candlelightCandidate[0].prodKey, 801, '문라이트 검색은 Candlelight를 Moon Light 후보보다 앞세우거나 자동 선택하면 안 된다.');
assert.equal(candlelightCandidate.some((item) => item.prodKey === 802), false, '구분 별칭이 없는 Candlelight는 문라이트 후보에서 제외해야 한다.');
const explicitChina = buildProductSuggestions('중국 문라이트', countryRankedProducts, {
  usageByProdKey: new Map([[701, { usageCount: 2298 }], [702, { usageCount: 2 }]]),
  limit: 2,
  minScore: 20,
});
assert.equal(explicitChina[0].prodKey, 702, '중국을 명시하면 콜롬비아 사용량이 중국 후보를 앞지르면 안 된다.');
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
assert.equal(defectSelected[0].countryName, '콜롬비아', '선택된 Product.CounName을 국가 표시값으로 보존해야 한다.');

console.log('sales defect deduction tests passed');
