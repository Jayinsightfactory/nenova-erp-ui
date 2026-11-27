import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import {
  normalizeRoundInput,
  hintsFromFileName,
  buildWorkbenchInvoices,
  reviewInvoice,
  invoiceStatus,
  requiredCheckKeys,
  backSolveRow,
  suggestReconcileFix,
  applyReconcileFix,
  buildWarehouseUploadPayload,
  buildPackingGrid,
  evidenceTarget,
  connectorPath,
  connectorTone,
  applyExistingReceipts,
  duplicateRangeLabel,
  runSequentialUpload,
  friendlyUploadError,
  blankRow,
  STATUS,
  resolveVisualAutoMatch,
} from '../lib/visualInboundWorkbench.js';
import { parseWarehousePackingGrid } from '../lib/warehousePackingImport.js';
import { parsePackingResponse } from '../lib/importPackingResponse.js';
import { SEED_ALIASES_CO, aliasKey, packingSourceKey } from '../lib/importPacking.js';
import { defaultInvoiceMatchSuggestion } from '../lib/invoiceMatchAssist.js';
import { historyKey } from '../lib/driveMatchHistory.js';

const require = createRequire(import.meta.url);

test('round input normalization pads single digits and preserves A/B suffix', () => {
  assert.equal(normalizeRoundInput('48-1'), '48-01');
  assert.equal(normalizeRoundInput('48-2A'), '48-02A');
  assert.equal(normalizeRoundInput('9-1.b'), '09-01B');
  assert.equal(normalizeRoundInput('48-02'), '48-02');
});

test('filename hints detect country, round, and AWB files without fabricating data', () => {
  assert.deepEqual(hintsFromFileName('48-2 콜카장수국 CI.pdf'), { round: '48-02', country: 'CO', isAwb: false });
  assert.deepEqual(hintsFromFileName('48-1 에콰 ROSALEDA CI.pdf'), { round: '48-01', country: 'EC', isAwb: false });
  assert.deepEqual(hintsFromFileName('48-1 에콰 AWB.pdf'), { round: '48-01', country: 'EC', isAwb: true });
});

test('AWB fields auto-route to AWB tab when AWB PDF is attached and stay on invoice otherwise', () => {
  const [draft] = buildWorkbenchInvoices({
    invoices: [{
      invoice: '001-002-000012345',
      supplier: 'LA ROSALEDA',
      date: '2026/11/20',
      invoice_total: 100,
      products: [{ description: 'ROSE EXPLORER 60CM', pcs: 2, steam_box: 100, total_stems: 200, u_price: 0.5, t_price: 100 }],
    }],
  }, {
    country: 'EC',
    fileHints: { round: '48-1' },
    awbDocument: {
      awb: '006-45558192',
      gross_weight_kg: 312.5,
      chargeable_weight_kg: 360,
      freight_rate: 4.8,
      other_charges: 35,
      currency: 'USD',
      evidence: {
        awb: { page: 1, quote: 'Air Waybill 006-45558192' },
        gross_weight_kg: { page: 1, quote: 'Gross Weight 312.5 kg' },
        chargeable_weight_kg: { page: 1, quote: 'Chargeable Weight 360 kg' },
      },
    },
  });

  assert.equal(draft.header.orderWeek, '48-01');
  assert.equal(draft.header.awb, '006-45558192');
  assert.equal(draft.header.gw, 312.5);
  assert.equal(draft.header.cw, 360);

  for (const field of ['awb', 'gw', 'cw', 'freight']) {
    assert.equal(evidenceTarget(draft, field, { hasAwbDoc: true }).doc, 'awb');
    assert.equal(evidenceTarget(draft, field, { hasAwbDoc: false }).doc, 'invoice');
  }
  const rowTarget = evidenceTarget(draft, `row:${draft.rows[0].id}:totalPrice`, { hasAwbDoc: true });
  assert.equal(rowTarget.doc, 'invoice');
  assert.ok(rowTarget.quotes.some(q => q.includes('100')));
});

