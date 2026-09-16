// __tests__/orderImportParse.test.js
// 실행: node __tests__/orderImportParse.test.js

const SAMPLE_ROWS = [
  ['', '', '', ''],
  ['7/8 입고 네노바', '', '', ''],
  ['', '품명', '단위', '수량'],
  [1, '수국 화이트', '대', 1843],
  [2, '수국 연핑크', '대', 215],
  [3, '장미 몬디알 화이트', '단', 133],
  [4, '페탈 장미 화이트', 'stem', 7],
];

async function main() {
  const { parseOrderImportSheetRows, normalizeVisionItems, parseRaumOrderQty, parseOrderImportMetadata, buildOrderImportSheetPreview } = await import('../lib/orderImportParse.js');
  const {
    normalizeImportUnit,
    inferImportUnitFromName,
    resolveImportUnit,
    learnUnitsFromRows,
    findImportUnit,
    loadImportUnits,
  } = await import('../lib/orderImportUnits.js');

  let passed = 0;
  let failed = 0;
  const assert = (cond, msg) => {
    if (cond) passed++;
    else { failed++; console.error('FAIL:', msg); }
  };

  const parsed = parseOrderImportSheetRows(SAMPLE_ROWS, { sourceName: 'test' });
  assert(parsed.rows.length === 4, `expected 4 rows, got ${parsed.rows.length}`);

  const DIRECT_HEADER = [
    ['No', '품명', '단위', '수량'],
    [1, '수국 화이트', '대', 100],
    [2, '장미 핑크', '단', 50],
  ];
  const direct = parseOrderImportSheetRows(DIRECT_HEADER, { sourceName: 'direct' });
  assert(direct.rows.length === 2, `direct header expected 2 rows, got ${direct.rows.length}`);

  const QTY_INFER = [
    ['품목명', '단위', ''],
    ['호접 화이트', '대', 120],
    ['카네이션 레드', '단', 30],
  ];
  const inferred = parseOrderImportSheetRows(QTY_INFER, { sourceName: 'infer' });
  assert(inferred.rows.length === 2, `qty infer expected 2 rows, got ${inferred.rows.length}`);

  const RAUM_ROWS = [
    ['라움 27차(7월7일(화) 출고)', '', '', '', ''],
    ['품 명', '칼 라', '요청수량', '발주수량', '예상잔량'],
    ['수국', '화이트', '1988대', '67박스(2010대)', '85대'],
    ['', '연핑크', '215대', '8박스(240대)', '25대'],
    ['장미', '몬디알 화이트', '159단', '16박스(160단)', '6단'],
    ['', '코랄리프', '10단', '', '10단'],
    ['', '마루치', '5단', '', '5단'],
  ];
  const raum = parseOrderImportSheetRows(RAUM_ROWS, { sourceName: 'raum' });
  assert(raum.rows.length === 3, `raum expected 3 rows (empty 발주수량 skip), got ${raum.rows.length}`);
  assert(raum.rows[0].inputName === '화이트', `raum display name: ${raum.rows[0]?.inputName}`);
  assert(raum.rows[0].matchName === '수국 화이트', `raum match context: ${raum.rows[0]?.matchName}`);
  assert(raum.rows[0].qty === 67, `raum qty from 발주수량: ${raum.rows[0]?.qty}`);
  assert(raum.rows[0].unit === '박스', `raum unit: ${raum.rows[0]?.unit}`);
  assert(raum.rows[2].inputName === '몬디알 화이트', `raum rose display: ${raum.rows[2]?.inputName}`);
  assert(raum.rows[2].matchName === '장미 몬디알 화이트', `raum rose match context: ${raum.rows[2]?.matchName}`);
  assert(raum.rows[2].qty === 16, `raum rose qty: ${raum.rows[2]?.qty}`);

  const COLOR_AND_GROUP_UNIT = [
    ['품 명', '컬러', '주문수량', '출고수량', '단가', '비 고'],
    ['콜롬비아 카네이션', 'Novia', 3, '', 11500, '9/17 출고'],
    ['', 'Doncel', 2, '', 11500, ''],
    ['', '합계(박스)', 5, '', '', ''],
    ['콜롬비아 장미 *50cm', 'Proud', 10, '', 12700, ''],
    ['', '합계(단)', 10, '', '', ''],
    ['중국 장미 *50cm', 'Proud', 20, '', 9000, ''],
    ['', '합계(단)', 20, '', '', ''],
  ];
  const colorParsed = parseOrderImportSheetRows(COLOR_AND_GROUP_UNIT, { sourceName: '컬러 fixture' });
  assert(colorParsed.rows.length === 4, `컬러 헤더와 국가별 동명 품목 expected 4, got ${colorParsed.rows.length}`);
  assert(colorParsed.rows[0].unit === '박스' && colorParsed.rows[1].unit === '박스', '합계(박스)는 앞 그룹 단위로 적용');
  assert(colorParsed.rows[2].unit === '단' && colorParsed.rows[3].unit === '단', '합계(단)는 앞 그룹 단위로 적용');
  assert(colorParsed.rows[2].matchName !== colorParsed.rows[3].matchName, '콜롬비아/중국 동명 품목은 별도 매칭 문맥');
  assert(colorParsed.rows[0].note === '9/17 출고', '비고는 단가 옆 열 추정이 아니라 실제 비고 열 사용');

  const fileMeta = parseOrderImportMetadata([['']], { sourceName: '37차 원협가빈 출고 내역서.xlsx' });
  assert(fileMeta.majorWeek === '37' && fileMeta.customerName === '원협가빈', '파일명으로 차수·업체 보완');
  const preview = buildOrderImportSheetPreview(COLOR_AND_GROUP_UNIT, { sheetName: 'Sheet1', sourceRange: 'A1:F8', header: colorParsed.header });
  assert(preview.rows[0].rowNo === 1 && Array.isArray(preview.rows[0].cells), '시트 미리보기 행 번호와 셀');
  assert(preview.headerRow === 1 && preview.rowCount === 8 && preview.columnCount === 6, '시트 미리보기 범위 정보');

  const SPECIAL_GROUP = [
    ['품명', '컬러', '발주수량', '출고수량', '단가', '비고'],
    ['제주 특별 주문건', '프리덤', 10, '', 11000, ''],
    ['', '만달라', 20, '', 11400, ''],
    ['', '합계(박스)', 30, '', '', ''],
    ['총 박스 수량', '', '', 30, '', ''],
    ['주말도착건', '태국 덴파레 화이트L', 10, '', 9500, ''],
    ['', '태국 덴파레 피치L', 10, '', 10500, ''],
    ['', '합계(단)', 20, '', '', ''],
  ];
  const specialParsed = parseOrderImportSheetRows(SPECIAL_GROUP, { sourceName: '특별 주문 fixture' });
  assert(specialParsed.rows.length === 4, `특별/주말 주문의 이어진 빈 품명 행도 포함: ${specialParsed.rows.length}`);
  assert(specialParsed.rows.every(row => ['박스', '단'].includes(row.unit)), '특별/주말 그룹 단위 합계 적용');

  assert(parseRaumOrderQty('67박스(2010대)').qty === 67, 'parse box qty');
  assert(parseRaumOrderQty('16박스(160단)').unit === '박스', 'parse box unit');
  assert(parseRaumOrderQty('5대').qty === 5 && parseRaumOrderQty('5대').unit === '송이', '5대 -> 5송이');
  assert(parseRaumOrderQty('5st').qty === 5 && parseRaumOrderQty('5st').unit === '송이', '5st -> 5송이');

  assert(normalizeImportUnit('대') === '송이', '대 -> 송이');
  assert(normalizeImportUnit('st') === '송이', 'st -> 송이');
  assert(normalizeImportUnit('stem') === '송이', 'stem -> 송이');
  assert(normalizeImportUnit('단') === '단', '단 -> 단');

  assert(inferImportUnitFromName('수국 화이트') === '박스', 'infer hydrangea');
  assert(inferImportUnitFromName('장미 몬디알') === '단', 'infer rose');
  assert(inferImportUnitFromName('페탈 장미 화이트') === '송이', 'infer petal rose');

  const imageRow = { inputName: '장미 몬디야l 화이트', unit: '', qty: 26 };
  learnUnitsFromRows(parsed.rows, { source: 'test' });
  const catalog = loadImportUnits(true);
  const fromCatalog = findImportUnit('장미 몬디알 화이트', catalog);
  assert(fromCatalog?.unit === '단', 'catalog rose unit');

  const resolved = resolveImportUnit(null, '수국 화이트', { sourceUnit: '', unitCatalog: catalog });
  assert(resolved.unit === '송이' && resolved.unitSource === 'catalog', 'image uses excel-learned unit');

  const resolvedExplicit = resolveImportUnit(null, '수국 화이트', { sourceUnit: '대' });
  assert(resolvedExplicit.unit === '송이' && resolvedExplicit.unitSource === 'upload', 'excel explicit 대 is 송이');

  const vision = normalizeVisionItems([{ inputName: '호접 화이트', qty: 15 }]);
  assert(vision.rows.length === 1 && vision.rows[0].unit === '', 'image no unit');

  const resolvedImage = resolveImportUnit(null, '호접 화이트', { sourceUnit: '', unitCatalog: catalog });
  assert(resolvedImage.unit === '박스', '호접 from catalog or infer');

  console.log(`orderImportParse.test: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
