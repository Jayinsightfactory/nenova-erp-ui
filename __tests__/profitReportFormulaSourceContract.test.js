const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const readJson = (rel) => JSON.parse(read(rel));

async function main() {
  const contract = readJson('data/profit-report-evidence/formula-source-contract.v2.json');
  const evidence = await import('../lib/profitReportEvidence/workbookEvidence.mjs');
  const resolvers = await import('../lib/profitReportEvidence/sourceResolvers.mjs');

  assert.equal(contract.schemaVersion, 2);
  assert.equal(contract.sourceWorkbook.sha256, evidence.ANNOTATED_FORMULA_SPEC_SHA256);
  assert.equal(contract.sourceWorkbook.sheetCount, 11);
  assert.equal(contract.sheets.length, 11);
  assert.equal(contract.sheets.reduce((sum, sheet) => sum + sheet.formulaCount, 0), 1836);
  assert.deepEqual(contract.sheets.map((sheet) => sheet.name), [
    '주차별 매출이익 보고서', '재고잔량', '그외통관비', '구매현황', '포워딩',
    '판매현황', '불량차감', '그 외 매출액', '콜롬비아 1차', '콜롬비아 2차', '품목리스트',
  ]);

  const expectedColumns = Array.from({ length: 19 }, (_, index) => String.fromCharCode('C'.charCodeAt(0) + index));
  assert.deepEqual(contract.finalColumns.map((item) => item.column), expectedColumns);
  assert.ok(contract.finalColumns.every((item) => item.label && item.formula && item.workbookSources.length && item.resolver));
  assert.deepEqual(contract.forbiddenDirectFinalColumns, [
    'C', 'D', 'E', 'F', 'G', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'T', 'U',
  ]);
  assert.ok(!contract.directExternalInputs.some((item) => /^[C-U]$/.test(String(item.target || ''))));
  assert.equal(contract.directExternalInputs.find((item) => item.id === 'inventory.item-price-evidence')?.finalColumnOverride, false);

  assert.deepEqual(
    contract.sourceAnnotations.map(({ sheet, cell, text }) => ({ sheet, address: cell, text })),
    evidence.FORMULA_SOURCE_ANNOTATION_CELLS,
  );
  assert.equal(contract.sourceAnnotations.length, 17);

  const inventory = contract.inventoryValuation;
  assert.deepEqual(inventory.categoryAverage, [
    '콜롬비아 수국', '콜롬비아 카네이션', '콜롬비아 장미',
    '콜롬비아 루스커스', '콜롬비아 알스트로', '베트남',
  ]);
  assert.match(inventory.categoryAverageFormula, /Q\+S/);
  assert.match(inventory.categoryAverageFormula, /purchaseQty\*stockQty/);
  assert.ok(inventory.forbiddenFallbacks.includes('Product.Cost'));
  assert.ok(inventory.forbiddenFallbacks.includes('direct E/F override'));

  assert.equal(contract.weightVolumeAllocation.colombiaCustoms, '항상 boxQty*boxWeight 비율');
  assert.match(contract.weightVolumeAllocation.colombiaForwarding, /GW=CW/);
  assert.match(contract.weightVolumeAllocation.colombiaForwarding, /boxCBM/);

  const catalog = resolvers.SOURCE_RESOLVER_CATALOG;
  for (const key of [
    'shipmentConfirmedSales', 'estimateAmounts', 'warehousePurchases', 'taxableExchangeRate',
    'customsAndForwarding', 'confirmedProductStock', 'confirmedInventoryValue', 'confirmedArrivalCost', 'reportFormula',
  ]) assert.ok(catalog[key], `missing resolver catalog entry: ${key}`);

  const report = read('lib/profitReport.js');
  const api = read('pages/api/sales/profit-report.js');
  const calc = read('lib/profitReportCalc.js');
  const customs = read('lib/customsForwarding.js');
  assert.match(report, /export async function salesByCategory/);
  assert.match(report, /export async function estimateByCategory/);
  assert.match(report, /export async function purchaseByCategory/);
  assert.match(report, /export async function purchaseQtyByCategory/);
  assert.match(report, /export async function invoiceRatesByCategory/);
  assert.match(report, /export async function stockSnapshotByCategory/);
  assert.match(api, /computeCustomsAndForwarding\(major, orderYear\)/);
  assert.match(api, /computeCategoryAverageInventoryValue/);
  assert.match(calc, /const C = N \+ L \+ O/);
  assert.match(calc, /const P = Q \* n0\(R\)/);
  assert.match(calc, /const T = n0\(S\) \* n0\(R\)/);
  assert.match(calc, /n0\(E\) \+ G \+ n0\(H\) - n0\(F\)/);
  assert.match(customs, /export async function loadWarehouseGw/);
  assert.match(customs, /export async function colombiaBoxQtyByCategory/);
  assert.match(customs, /export function effectiveCountryWorldFreight/);

  const annotatedWorkbook = path.join(root, '.verify', 'inputs', 'formula-template-upload.xlsx');
  if (fs.existsSync(annotatedWorkbook)) {
    const inspected = evidence.inspectFormulaSpecification(annotatedWorkbook);
    assert.equal(inspected.specificationVersion, 2);
    assert.equal(inspected.specificationKind, 'formula-product-and-source-lineage');
    assert.equal(inspected.sourceAnnotationCount, 17);
    assert.ok(inspected.sourceAnnotations.every((item) => item.present));
    assert.equal(inspected.formulaDescriptions.F.text, '(매입액+그외통관비)/매입한 해당품목 총수량*재고수량');
    assert.equal(inspected.formulaDescriptions.R.text, '선율 청구서에서 환율');
  }

  console.log('profit report formula/source contract tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
