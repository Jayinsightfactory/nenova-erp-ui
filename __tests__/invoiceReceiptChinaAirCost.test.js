import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { INVOICE_COST_FORMULAS, previewInvoiceCost, restoredInvoiceCostInput } from '../lib/invoiceReceiptCost.js';
import { acquireInvoiceCostWorkflowLock } from '../lib/invoiceReceiptCostWorkflow.js';
import { validateInvoiceCostReadback } from '../lib/invoiceReceiptCostWorkflow.js';
import { adaptPackingReceipts, normalizeReceiptDocument, toReceiptDraftPayload } from '../lib/importPackingReceiptAdapter.js';

const ids = ['44444444-4444-8444-8444-444444444444', '55555555-5555-8555-8555-555555555555', '66666666-6666-8666-8666-666666666666'];
const formula = INVOICE_COST_FORMULAS.CN_AIR_WEIGHT_CBM_V1;
function fixture() {
  return {
    document: { documentId: '11111111-1111-8111-8111-111111111111', revision: 2,
      reviewedMetadata: { country: 'CN', transportMode: 'AIR', inputDate: '2026-10-12', gw: 100, cw: 100 },
      costInput: { ...formula, formulaApplicabilityConfirmed: true, formulaEffectiveDate: '2026-10-12',
        nativeCurrency: 'CNY', freightCurrency: 'CNY', exchangeRateKRW: 200, exchangeRateType: 'PURCHASE', exchangeRateDate: '2026-10-12',
        freightAmount: 40, customsTotalKRW: 1000, costSourceId: 'current-cn-air-bill', allocationScope: 'SINGLE_INVOICE',
        allocationShareNumerator: 1, allocationShareDenominator: 1,
        lineInputs: ids.slice(0, 2).map((lineId, i) => ({ lineId, grossWeightKg: [25, 75][i], volumeWeightKg: [90, 110][i], tariffRate: 0.1, otherCostPerUnitKRW: 2 })) } },
    lines: ids.slice(0, 2).map((lineId, i) => ({ lineId, prodKey: i + 1, outQuantity: [10, 30][i], outUnit: 'BUNCH',
      unitPrice: 10, lineAmount: [100, 300][i], currency: 'CNY' })),
  };
}
const preview = f => previewInvoiceCost(f.document, f.lines);
function blocked(f, code) {
  const result = preview(f);
  assert.equal(result.status, 'REVIEW_REQUIRED');
  assert.equal(result.lines.length, 0);
  assert.equal(result.totals, null);
  assert.ok(result.issues.some(item => item.code === code), JSON.stringify(result.issues));
}

test('adapter → draft payload → document roundtrip uses canonical gw/cw in both AIR branches', async () => {
  for (const cw of [100, 200]) {
    const [adapted] = await adaptPackingReceipts({
      sourceHash: 'a'.repeat(64), fileName: '2026-41-02.xlsx', country: 'CN', reviewConfirmed: true,
      invoices: [{ invoice: 'CN-AIR-CURRENT', source_format: 'china_invoice_xlsx', currency: 'CNY', gross_weight: 100, chargeable_weight: cw,
        products: [{ description: 'CN RAW', pcs: 1, total_bunch: 10, total_stems: 100, u_price: 10, t_price: 100, gross_weight: 100 }] }],
      excels: [{ products: [{ sourceName: 'CN RAW', matchingDescription: 'CN RAW', matchedName: 'CN ERP' }] }],
      products: [{ ProdKey: 10, ProdName: 'CN ERP', country: 'CN', selectable: true }],
    });
    assert.equal(adapted.reviewedMetadata.gw, 100);
    assert.equal(adapted.reviewedMetadata.cw, cw);
    assert.equal(Object.hasOwn(adapted.reviewedMetadata, 'grossWeight'), false);
    assert.equal(Object.hasOwn(adapted.reviewedMetadata, 'chargeableWeight'), false);
    adapted.reviewedMetadata.transportMode = 'AIR';
    adapted.reviewedMetadata.inputDate = '2026-10-12';
    adapted.reviewedMetadata.invoiceCostInput = { ...fixture().document.costInput,
      lineInputs: [{ lineId: adapted.lines[0].lineId, grossWeightKg: 100, volumeWeightKg: cw, tariffRate: 0.1, otherCostPerUnitKRW: 2 }] };
    const document = normalizeReceiptDocument(JSON.parse(JSON.stringify(toReceiptDraftPayload(adapted))));
    const receiptLines = document.lines.map(line => ({ ...line, outQuantity: line.bunchQuantity, outUnit: 'BUNCH' }));
    const result = previewInvoiceCost(document, receiptLines);
    assert.equal(result.status, 'APPROVED', JSON.stringify(result.issues));
    assert.equal(result.lines[0].freightAllocationBasis, cw === 100 ? 'GROSS_WEIGHT_KG' : 'VOLUME_WEIGHT_KG');
    assert.equal(result.lines[0].componentAmounts.freightNative, 40);
    assert.equal(result.lines[0].componentAmounts.customsKRW, 1000);
  }
});