test('reconcile, zero-box block, 1-click back-solve, and packing grid round-trip', () => {
  const [raw] = buildWorkbenchInvoices({
    invoices: [{
      invoice: '133973',
      supplier: 'DON EUSEBIO',
      date: '2026/11/22',
      invoice_total: 135,
      metadata_review: { issues: [{ code: 'INVOICE_NUMBER_PO_SUSPECT' }] },
      products: [{ description: 'CARNATION RED', pcs: 0, steam_box: 100, total_stems: 200, u_price: 0.5, t_price: 100 }],
    }],
  }, { country: 'CO', fileHints: { round: '48-2' } });

  // Zero-box row is blocked and missing 35 freight causes total mismatch
  const initialReview = reviewInvoice(raw);
  assert.ok(initialReview.blocking.some(i => i.field === 'boxQty'));
  assert.ok(initialReview.blocking.some(i => i.field === 'invoiceTotal'));
  assert.ok(initialReview.warnings.some(i => i.field === 'invoiceNo'));
  assert.equal(invoiceStatus(raw), STATUS.WARN);

  // 1-click reconcile suggests adding freight 35.00
  const fix = suggestReconcileFix(raw);
  assert.equal(fix?.kind, 'add-freight');
  assert.equal(fix?.value, 35);
  let fixed = applyReconcileFix(raw, fix);

  // Fix boxQty, farmName, prodName, add GW/CW rows, check all required fields
  fixed = {
    ...fixed,
    header: { ...fixed.header, farmName: 'DON EUSEBIO', gw: 120, cw: 150 },
    rows: [
      { ...fixed.rows[0], boxQty: 2, prodName: 'CARNATION / Red', prodKey: 123 },
      ...fixed.rows.slice(1),
      blankRow('gw', { steamQty: 120 }),
      blankRow('cw', { steamQty: 150 }),
    ],
  };
  assert.equal(reviewInvoice(fixed).blocking.length, 0);
  const allChecked = Object.fromEntries(requiredCheckKeys(fixed).map(k => [k, true]));
  assert.equal(invoiceStatus({ ...fixed, checked: allChecked }), STATUS.VERIFIED);

  // Back-solve check
  const solved = backSolveRow({ ...fixed.rows[0], totalPrice: 0 }, 'totalPrice');
  assert.equal(solved.totalPrice, 100);

  // Packing grid round-trip through nenova.exe-compatible parser
  const parsed = parseWarehousePackingGrid(buildPackingGrid(fixed));
  assert.equal(parsed.meta.farmName, 'DON EUSEBIO');
  assert.equal(parsed.meta.orderWeek, '48-02');
  assert.equal(parsed.meta.invoiceNo, '133973');
  assert.equal(parsed.meta.gw, 120);
  assert.equal(parsed.meta.cw, 150);
  assert.equal(parsed.meta.freight, 35);
  assert.equal(parsed.rows.length, 4);

  const payload = buildWarehouseUploadPayload(fixed, { fileName: '48-2.pdf', previewOnly: true });
  assert.equal(payload.previewOnly, true);
  assert.equal(payload.orderYear, '2026');
  assert.equal(payload.orderWeek, '48-02');
  assert.equal(payload.items.length, 4);
});

test('duplicate receipts auto-uncheck and sequential upload supports partial-failure retry', async () => {
  const drafts = buildWorkbenchInvoices({
    invoices: [
      { invoice: 'A-1', supplier: 'FARM A', date: '2026/11/20', invoice_total: 50, products: [{ description: 'P1', pcs: 1, steam_box: 100, total_stems: 100, u_price: 0.5, t_price: 50 }] },
      { invoice: 'A-2', supplier: 'FARM B', date: '2026/11/20', invoice_total: 50, products: [{ description: 'P2', pcs: 1, steam_box: 100, total_stems: 100, u_price: 0.5, t_price: 50 }] },
      { invoice: 'A-3', supplier: 'FARM C', date: '2026/11/20', invoice_total: 50, products: [{ description: 'P3', pcs: 1, steam_box: 100, total_stems: 100, u_price: 0.5, t_price: 50 }] },
    ],
  }, { country: 'CO', fileHints: { round: '48-2' } });

  const marked = applyExistingReceipts(drafts, [{ index: 0, warehouseKey: 8262, orderWeek: '48-02', farmName: 'FARM A' }]);
  assert.equal(marked[0].selected, false);
  assert.equal(invoiceStatus(marked[0]), STATUS.DUPLICATE);
  assert.equal(duplicateRangeLabel(marked), '#8262');

  const calls = [];
  let seq = 0;
  const results = await runSequentialUpload(marked, {
    newOperationId: () => `00000000-0000-4000-8000-00000000000${++seq}`,
    buildPayload: (d, previewOnly) => ({ invoiceNo: d.header.invoiceNo, operationId: d.operationId, previewOnly }),
    post: async body => {
      calls.push(body);
      if (body.invoiceNo === 'A-2') return body.previewOnly ? { success: true } : { success: true, warehouseKey: 9101 };
      if (body.invoiceNo === 'A-3' && body.previewOnly) return { success: false, code: 'WAREHOUSE_WEEK_FIXED', error: '' };
      return { success: false };
    },
  });

  // A-1 skipped (duplicate), A-2 preview+commit succeeded, A-3 stopped at preview with non-empty Korean error
  assert.equal(results.length, 2);
  assert.equal(results[0].state, 'ok');
  assert.equal(results[0].warehouseKey, 9101);
  assert.equal(results[1].state, 'error');
  assert.equal(results[1].stage, 'preview');
  assert.match(results[1].error, /출고 확정/);
  assert.equal(calls.filter(c => c.invoiceNo === 'A-3' && !c.previewOnly).length, 0);
  assert.ok(friendlyUploadError({}).length > 10);
});

