// 2026-08-11 결함수정: 27차 F(기말상품재고) 폭증 결함 회귀 검증.
//
// 운영 재현: 27차 Excel 원본 F 합계 = 13,229,405.2035원인데 운영 화면 F 합계 = 1,941,896,746원으로
// 폭증했다. 운영 27차 네덜란드 F = 1,858,041,803원, 태국 F = 70,582,040원이었고, 재고단가표에는
// 네덜란드 운송료(ProductStock 기말 964)·태국 운송료(910)·중국 운송료(946)·카네이션 운송료(946)·
// 장미 운송료(838)·루스커스 운송료(947)·수국 운송료(536)·현지상차운임(132) 같은 비재고 비용행이
// 일반 상품재고처럼 표시되고 있었다.
//
// 원인: CASE_CATEGORY(SQL)는 이 운송료/SERVICE FEE/현지상차운임 placeholder Product를 S 포워딩·
// H 통관 자동분류 원천으로 쓰기 위해 국가/화종으로 "분류"한다. 그런데 stockSnapshotByCategory /
// categoryUnitMismatch / stockPriceRows가 그 분류를 그대로 재고 집계에도 적용해 비용행의
// ProductStock 잔량을 상품재고인 것처럼 더했다.
//
// 수정: lib/profitReportClassification.js의 isNonInventoryCostItem()/isNonStockableItem() 순수
// 함수와 lib/profitReport.js의 nonInventoryCostItemSql()/stockablePurchaseItemSql() SQL 조건을
// 공용 정책으로 두고, 재고 평가(stockSnapshotByCategory)·단위혼재 검사(categoryUnitMismatch)·
// 재고단가표(stockPriceRows)·상품구매 집계(purchaseByCategory/purchaseQtyByCategory/
// invoiceRatesByCategory)가 모두 같은 조건을 공유하도록 정리했다. S 포워딩(forwardingByCategory)과
// H 통관 자동분류는 이 비용행을 그대로 배분 대상으로 써야 하므로 건드리지 않았다.
//
// 이 저장소에는 운영 DB 접속 정보가 없어(.env.local 없음) 실제 SQL이 운영 DB에서 만들어내는
// 숫자를 이 테스트가 직접 재현하지는 못한다(기존 __tests__/profitReportAustraliaUnitFallback.test.js와
// 같은 한계). 대신 (1) 비재고 비용행 판정이 실제 운영에서 확인된 품명·정상 상품행 모두에 대해
// 올바른지 순수 함수 수준에서 검증하고, (2) lib/profitReport.js 소스에서 재고·재고단가표·단위혼재·
// 상품구매 집계 5곳이 모두 공용 조건을 실제로 사용하는지, S/H 자동분류(forwardingByCategory)는
// 그대로인지 정적으로 대조하며, (3) 27차 정답 fixture(F 합계 13,229,405.2035원)가 그대로 보존되어
// 있는지 대조한다.
const fs = require('fs');
const path = require('path');

let failed = 0;
const check = (label, condition, detail = '') => {
  if (condition) console.log(`  ✓ ${label}`);
  else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
    failed += 1;
  }
};