test('legacy metadata aliases never replace missing canonical gw/cw or override canonical values', () => {
  for (const [key, alias, code] of [['gw', 'grossWeight', 'GROSS_WEIGHT_REQUIRED'], ['cw', 'chargeableWeight', 'CHARGEABLE_WEIGHT_REQUIRED']]) {
    const f = fixture(); delete f.document.reviewedMetadata[key]; f.document.reviewedMetadata[alias] = 100;
    blocked(f, code);
  }
  const f = fixture();
  f.document.reviewedMetadata.grossWeight = 999;
  f.document.reviewedMetadata.chargeableWeight = 1;
  assert.equal(preview(f).status, 'APPROVED');
});

test('CN AIR registry is versioned and limited to the audited late CLOUD sheets', () => {
  assert.equal(formula.formulaVersion, '1.0.0');
  assert.equal(formula.formulaSourceSheet, '27-2 CLOUD / 26-2 CLOUD');
  assert.equal(formula.formulaSourceCells, 'K7:U13,AD8:AD14,AI8:AI14,J24:O33');
});

test('equal GW/CW uses GW for freight and customs with explicit per-unit other costs', () => {
  const f = fixture();
  const result = preview(f);
  assert.equal(result.status, 'APPROVED');
  assert.equal(result.lines[0].freightAllocationBasis, 'GROSS_WEIGHT_KG');
  assert.deepEqual(result.lines[0].componentAmounts, { goodsNative: 100, freightNative: 10, goodsKRW: 20000,
    freightKRW: 2000, tariffKRW: 2200, customsKRW: 250, otherKRW: 20 });
  assert.equal(result.lines[0].costPerUnitKRW, 2447);
  assert.equal(result.expected95, null);
  assert.ok(Object.values(result.totals.componentAmounts).every(Number.isFinite));
});

test('CW > GW uses CBM kg for freight, GW independently for customs, and the effective freight share', () => {
  const f = fixture();
  f.document.reviewedMetadata.cw = 200;
  f.document.costInput.allocationShareNumerator = 1;
  f.document.costInput.allocationShareDenominator = 2;
  const result = preview(f);
  assert.equal(result.status, 'APPROVED');
  assert.equal(result.lines[0].freightAllocationBasis, 'VOLUME_WEIGHT_KG');
  assert.equal(result.lines[0].componentAmounts.freightNative, 9);
  assert.equal(result.lines[1].componentAmounts.freightNative, 11);
  assert.equal(result.lines[0].componentAmounts.customsKRW, 250);
  assert.equal(result.lines[1].componentAmounts.customsKRW, 750);
});

test('0.01kg tolerance selects GW and unused CBM inputs do not block the GW branch', () => {
  const f = fixture();
  f.document.reviewedMetadata.cw = 100.005;
  f.document.costInput.lineInputs[0].volumeWeightKg = -1;
  delete f.document.costInput.lineInputs[1].volumeWeightKg;
  assert.equal(preview(f).status, 'APPROVED');
});

test('CN AIR rejects wrong country, transport, or currencies', () => {
  for (const [key, value, code] of [['country', 'NL', 'FORMULA_COUNTRY_MISMATCH'], ['transportMode', 'SEA', 'FORMULA_TRANSPORT_MISMATCH']]) {
    const f = fixture(); f.document.reviewedMetadata[key] = value; blocked(f, code);
  }
  const f = fixture(); f.document.costInput.nativeCurrency = 'EUR'; f.document.costInput.freightCurrency = 'EUR';
  f.lines.forEach(line => { line.currency = 'EUR'; }); blocked(f, 'FORMULA_CURRENCY_MISMATCH');
});

