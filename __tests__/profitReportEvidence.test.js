const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const { formulaFingerprint, parseFormulaAst } = await import('../lib/profitReportEvidence/formulaFingerprint.mjs');
  const { selectConfirmedStockSnapshot, resolveConfirmedShipmentRows, resolveInventoryValue, resolveExactArrivalPriceEvidence, shipmentResolverContractDigest } = await import('../lib/profitReportEvidence/sourceResolvers.mjs');
  const { createProvenance } = await import('../lib/profitReportEvidence/provenance.mjs');
  const { historicalCategoryRule, inspectFormulaSpecification, FORMULA_SPEC_SHA256 } = await import('../lib/profitReportEvidence/workbookEvidence.mjs');

  const formulaSpec = inspectFormulaSpecification(path.join(__dirname, '..', '.verify', 'inputs', 'profit-report-weeks-22-28', 'formula-template.xlsx'));
  assert.equal(formulaSpec.sha256, FORMULA_SPEC_SHA256);
  assert.equal(formulaSpec.formulaDescriptions.C.text, '순수매출액+불량금액+그외매출액');
  assert.equal(formulaSpec.formulaDescriptions.E.text, '전차수 기말재고');
  assert.equal(formulaSpec.formulaDescriptions.F.text, '(매입액+그외통관비)/매입한 해당품목 총수량*재고수량');
  assert.equal(formulaSpec.formulaDescriptions.I.text, '기초재고+매입액+그외통관비-기말재고');
  assert.equal(formulaSpec.formulaDescriptions.J.text, '매출액-매출원가');
  assert.equal(formulaSpec.formulaDescriptions.P.text, '구매금액*환율');
  assert.equal(formulaSpec.formulaDescriptions.T.text, '환율*포워딩비용');
  assert.equal(formulaSpec.products.find(item => item.prodName === 'CARNATION Kaori')?.prodKey, 417);
  assert.equal(formulaSpec.products.find(item => item.prodName === 'CARNATION Moon Light')?.prodKey, 447);
  assert.ok(formulaSpec.products.every(item => item.sourceRef && item.provenanceDigest));

  const formula = "(G10+H10)/SUMIF(구매현황!N:N,'주차별 매출이익 보고서'!B10,구매현황!D:D)*재고잔량!M72";
  const first = formulaFingerprint(formula, 'F10');
  const second = formulaFingerprint(formula, 'F10');
  assert.deepEqual(parseFormulaAst(formula), first.ast);
  assert.equal(first.exact, second.exact);
  assert.equal(first.shape, second.shape);
  assert.notEqual(first.exact, formulaFingerprint(formula.replace('M72', 'M73'), 'F10').exact);

  const selected = selectConfirmedStockSnapshot([
    { orderYear: 2025, orderWeek: '28-09', isFix: 1, productRowCount: 999, stockKey: 999 },
    { orderYear: 2026, orderWeek: '28-02', isFix: 1, productRowCount: 90, stockKey: 61 },
    { orderYear: 2026, orderWeek: '28-02', isFix: 1, productRowCount: 95, stockKey: 62 },
    { orderYear: 2026, orderWeek: '28-03', isFix: 0, productRowCount: 100, stockKey: 63 },
  ], { orderYear: 2026, majorWeek: 28 });
  assert.equal(selected.stockKey, 62);
  const shipmentRows = resolveConfirmedShipmentRows([
    { id: 'wrong-year', orderYear: 2025, orderWeek: '28-01', masterFix: 1, detailFix: 1, outQuantity: 1 },
    { id: 'unfixed-detail', orderYear: 2026, orderWeek: '28-01', masterFix: 1, detailFix: 0, outQuantity: 1 },
    { id: 'confirmed', orderYear: 2026, orderWeek: '28-01', masterFix: 1, detailFix: 1, outQuantity: 1 },
  ], { orderYear: 2026, majorWeek: 28 });
  assert.deepEqual(shipmentRows.map(row => row.id), ['confirmed']);

  const missingPrice = resolveInventoryValue({
    category: '네덜란드', stockSnapshot: { stockKey: 62, isFix: 1 },
    quantities: [{ prodKey: 1, quantity: 2 }], priceEvidence: [],
  });
  assert.equal(missingPrice.status, 'INPUT_REQUIRED');
  assert.equal(missingPrice.value, null);
  assert.deepEqual(missingPrice.missingProdKeys, [1]);
  const valued = resolveInventoryValue({
    category: '네덜란드', stockSnapshot: { stockKey: 62, isFix: 1 },
    quantities: [{ prodKey: 1, quantity: 2 }],
    priceEvidence: [{ prodKey: 1, unitPrice: 1500, verified: true, effectiveAt: '2026-07-10', sourceRef: 'invoice:1' }],
  });
  assert.equal(valued.status, 'PASS');
  assert.equal(valued.value, 3000);

  const arrivalBase = {
    arrivalLineKey: 11, importKey: 3, revisionNo: 2,
    orderYear: '2026', orderWeek: '28-02', prodKey: 447,
    isCurrent: 1, importIsDeleted: 0, matchStatus: 'MATCHED',
    confirmationAction: 'MATCH', selectedArrivalCostKRW: 11000, quantity: 2,
    sourceArrivalCostKRW: 10900, unit: '단', sourceFileName: '28-2 원가.xlsx',
    sheetName: '카네이션', sourceRow: 17, confirmedBy: 'tester', confirmedAt: '2026-07-15T01:00:00Z',
  };
  const arrival = resolveExactArrivalPriceEvidence([arrivalBase], { orderYear: 2026, orderWeek: '28-02', prodKey: 447, estimateUnit: '단' });
  assert.equal(arrival.status, 'PASS');
  assert.equal(arrival.value, 11000);
  assert.match(arrival.sourceRef, /import-3:rev-2/);
  const weightedArrival = resolveExactArrivalPriceEvidence([
    arrivalBase,
    { ...arrivalBase, arrivalLineKey: 12, sourceRow: 18, selectedArrivalCostKRW: 12000, quantity: 1 },
  ], { orderYear: 2026, orderWeek: '28-02', prodKey: 447, estimateUnit: '단' });
  assert.equal(weightedArrival.value, (11000 * 2 + 12000) / 3);
  assert.equal(weightedArrival.sourceRefs.length, 2);
  assert.equal(resolveExactArrivalPriceEvidence([{ ...arrivalBase, orderWeek: '28-2' }], { orderYear: 2026, orderWeek: '28-02', prodKey: 447, estimateUnit: '단' }).status, 'PASS');
  assert.equal(resolveExactArrivalPriceEvidence([{ ...arrivalBase, orderYear: '2025' }], { orderYear: 2026, orderWeek: '28-02', prodKey: 447, estimateUnit: '단' }).status, 'INPUT_REQUIRED');
  assert.equal(resolveExactArrivalPriceEvidence([{ ...arrivalBase, confirmationAction: 'UPLOAD' }], { orderYear: 2026, orderWeek: '28-02', prodKey: 447, estimateUnit: '단' }).status, 'INPUT_REQUIRED');
  assert.equal(resolveExactArrivalPriceEvidence([{ ...arrivalBase, unit: '박스' }], { orderYear: 2026, orderWeek: '28-02', prodKey: 447, estimateUnit: '단' }).status, 'INPUT_REQUIRED');
  assert.equal(resolveExactArrivalPriceEvidence([{ ...arrivalBase, sourceFileName: '' }], { orderYear: 2026, orderWeek: '28-02', prodKey: 447, estimateUnit: '단' }).status, 'INPUT_REQUIRED');

  const provenanceInput = { resolverId: 'test', resolverVersion: 1, sourceRefs: ['b', 'a'], inputPayload: { b: 2, a: 1 }, outputValue: 3 };
  assert.equal(createProvenance(provenanceInput).provenanceDigest, createProvenance(provenanceInput).provenanceDigest);
  assert.match(shipmentResolverContractDigest(), /^[a-f0-9]{64}$/);
  assert.equal(historicalCategoryRule(22).lastRowCategory, '공제');
  assert.equal(historicalCategoryRule(28).lastRowCategory, '국내');

  const manual = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'profit-report-evidence', 'manual-input-manifest.v1.json')));
  assert.equal(manual.fields.length, 7);
  assert.ok(!manual.fields.some(field => ['currency.taxable-rate', 'forwarding.invoice.freight', 'inventory.stock-adjustment-evidence'].includes(field.id)));
  assert.ok(manual.forbiddenDirectFields.includes('E'));
  assert.ok(manual.forbiddenDirectFields.includes('F'));
  assert.ok(!manual.fields.some(field => ['E', 'F'].includes(field.target)));

  const reportSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'profitReport.js'), 'utf8');
  const customsSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'customsForwarding.js'), 'utf8');
  assert.match(reportSource, /sm\.OrderYear=@yr[\s\S]{0,180}sm\.OrderWeek LIKE @pfx/);
  assert.match(reportSource, /ISNULL\(sd\.isFix,0\)=1/);
  assert.doesNotMatch(reportSource, /CREATE\s+TABLE/i);
  assert.doesNotMatch(customsSource, /CREATE\s+TABLE|ALTER\s+TABLE/i);
  console.log('profit report evidence contracts tests passed');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