async function main() {
  const {
    classifyCategory,
    isNonValueWeightItem,
    isNonInventoryCostItem,
    isNonStockableItem,
  } = await import('../lib/profitReportClassification.js');

  console.log('=== 운영에서 확인된 비재고 비용행 품명 — 재고/재고단가표/Q 상품구매에서 제외 대상 ===');
  const costItems = [
    '네덜란드 운송료',
    '태국 운송료',
    '중국 운송료',
    '카네이션 운송료',
    '장미 운송료',
    '루스커스 운송료',
    '수국 운송료',
    '현지상차운임',
    '현지상차 운임',
    'SERVICE FEE',
  ];
  for (const name of costItems) {
    check(`isNonInventoryCostItem('${name}') = true`, isNonInventoryCostItem(name) === true);
    check(`isNonStockableItem('${name}') = true`, isNonStockableItem(name) === true);
  }

  console.log('\n=== 무게 placeholder 행도 여전히 비재고 취급(기존 회귀 없음) ===');
  check("isNonStockableItem('Chargeable weight') = true", isNonStockableItem('Chargeable weight') === true);
  check("isNonStockableItem('Gross weigth') = true", isNonStockableItem('Gross weigth') === true);

  console.log('\n=== 실제 상품행은 비재고 비용행으로 오분류되면 안 됨 ===');
  const realProducts = [
    ['네덜란드', '', 'Eryngium'],
    ['네덜란드', '', 'Eryngium Blue Hunter'],
    ['호주', '', 'Banker Bush'],
    ['호주', '', 'Fern Sea Star'],
    ['콜롬비아', '수국', 'HYDRANGEA White'],
    ['콜롬비아', '카네이션', 'CARNATION Moon Light'],
    ['콜롬비아', '장미', 'ROSE Freedom'],
  ];
  for (const [coun, flower, product] of realProducts) {
    check(`isNonInventoryCostItem('${product}') = false`, isNonInventoryCostItem(product) === false);
    check(`isNonStockableItem('${product}') = false`, isNonStockableItem(product) === false);
    check(`isNonValueWeightItem('${product}') = false`, isNonValueWeightItem(product) === false);
    const category = classifyCategory(coun, flower, product);
    check(`classifyCategory 정상 상품 분류 유지: ${product} → ${category}`, category != null && category !== '기타(미분류)');
  }

  console.log('\n=== 비용행도 classifyCategory 자체는 그대로 국가/화종으로 분류(S 포워딩·H 통관 원천 유지) ===');
  const classificationCases = [
    ['네덜란드 운송료', '네덜란드'],
    ['태국 운송료', '태국'],
    ['중국 운송료', '중국'],
    ['카네이션 운송료', '콜롬비아 카네이션'],
    ['장미 운송료', '콜롬비아 장미'],
    ['루스커스 운송료', '콜롬비아 루스커스'],
    ['현지상차운임', '콜롬비아 수국'],
  ];
  for (const [product, expected] of classificationCases) {
    check(`classifyCategory('국내', '왁스', '${product}') = '${expected}' (분류는 유지, 재고 집계에서만 제외)`,
      classifyCategory('국내', '왁스', product) === expected);
  }

  console.log('\n=== lib/profitReport.js 소스 — 공용 SQL 조건 배선 확인 ===');
  const reportSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'profitReport.js'), 'utf8');

  check('nonInventoryCostItemSql 조건이 운송료/SERVICE FEE/현지상차운임/현지상차 운임을 모두 포함',
    /nonInventoryCostItemSql[\s\S]{0,400}운송료[\s\S]{0,200}SERVICE FEE[\s\S]{0,200}현지상차운임[\s\S]{0,200}현지상차 운임/.test(reportSource));
  check('stockablePurchaseItemSql이 nonValueWeightSql과 nonInventoryCostItemSql을 함께 사용',
    /stockablePurchaseItemSql[\s\S]{0,120}nonValueWeightSql[\s\S]{0,60}nonInventoryCostItemSql/.test(reportSource));

  const fnBody = (fnName) => {
    const idx = reportSource.indexOf(`export async function ${fnName}`);
    check(`${fnName} 함수 존재`, idx >= 0);
    if (idx < 0) return '';
    const nextExport = reportSource.indexOf('\nexport ', idx + 10);
    return reportSource.slice(idx, nextExport > 0 ? nextExport : idx + 4000);
  };

  const stockSnapshotBody = fnBody('stockSnapshotByCategory');
  check('stockSnapshotByCategory가 stockablePurchaseItemSql을 사용(비재고 비용행 제외)',
    /stockablePurchaseItemSql\('p'\)/.test(stockSnapshotBody));

  const categoryUnitMismatchBody = fnBody('categoryUnitMismatch');
  const stockUnitsPart = categoryUnitMismatchBody.split('purchUnits AS')[0];
  const purchUnitsPart = categoryUnitMismatchBody.split('purchUnits AS')[1] || '';
  check('categoryUnitMismatch stockUnits(ProductStock)가 stockablePurchaseItemSql을 사용',
    /stockablePurchaseItemSql\('p'\)/.test(stockUnitsPart));
  check('categoryUnitMismatch purchUnits(WarehouseDetail)가 stockablePurchaseItemSql을 사용',
    /stockablePurchaseItemSql\('p'\)/.test(purchUnitsPart));

  const stockPriceRowsBody = fnBody('stockPriceRows');
  check('stockPriceRows가 stockablePurchaseItemSql을 사용(재고단가표에 비용행 노출 금지)',
    /stockablePurchaseItemSql\('p'\)/.test(stockPriceRowsBody));

  const purchaseByCategoryBody = fnBody('purchaseByCategory');
  check('purchaseByCategory(Q)가 stockablePurchaseItemSql을 사용',
    /stockablePurchaseItemSql\('p'\)/.test(purchaseByCategoryBody));

  const purchaseQtyByCategoryBody = fnBody('purchaseQtyByCategory');
  check('purchaseQtyByCategory(F 분모)가 stockablePurchaseItemSql을 사용',
    /stockablePurchaseItemSql\('p'\)/.test(purchaseQtyByCategoryBody));

  const invoiceRatesByCategoryBody = fnBody('invoiceRatesByCategory');
  check('invoiceRatesByCategory(R)가 stockablePurchaseItemSql을 사용',
    /stockablePurchaseItemSql\('p'\)/.test(invoiceRatesByCategoryBody));

  console.log('\n=== S 포워딩·H 통관 자동분류 원천은 건드리지 않음(비용행을 그대로 배분 대상으로 유지) ===');
  const forwardingByCategoryBody = fnBody('forwardingByCategory');
  check('forwardingByCategory는 stockablePurchaseItemSql을 사용하지 않음(운송료 배분 대상 유지)',
    !/stockablePurchaseItemSql/.test(forwardingByCategoryBody));
  check('forwardingByCategory는 여전히 nonValueWeightSql만 사용(무게 행만 제외, 비용행은 유지)',
    /nonValueWeightSql\('p0'\)/.test(forwardingByCategoryBody));

  console.log('\n=== 27차 Excel 정답 fixture 보존 — F 합계 13,229,405.2035원 ===');
  const fixture = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'fixtures', 'profit-report-22-27.json'), 'utf8')
  );
  const week27 = fixture.weeks['27'];
  const fSum = week27.categories.reduce((sum, c) => sum + Number(c.cells?.F?.value || 0), 0);
  check('27차 Excel F 카테고리 합계 = 13,229,405.2035원 (fixture 변조 없음)',
    Math.abs(fSum - 13229405.2035) < 0.01, `실제=${fSum}`);

  const thaiF = week27.categories.find((c) => c.category === '태국')?.cells?.F?.value;
  const chinaF = week27.categories.find((c) => c.category === '중국')?.cells?.F?.value;
  check('27차 Excel 원본에는 태국 F 값 자체가 없음(null) — 운영 70,582,040원은 비용행 오염분',
    thaiF == null);
  check('27차 Excel 원본에는 중국 F 값 자체가 없음(null)', chinaF == null);

  const netherlandsF = week27.categories.find((c) => c.category === '네덜란드')?.cells?.F?.value;
  check('27차 Excel 네덜란드 F = 177,446.63원 (운영 1,858,041,803원과 자릿수 차원이 다름 — 비용행 오염 없는 정답값)',
    Math.abs(Number(netherlandsF) - 177446.63) < 0.01, `실제=${netherlandsF}`);

  console.log(`\n총 ${failed ? '실패' : '성공'} — 실패 ${failed}건`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