test('blank current weights, FX, customs, applicability, and line GW never default', () => {
  for (const [key, code] of [['gw', 'GROSS_WEIGHT_REQUIRED'], ['cw', 'CHARGEABLE_WEIGHT_REQUIRED']]) {
    const f = fixture(); f.document.reviewedMetadata[key] = ''; blocked(f, code);
  }
  for (const [key, code] of [['exchangeRateKRW', 'EXCHANGE_RATE_REQUIRED'], ['customsTotalKRW', 'CUSTOMS_TOTAL_REQUIRED'],
    ['freightAmount', 'FREIGHT_AMOUNT_REQUIRED']]) {
    const f = fixture(); f.document.costInput[key] = ''; f.document.costInput.expected95Quantity = 95; blocked(f, code);
  }
  const f = fixture(); f.document.costInput.formulaApplicabilityConfirmed = false; blocked(f, 'FORMULA_APPLICABILITY_CONFIRMATION_REQUIRED');
  for (const value of ['', ' ', null, -1]) {
    const g = fixture(); g.document.costInput.lineInputs[0].grossWeightKg = value; blocked(g, 'LINE_GROSS_WEIGHT_REQUIRED');
  }
});

test('active CBM branch requires nonnegative kg and matching CW, not raw cubic metres', () => {
  for (const value of ['', null, -1]) {
    const f = fixture(); f.document.reviewedMetadata.cw = 200;
    f.document.costInput.lineInputs[0].volumeWeightKg = value; blocked(f, 'LINE_VOLUME_WEIGHT_REQUIRED');
  }
  const f = fixture(); f.document.reviewedMetadata.cw = 200;
  f.document.costInput.lineInputs[0].volumeWeightKg = 0.09; blocked(f, 'VOLUME_WEIGHT_SUM_MISMATCH');
});

test('sum GW mismatch, reverse weights, negative fees and rates block approval', () => {
  const f = fixture(); f.document.costInput.lineInputs[0].grossWeightKg = 26; blocked(f, 'GROSS_WEIGHT_SUM_MISMATCH');
  const g = fixture(); g.document.reviewedMetadata.cw = 99; blocked(g, 'WEIGHT_ORDER_INVALID');
  for (const [key, code] of [['tariffRate', 'TARIFF_RATE_REQUIRED'], ['otherCostPerUnitKRW', 'OTHER_COST_REQUIRED']]) {
    const h = fixture(); h.document.costInput.lineInputs[0][key] = -1; blocked(h, code);
  }
  const h = fixture(); h.document.costInput.customsTotalKRW = -1; blocked(h, 'CUSTOMS_TOTAL_REQUIRED');
});

test('zero-quantity rows are retained but excluded; positive amount or weight is rejected', () => {
  const f = fixture(); f.lines.push({ ...f.lines[0], lineId: ids[2], outQuantity: 0, lineAmount: 0 });
  let result = preview(f); assert.equal(result.status, 'APPROVED');
  assert.equal(result.lines[2].costPerUnitKRW, null); assert.equal(result.lines[2].totalCostKRW, 0);
  f.document.costInput.lineInputs.push({ lineId: ids[2], grossWeightKg: 1, volumeWeightKg: 0 });
  blocked(f, 'CANCELLED_LINE_WEIGHT_INVALID');
  f.document.costInput.lineInputs[2].grossWeightKg = 0; f.lines[2].lineAmount = 1; blocked(f, 'CANCELLED_LINE_AMOUNT_INVALID');
});

test('actual BUNCH/STEM/BOX quantities divide line totals without an implicit N multiplier', () => {
  const f = fixture(); const original = preview(f);
  for (const unit of ['BUNCH', 'STEM', 'BOX']) {
    const g = fixture(); g.lines[0].outQuantity = 20; g.lines[0].outUnit = unit;
    g.document.costInput.lineInputs[0].otherCostPerUnitKRW = 0;
    f.document.costInput.lineInputs[0].otherCostPerUnitKRW = 0;
    const result = preview(g); assert.equal(result.status, 'APPROVED');
    assert.equal(result.lines[0].totalCostKRW, preview(f).lines[0].totalCostKRW);
    assert.equal(result.lines[0].costPerUnitKRW, (original.lines[0].totalCostKRW - 20) / 20);
  }
});