test('SVG connector path and tone mapping', () => {
  assert.match(connectorPath({ x: 400, y: 200 }, { x: 700, y: 320 }), /^M 400 200 C /);
  assert.equal(connectorPath(null, { x: 1, y: 1 }), '');
  assert.equal(connectorTone({ checked: false, issues: [] }), 'checking');
  assert.equal(connectorTone({ checked: true, issues: [] }), 'done');
  assert.equal(connectorTone({ checked: true, issues: [{ level: 'warn' }] }), 'warn');
  assert.equal(connectorTone({ checked: true, issues: [{ level: 'block' }] }), 'error');
});

test('POST /api/warehouse previewOnly checks DUPLICATE_INVOICE, WAREHOUSE_WEEK_FIXED, operationId replay, and withActionLog', async () => {
  const apiSource = fs.readFileSync(new URL('../pages/api/warehouse/index.js', import.meta.url), 'utf8');
  assert.match(apiSource, /withAuth\(withActionLog\(/);

  const babel = require('next/dist/compiled/babel/core');
  const compiled = babel.transformSync(apiSource, {
    plugins: [require('next/dist/compiled/babel/plugin-transform-modules-commonjs')],
    configFile: false,
    babelrc: false,
  }).code;

  const { isMatchingDuplicateWarehouseRow } = await import('../lib/packingDuplicateCheck.js');
  const { resolveReceiptBunch } = await import('../lib/receiptBunchQuantity.js');
  const { splitIncomingRound } = await import('../lib/incomingRoundLabel.js');

  let fixed = false;
  let existingRows = [];
  let actionLogWrapped = false;
  let commitTransactions = 0;

  const query = async (statement, params) => {
    if (statement.includes('FROM Product')) return { recordset: [{ ProdKey: 670, CountryFlower: '장미', OutUnit: '박스', EstUnit: '단', SteamOf1Bunch: 10, BunchOf1Box: 10 }] };
    if (statement.includes('SELECT DISTINCT p.CountryFlower')) return { recordset: fixed ? [{ CountryFlower: '장미' }] : [] };
    if (statement.includes('/* warehouse:packing-operation */')) {
      const hit = existingRows.filter(r => r.FileName && r.FileName.startsWith(params.filePrefix.value));
      return { recordset: hit };
    }
    if (statement.includes('FROM dbo.WarehouseMaster')) {
      return { recordset: existingRows.filter(r => r.OrderYear === params.year.value && r.OrderWeek === params.week.value) };
    }
    return { recordset: [] };
  };

  const out = { exports: {} };
  const mocks = {
    '../../../lib/db': { sql: new Proxy({}, { get: (_, k) => k }), query, withTransaction: async fn => { commitTransactions += 1; return fn(query); } },
    '../../../lib/auth': { withAuth: fn => fn },
    '../../../lib/withActionLog.js': { withActionLog: (fn, opts) => { actionLogWrapped = opts?.actionType === 'WAREHOUSE_WRITE'; return fn; } },
    '../../../lib/exeParity/common.js': { useExeParityFlag: () => false },
    '../../../lib/exeWarehouseViewSql.js': { sqlWarehouseViewGetData: () => '', WAREHOUSE_DETAIL_COST_COLUMNS_SQL: '', WAREHOUSE_DOCUMENT_FREIGHT_APPLY_SQL: '' },
    '../../../lib/invoiceReceiptNative.js': { acquireInvoiceReceiptGate: async () => ({}), nextInvoiceWarehouseKey: async () => 9999, calculateInvoiceStock: async () => {}, insertInvoiceWarehouseDetail: async () => 1, applyInvoiceWarehouseStockDelta: async () => {} },
    '../../../lib/receiptBunchQuantity.js': { resolveReceiptBunch },
    '../../../lib/warehouseWeightRows.js': { WAREHOUSE_WEIGHT_ROW_SQL: '0=1' },
    '../../../lib/invoiceReceiptAccess.js': { canManageInvoiceReceipt: () => true },
    '../../../lib/manualWarehouseUpload.js': { manualWarehouseHeader: () => ({}), manualWarehouseLine: () => ({}) },
    '../../../lib/manualWarehouseUploadDb.js': { assertManualWarehouseEligible: async () => {}, readManualWarehouseAttempt: async () => ({ fileName: '', replay: null }) },
    '../../../lib/warehouseFarmChoices.js': { warehouseFarmChoicesSql: () => '' },
    '../../../lib/incomingRoundLabel.js': { splitIncomingRound },
    '../../../lib/incomingApprovalPolicy.js': { approvalPermissions: () => ({ review: false }) },
    '../../../lib/warehouseDetailActions.js': { attachWarehouseRoundLabels: async (_, __, rows) => rows, recordWarehouseRoundLabel: async () => {} },
    '../../../lib/packingDuplicateCheck.js': { isMatchingDuplicateWarehouseRow },
  };
  new Function('require', 'module', 'exports', compiled)(k => mocks[k], out, out.exports);
  const handler = out.exports.default;
  assert.equal(actionLogWrapped, true);

  const post = async body => {
    const res = { statusCode: 200, status(n) { this.statusCode = n; return this; }, json(p) { this.payload = p; return this; } };
    await handler({ method: 'POST', user: { userId: 'tester' }, body }, res);
    return res;
  };
  const baseBody = {
    orderYear: '2026', orderWeek: '48-02', farmName: 'DON EUSEBIO', invoiceNo: '00133973', inputDate: '2026-11-26',
    previewOnly: true, items: [{ prodName: 'ROSE TEST', boxQty: 2, bunchQty: 20, steamQty: 200, steamOf1Box: 100, steamOf1Bunch: 10, unitPrice: 0.5, totalPrice: 100 }],
  };

  // Cross-year fixture: prior year 2025 duplicate does NOT block 2026 preview
  existingRows = [{ WarehouseKey: 7100, OrderYear: '2025', OrderWeek: '48-02', FarmName: 'DON EUSEBIO', InvoiceNo: '133973' }];
  let res = await post(baseBody);
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.success, true);

  // Same year 2026 duplicate DOES block previewOnly with 409 DUPLICATE_INVOICE (no transaction!)
  existingRows = [{ WarehouseKey: 8262, OrderYear: '2026', OrderWeek: '48-02', FarmName: 'DON EUSEBIO', InvoiceNo: '133973' }];
  res = await post(baseBody);
  assert.equal(res.statusCode, 409);
  assert.equal(res.payload.code, 'DUPLICATE_INVOICE');
  assert.equal(res.payload.warehouseKey, 8262);
  assert.equal(commitTransactions, 0);

  // Fixed week blocks previewOnly with 409 WAREHOUSE_WEEK_FIXED
  existingRows = [];
  fixed = true;
  res = await post(baseBody);
  assert.equal(res.statusCode, 409);
  assert.equal(res.payload.code, 'WAREHOUSE_WEEK_FIXED');
  fixed = false;

  // operationId replay returns existing WarehouseKey without starting a transaction
  const opId = '11111111-2222-4333-8444-555555555555';
  existingRows = [{ WarehouseKey: 8299, OrderYear: '2026', OrderWeek: '48-02', FileName: `visual-${opId}-invoice.pdf`, CreateID: 'tester', isDeleted: 0 }];
  res = await post({ ...baseBody, previewOnly: false, operationId: opId });
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.replay, true);
  assert.equal(res.payload.warehouseKey, 8299);
  assert.equal(commitTransactions, 0);
});

