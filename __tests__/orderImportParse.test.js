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
  const { parseOrderImportSheetRows, normalizeVisionItems, parseRaumOrderQty } = await import('../lib/orderImportParse.js');
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
  assert(raum.rows[0].inputName === '수국 화이트', `raum name: ${raum.rows[0]?.inputName}`);
  assert(raum.rows[0].qty === 67, `raum qty from 발주수량: ${raum.rows[0]?.qty}`);
  assert(raum.rows[0].unit === '박스', `raum unit: ${raum.rows[0]?.unit}`);
  assert(raum.rows[2].inputName === '장미 몬디알 화이트', `raum rose: ${raum.rows[2]?.inputName}`);
  assert(raum.rows[2].qty === 16, `raum rose qty: ${raum.rows[2]?.qty}`);

  assert(parseRaumOrderQty('67박스(2010대)').qty === 67, 'parse box qty');
  assert(parseRaumOrderQty('16박스(160단)').unit === '박스', 'parse box unit');

  assert(normalizeImportUnit('대') === '박스', '대 -> 박스');
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
  assert(resolved.unit === '박스' && resolved.unitSource === 'catalog', 'image uses excel-learned unit');

  const resolvedExplicit = resolveImportUnit(null, '수국 화이트', { sourceUnit: '대' });
  assert(resolvedExplicit.unit === '박스' && resolvedExplicit.unitSource === 'upload', 'excel explicit unit');

  const vision = normalizeVisionItems([{ inputName: '호접 화이트', qty: 15 }]);
  assert(vision.rows.length === 1 && vision.rows[0].unit === '', 'image no unit');

  const resolvedImage = resolveImportUnit(null, '호접 화이트', { sourceUnit: '', unitCatalog: catalog });
  assert(resolvedImage.unit === '박스', '호접 from catalog or infer');

  console.log(`orderImportParse.test: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