test('current readback still rejects stale document revisions and live receipt drift', () => {
  const { document } = fixture();
  const actual = { documentId: document.documentId, documentRevision: 2, warehouseKey: 901,
    basis: 'ACTUAL', status: 'APPROVED', storedStatus: 'APPROVED', liveReceiptStatus: 'MATCH', formulaId: formula.formulaId };
  const costs = { ...actual, documentCostStatus: 'APPROVED', currentActual: actual };
  assert.equal(validateInvoiceCostReadback(document, 901, { success: true, costs }).ok, true);
  actual.documentRevision = 1;
  assert.equal(validateInvoiceCostReadback(document, 901, { success: true, costs }).ok, false);
  actual.documentRevision = 2; actual.liveReceiptStatus = 'STALE';
  assert.equal(validateInvoiceCostReadback(document, 901, { success: true, costs }).ok, false);
});

test('UI restores and serializes new line weights while recognized GW remains only a hint', () => {
  const source = readFileSync(new URL('../components/import-tools/InvoiceReceiptCostReview.js', import.meta.url), 'utf8');
  const require = createRequire(import.meta.url);
  require('next/dist/compiled/babel/core').transformSync(source, {
    filename: 'InvoiceReceiptCostReview.js', presets: [require('next/dist/compiled/babel/preset-react')], configFile: false, babelrc: false,
  });
  const beforeField = source.slice(source.indexOf('const EMPTY_FORM'), source.indexOf('function Field('));
  const ui = new Function('INVOICE_COST_FORMULAS', `${beforeField}\nreturn { initialForm, payloadOf, applicableFormulaId };`)(INVOICE_COST_FORMULAS);
  const f = fixture();
  f.lines[0].sourceEvidence = { grossWeightKg: 25, grossWeightEvidence: { requiresReview: true } };
  const unsaved = ui.initialForm(f.document, f.lines);
  assert.equal(unsaved.lineInputs[0].grossWeightKg, 25);
  assert.equal(unsaved.lineInputs[1].grossWeightKg, '');
  assert.equal(unsaved.lineInputs[0].volumeWeightKg, '');
  assert.equal(unsaved.formulaApplicabilityConfirmed, false);
  assert.equal(ui.applicableFormulaId(f.document), formula.formulaId);
  f.document.reviewedMetadata.invoiceCostInput = { ...f.document.costInput,
    lineInputs: [{ lineId: ids[0], grossWeightKg: 0, volumeWeightKg: '90' }, { lineId: ids[1], grossWeightKg: '100', volumeWeightKg: '' }] };
  const restored = ui.initialForm(f.document, f.lines);
  assert.equal(restored.lineInputs[0].grossWeightKg, 0, 'saved explicit zero takes precedence over recognition');
  const payload = ui.payloadOf(restored);
  assert.equal(payload.lineInputs[0].grossWeightKg, 0);
  assert.equal(payload.lineInputs[0].volumeWeightKg, 90);
  assert.equal(payload.lineInputs[1].grossWeightKg, 100);
  assert.equal(payload.lineInputs[1].volumeWeightKg, null);
});

test('zero costs stay explicit zero and all-cancelled rows cannot invent a weight denominator', () => {
  const f = fixture();
  f.document.costInput.freightAmount = 0; f.document.costInput.customsTotalKRW = 0;
  f.document.costInput.lineInputs.forEach(line => { line.tariffRate = 0; line.otherCostPerUnitKRW = 0; });
  f.lines.forEach(line => { line.lineAmount = 0; line.unitPrice = 0; });
  assert.equal(preview(f).totals.totalCostKRW, 0);
  f.lines.forEach(line => { line.outQuantity = 0; });
  f.document.costInput.lineInputs = [];
  blocked(f, 'GROSS_WEIGHT_SUM_MISMATCH');
});

