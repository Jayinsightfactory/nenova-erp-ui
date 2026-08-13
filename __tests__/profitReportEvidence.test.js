const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const { formulaFingerprint, parseFormulaAst } = await import('../lib/profitReportEvidence/formulaFingerprint.mjs');
  const { selectConfirmedStockSnapshot, resolveConfirmedShipmentRows, resolveInventoryValue, shipmentResolverContractDigest } = await import('../lib/profitReportEvidence/sourceResolvers.mjs');
  const { createProvenance } = await import('../lib/profitReportEvidence/provenance.mjs');
  const { historicalCategoryRule } = await import('../lib/profitReportEvidence/workbookEvidence.mjs');

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