test('parsePackingResponse allows USD awb_document for EC while enforcing AUD for AU', () => {
  const ecData = {
    content: [{
      type: 'text',
      text: JSON.stringify({
        invoices: [{ invoice: '0000027447', date: '2026/11/19', invoice_total: 980, products: [{ description: 'ALSTROEMERIA', pcs: 1, total_stems: 100, u_price: 9.8, t_price: 980 }] }],
        awb_document: { awb: '006-45558192', gross_weight_kg: 123, chargeable_weight_kg: 161, packages: 8, currency: 'USD' },
      }),
    }],
    stop_reason: 'end_turn',
  };
  const parsed = parsePackingResponse(ecData, 'EC');
  assert.equal(parsed.result.awb_document.currency, 'USD');
  assert.throws(() => parsePackingResponse(ecData, 'AU'), /AWB 통화가 AUD가 아닙니다/);
});

test('resolveVisualAutoMatch 4-tier priority: team saved > seed alias > history/farm/supplier > >=85 gap>=10', () => {
  const products = [
    { ProdKey: 11, ProdName: 'CARNATION Novia', country: 'CO', selectable: true },
    { ProdKey: 12, ProdName: 'CARNATION Custom Team', country: 'CO', selectable: true },
    { ProdKey: 13, ProdName: 'HYDRANGEA White Premium (BA)', country: 'CO', selectable: true },
    { ProdKey: 14, ProdName: 'HYDRANGEA White Premium (GL)', country: 'CO', selectable: true },
    { ProdKey: 15, ProdName: 'CARNATION Moon Light Select', country: 'CO', selectable: true },
    { ProdKey: 16, ProdName: 'CARNATION Moon Glow Pink', country: 'CO', selectable: true },
  ];
  const baseOpts = {
    country: 'CO',
    products,
    teamAliases: {},
    seedAliases: SEED_ALIASES_CO,
    sourceKeyFn: packingSourceKey,
    aliasKeyFn: aliasKey,
    suggestFn: defaultInvoiceMatchSuggestion,
  };

  // 1) 시드 별칭 자동매칭 (SEED_ALIASES_CO)
  const seedHit = resolveVisualAutoMatch('CARNATION SEL PEACH NOVIA', baseOpts);
  assert.equal(seedHit?.prodKey, 11);
  assert.equal(seedHit?.matchSource, '시드 별칭');

  // 2) 팀 저장 매칭이 시드 별칭보다 최우선
  const teamHit = resolveVisualAutoMatch('CARNATION SEL PEACH NOVIA', {
    ...baseOpts,
    teamAliases: { [packingSourceKey('CARNATION SEL PEACH NOVIA')]: 'CARNATION Custom Team' },
  });
  assert.equal(teamHit?.prodKey, 12);
  assert.equal(teamHit?.matchSource, '팀 저장 매칭');

  // 무효 팀 저장 매칭은 시드/유사도로 폴백하지 않고 차단(fail-closed)
  const blockedTeam = resolveVisualAutoMatch('CARNATION SEL PEACH NOVIA', {
    ...baseOpts,
    teamAliases: { [packingSourceKey('CARNATION SEL PEACH NOVIA')]: '\u0000ERP_MATCH_REQUIRES_REVIEW' },
  });
  assert.equal(blockedTeam, null);

  // 3) 농장 약어 supplier(+7점) 자동 우선매칭
  const supplierHit = resolveVisualAutoMatch('HYDRANGEA WHITE PREMIUM', {
    ...baseOpts,
    supplier: 'CI FLORES BALVERDE SAS',
  });
  assert.equal(supplierHit?.prodKey, 13);
  assert.match(supplierHit?.matchSource || '', /고신뢰 추천/);

  // 4) 과거 입고 이력(history 94~99점) 최우선 자동매칭
  const historyHit = resolveVisualAutoMatch('MYSTERY HYDRANGEA CODE 77', {
    ...baseOpts,
    history: { [historyKey('MYSTERY HYDRANGEA CODE 77')]: [{ prodKey: 14, count: 5, lastWeek: '48-01' }] },
  });
  assert.equal(historyHit?.prodKey, 14);
  assert.equal(historyHit?.matchSource, '과거 입고 이력 (5회)');

  // 5) 동일 농장 입고 원장 이력(byFarm) + >=85 & 격차>=10 자동매칭
  const farmHistHit = resolveVisualAutoMatch('CARNATION MOON LIGHT WHITE', {
    ...baseOpts,
    supplier: 'Flores El Zorro S.A.S.',
    farmName: 'Flores El Zorro',
    byFarm: { [historyKey('Flores El Zorro')]: [15] },
  });
  assert.equal(farmHistHit?.prodKey, 15);
  assert.match(farmHistHit?.matchSource || '', /고신뢰 추천 8\d%|고신뢰 추천 9\d%/);
});

test('UI entrypoints and leader-line SVG layer contract', () => {
  const incomingSrc = fs.readFileSync(new URL('../pages/incoming.js', import.meta.url), 'utf8');
  const toolsSrc = fs.readFileSync(new URL('../pages/import/tools.js', import.meta.url), 'utf8');
  const leaderSrc = fs.readFileSync(new URL('../components/import-tools/VisualInboundLeaderLine.js', import.meta.url), 'utf8');
  assert.match(incomingSrc, /VisualInboundVerifyWorkbench/);
  assert.match(incomingSrc, /PDF\/AWB 바로 입고/);
  assert.match(toolsSrc, /VisualInboundVerifyWorkbench/);
  assert.match(toolsSrc, /PDF·AWB 바로 입고/);
  assert.match(leaderSrc, /data-layer="wires"/);
  assert.doesNotMatch(leaderSrc, /data-layer="labels"/);
});