test('explicit UI restore blocks dirty or stale async responses and resets applicability on success', async () => {
  const source = readFileSync(new URL('../components/import-tools/InvoiceReceiptCostReview.js', import.meta.url), 'utf8');
  const handler = source.slice(source.indexOf('  async function loadApprovedInput()'), source.indexOf('  async function runPreview()'));
  const beforeField = source.slice(source.indexOf('const EMPTY_FORM'), source.indexOf('function Field('));
  const { initialForm } = new Function('INVOICE_COST_FORMULAS', `${beforeField}\nreturn { initialForm };`)(INVOICE_COST_FORMULAS);
  for (const scenario of ['success', 'dirty-before', 'dirty-during', 'identity-change']) {
    const f = fixture(); f.document.sourceHash = 'aa'.repeat(32);
    let resolveFetch; let fetches = 0; let restoredForm; let current = true;
    const actual = { documentId: f.document.documentId, documentRevision: 2, warehouseKey: 901,
      basis: 'ACTUAL', status: 'APPROVED', storedStatus: 'APPROVED', liveReceiptStatus: 'MATCH', ...formula,
      editableInput: { invoiceSourceHash: f.document.sourceHash, input: { ...f.document.costInput, formulaApplicabilityConfirmed: false } } };
    const costs = { documentId: f.document.documentId, documentRevision: 2, warehouseKey: 901,
      status: 'APPROVED', documentCostStatus: 'APPROVED', currentActual: actual };
    const context = { pristineRef: { current: scenario !== 'dirty-before' }, pending: null, busy: false,
      identity: 'current-doc:2', generationRef: { current: 1 }, workflowLocksRef: { current: new Set() }, document: f.document,
      receiptLines: f.lines, currentCommittedWarehouseKey: () => 901, acquireInvoiceCostWorkflowLock,
      setBusyIdentity: () => {}, isCurrent: () => current, restoredInvoiceCostInput, initialForm,
      setForm: form => { restoredForm = form; }, setInputEdited: () => {}, invalidateApprovalStages: () => {},
      setPreview: () => {}, setNotice: () => {}, mountedRef: { current: true }, identityRef: { current: 'current-doc:2' },
      fetch: () => { fetches += 1; return new Promise(resolve => { resolveFetch = resolve; }); } };
    const load = new Function('context', `with (context) { ${handler}; return loadApprovedInput; }`)(context);
    const running = load();
    if (scenario === 'dirty-before') { await running; assert.equal(fetches, 0); continue; }
    if (scenario === 'dirty-during') context.pristineRef.current = false;
    if (scenario === 'identity-change') current = false;
    resolveFetch({ ok: true, json: async () => ({ success: true, costs }) });
    await running;
    if (scenario === 'success') {
      assert.equal(restoredForm.formulaApplicabilityConfirmed, false);
      assert.equal(restoredForm.lineInputs[0].grossWeightKg, 25);
      assert.equal(context.pristineRef.current, false);
    } else assert.equal(restoredForm, undefined, `${scenario} must not overwrite the form`);
    assert.equal(context.workflowLocksRef.current.size, 0);
  }
});

const referencePath = 'C:/Users/USER/Downloads/CHINA 중국 원가자료 (8).xlsx';
test('audited reference reproduces 27-2 row24 and the 26-2 CW branch without historical defaults', { skip: !existsSync(referencePath) }, () => {
  // Source-only golden verification. Current-input fixtures above do not inherit these historical values.
  const XLSX = createRequire(import.meta.url)('xlsx');
  const bytes = readFileSync(referencePath);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), formula.formulaSourceHash);
  const workbook = XLSX.read(bytes);
  for (const sheetName of ['27-2 CLOUD', '26-2 CLOUD']) {
    const sheet = workbook.Sheets[sheetName]; const v = cell => sheet[cell].v;
    const f = fixture();
    f.document.reviewedMetadata.gw = v('C8'); f.document.reviewedMetadata.cw = v('E8');
    f.document.costInput.exchangeRateKRW = v('C7'); f.document.costInput.freightAmount = v('C11');
    f.document.costInput.customsTotalKRW = v('P10');
    const groups = sheetName === '27-2 CLOUD' ? [14, 8, 13] : [14, 8];
    f.lines = groups.map((r, i) => ({ lineId: ids[i], prodKey: i + 1, outQuantity: v(`AC${r}`), outUnit: 'BUNCH',
      unitPrice: i === 0 ? v('F24') : 0, lineAmount: i === 0 ? v('F24') * v(`AC${r}`) : 0, currency: 'CNY' }));
    f.document.costInput.lineInputs = groups.map((r, i) => ({ lineId: ids[i], grossWeightKg: v(`AB${r}`) * v(`AC${r}`),
      volumeWeightKg: v(`AG${r}`) * v(`AH${r}`), tariffRate: v('N13'), otherCostPerUnitKRW: 0 }));
    const result = preview(f); assert.equal(result.status, 'APPROVED', JSON.stringify(result.issues));
    assert.ok(Math.abs(result.lines[0].costPerUnitKRW - v('O24')) < 0.000002);
    assert.equal(result.lines[0].freightAllocationBasis, sheetName === '27-2 CLOUD' ? 'GROSS_WEIGHT_KG' : 'VOLUME_WEIGHT_KG');
    if (sheetName === '27-2 CLOUD') assert.equal(v('O24'), 4706.5970904890255);
  }
});
