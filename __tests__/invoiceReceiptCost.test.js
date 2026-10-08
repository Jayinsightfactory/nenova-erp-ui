import assert from 'node:assert/strict';
import test from 'node:test';
import {
  INVOICE_COST_FORMULAS,
  previewInvoiceCost,
  readInvoiceCosts,
  saveInvoiceCostRevision,
} from '../lib/invoiceReceiptCost.js';

const IDS = Object.freeze({
  document: '11111111-1111-8111-8111-111111111111',
  operation: '22222222-2222-8222-8222-222222222222',
  part: '33333333-3333-8333-8333-333333333333',
  line1: '44444444-4444-8444-8444-444444444444',
  line2: '55555555-5555-8555-8555-555555555555',
  line3: '66666666-6666-8666-8666-666666666666',
});

function commonInput(formulaId, overrides = {}) {
  const formula = INVOICE_COST_FORMULAS[formulaId];
  return {
    formulaId,
    formulaVersion: formula.formulaVersion,
    formulaSourceHash: formula.formulaSourceHash,
    formulaSourceSheet: formula.formulaSourceSheet,
    formulaSourceCells: formula.formulaSourceCells,
    formulaApplicabilityConfirmed: true,
    formulaEffectiveDate: '2026-10-08',
    nativeCurrency: formulaId === 'CN_SEA_ACTUAL_V1' ? 'CNY' : 'EUR',
    freightCurrency: formulaId === 'CN_SEA_ACTUAL_V1' ? 'CNY' : 'EUR',
    exchangeRateKRW: formulaId === 'CN_SEA_ACTUAL_V1' ? 200 : 1500,
    exchangeRateType: 'PURCHASE',
    exchangeRateDate: '2026-10-08',
    freightAmount: formulaId === 'CN_SEA_ACTUAL_V1' ? 40 : 50,
    customsTotalKRW: formulaId === 'NL_AMOUNT_V1' ? 5000 : null,
    costSourceId: formulaId === 'CN_SEA_ACTUAL_V1' ? 'china-forwarder:bill-41:freight:CNY' : 'nl-forwarder:awb-40-2:freight:EUR',
    allocationScope: 'SINGLE_INVOICE',
    allocationShareNumerator: 1,
    allocationShareDenominator: 1,
    lineInputs: [],
    ...overrides,
  };
}

function chinaDocument(input = commonInput('CN_SEA_ACTUAL_V1')) {
  return { documentId: IDS.document, revision: 1, sourceHash: 'aa'.repeat(32), reviewedMetadata: { country: 'CN', transportMode: 'SEA', inputDate: '2026-10-08' }, costInput: input };
}

function chinaLines(overrides = {}) {
  return [
    { lineId: IDS.line1, prodKey: 10, outQuantity: 10, outUnit: '단', boxQuantity: 1, bunchQuantity: 10, stemQuantity: 100,
      unitPrice: 10, lineAmount: 100, currency: 'CNY', ...overrides },
    { lineId: IDS.line2, prodKey: 11, outQuantity: 30, outUnit: '단', boxQuantity: 3, bunchQuantity: 30, stemQuantity: 300,
      unitPrice: 10, lineAmount: 300, currency: 'CNY', ...overrides },
  ];
}

function chinaLineInputs() {
  return [
    { lineId: IDS.line1, tariffRate: 0, otherCostPerUnitKRW: 0 },
    { lineId: IDS.line2, tariffRate: 0, otherCostPerUnitKRW: 0 },
  ];
}

test('CN sea uses actual receipt quantity for freight allocation and keeps 95% as comparison only', () => {
  const input = commonInput('CN_SEA_ACTUAL_V1', { lineInputs: chinaLineInputs(), expected95Quantity: 50 });
  const result = previewInvoiceCost(chinaDocument(input), chinaLines());
  assert.equal(result.status, 'APPROVED');
  assert.equal(result.basis, 'ACTUAL');
  assert.equal(result.lines[0].componentAmounts.freightNative, 10);
  assert.equal(result.lines[1].componentAmounts.freightNative, 30);
  assert.equal(result.lines[0].costPerUnitKRW, 2200);
  assert.equal(result.totals.totalCostKRW, 88000);
  assert.equal(result.expected95.status, 'COMPARISON_ONLY');
  assert.equal(result.expected95.freightPerUnitNative, 0.8);
  assert.equal(result.expected95.lines[0].costPerUnitKRW, 2160);
  assert.equal(result.expected95.lines.reduce((sum, line) => sum + line.totalCostKRW, 0), 86400);
  assert.equal(result.totals.totalCostKRW, 88000, '95% comparison must not replace the ACTUAL total');
});

test('zero-quantity cancellation rows stay mapped but are excluded from actual allocation', () => {
  const input = commonInput('CN_SEA_ACTUAL_V1', { lineInputs: [
    { lineId: IDS.line2, tariffRate: 0, otherCostPerUnitKRW: 0 },
  ] });
  const lines = chinaLines();
  lines[0] = { ...lines[0], outQuantity: 0, bunchQuantity: 0, stemQuantity: 0, lineAmount: 0 };
  const result = previewInvoiceCost(chinaDocument(input), lines);
  assert.equal(result.status, 'APPROVED');
  assert.equal(result.lines.length, 2);
  assert.equal(result.lines[0].quantity, 0);
  assert.equal(result.lines[0].costPerUnitKRW, null);
  assert.equal(result.lines[0].totalCostKRW, 0);
  assert.equal(result.lines[0].componentAmounts.cancellation, true);
  assert.equal(result.lines[1].componentAmounts.freightNative, 40);
  assert.equal(result.totals.totalCostKRW, 68000);
});

test('zero-quantity rows with positive amounts and all-zero invoices with freight require review', () => {
  const input = commonInput('CN_SEA_ACTUAL_V1', { lineInputs: [] });
  const positiveAmount = previewInvoiceCost(chinaDocument(input), [{
    ...chinaLines()[0], outQuantity: 0, lineAmount: 1,
  }]);
  assert.equal(positiveAmount.status, 'REVIEW_REQUIRED');
  assert.ok(positiveAmount.issues.some(item => item.code === 'CANCELLED_LINE_AMOUNT_INVALID'));

  const noAllocation = previewInvoiceCost(chinaDocument(input), [{
    ...chinaLines()[0], outQuantity: 0, bunchQuantity: 0, stemQuantity: 0, lineAmount: 0,
  }]);
  assert.equal(noAllocation.status, 'REVIEW_REQUIRED');
  assert.equal(noAllocation.totals, null);
  assert.ok(noAllocation.issues.some(item => item.code === 'ACTUAL_ALLOCATION_REQUIRED'));
});

test('deterministic UUIDv8 document and line identities are accepted', () => {
  const input = commonInput('CN_SEA_ACTUAL_V1', { lineInputs: chinaLineInputs() });
  const result = previewInvoiceCost(chinaDocument(input), chinaLines());
  assert.equal(result.status, 'APPROVED');
  assert.equal(result.issues.some(item => item.code === 'LINE_ID_REQUIRED'), false);
});

test('NL amount allocation follows G/H/J/K/L/M/O and preserves exact component totals', () => {
  const input = commonInput('NL_AMOUNT_V1', { lineInputs: [
    { lineId: IDS.line1, tariffRate: 0.1, stemsPerBunch: 10 },
    { lineId: IDS.line2, tariffRate: 0.2, stemsPerBunch: 10 },
  ] });
  const lines = [
    { lineId: IDS.line1, prodKey: 20, outQuantity: 10, outUnit: 'BUNCH', bunchQuantity: 10, stemQuantity: 100,
      unitPrice: 1, lineAmount: 100, currency: 'EUR' },
    { lineId: IDS.line2, prodKey: 21, outQuantity: 20, outUnit: '단', bunchQuantity: 20, stemQuantity: 200,
      unitPrice: 2, lineAmount: 400, currency: 'EUR' },
    { lineId: IDS.line3, prodKey: 22, outQuantity: 0, outUnit: '단', bunchQuantity: 0, stemQuantity: 0,
      unitPrice: 2, lineAmount: 0, currency: 'EUR' },
  ];
  const result = previewInvoiceCost({ documentId: IDS.document, revision: 1, sourceHash: 'bb'.repeat(32),
    reviewedMetadata: { country: 'NL', transportMode: 'AIR', inputDate: '2026-10-08' }, costInput: input }, lines);
  assert.equal(result.status, 'APPROVED');
  assert.equal(result.lines[0].componentAmounts.amountShare, 0.2);
  assert.equal(result.lines[0].componentAmounts.freightNative, 10);
  assert.equal(result.lines[0].costPerUnitKRW, 18250);
  assert.equal(result.lines[1].costPerUnitKRW, 39800);
  assert.equal(result.totals.componentAmounts.goodsKRW, 750000);
  assert.equal(result.totals.componentAmounts.freightKRW, 75000);
  assert.equal(result.totals.componentAmounts.tariffKRW, 148500);
  assert.equal(result.totals.componentAmounts.customsKRW, 5000);
  assert.equal(result.totals.totalCostKRW, 978500);
  assert.equal(result.lines[2].costPerUnitKRW, null);
  assert.equal(result.lines[2].totalCostKRW, 0);
});

test('formula applicability requires explicit confirmation, exact reviewed date, and NL air transport', () => {
  const cnInput = commonInput('CN_SEA_ACTUAL_V1', { formulaApplicabilityConfirmed: false, lineInputs: chinaLineInputs() });
  const unconfirmed = previewInvoiceCost(chinaDocument(cnInput), chinaLines());
  assert.equal(unconfirmed.status, 'REVIEW_REQUIRED');
  assert.ok(unconfirmed.issues.some(item => item.code === 'FORMULA_APPLICABILITY_CONFIRMATION_REQUIRED'));

  const wrongDateInput = commonInput('CN_SEA_ACTUAL_V1', { formulaEffectiveDate: '2026-10-07', lineInputs: chinaLineInputs() });
  const wrongDate = previewInvoiceCost(chinaDocument(wrongDateInput), chinaLines());
  assert.ok(wrongDate.issues.some(item => item.code === 'FORMULA_EFFECTIVE_DATE_REQUIRED'));

  const nlInput = commonInput('NL_AMOUNT_V1', { lineInputs: [
    { lineId: IDS.line1, tariffRate: 0, stemsPerBunch: 10 },
  ] });
  const nlGround = previewInvoiceCost({ reviewedMetadata: { country: 'NL', transportMode: 'SEA', inputDate: '2026-10-08' }, costInput: nlInput }, [{
    ...chinaLines()[0], outUnit: '단', stemQuantity: 100, unitPrice: 1, lineAmount: 100, currency: 'EUR',
  }]);
  assert.ok(nlGround.issues.some(item => item.code === 'FORMULA_TRANSPORT_MISMATCH'));
});

test('preview accepts 1000 lines at the document store limit', () => {
  const lines = Array.from({ length: 1000 }, (_, index) => ({
    lineId: `aaaaaaaa-aaaa-8aaa-8aaa-${(index + 1).toString(16).padStart(12, '0')}`,
    prodKey: index + 1,
    outQuantity: 1,
    outUnit: '단',
    bunchQuantity: 1,
    stemQuantity: 1,
    unitPrice: 1,
    lineAmount: 1,
    currency: 'CNY',
  }));
  const input = commonInput('CN_SEA_ACTUAL_V1', { freightAmount: 0,
    lineInputs: lines.map(line => ({ lineId: line.lineId, tariffRate: 0, otherCostPerUnitKRW: 0 })) });
  const result = previewInvoiceCost(chinaDocument(input), lines);
  assert.equal(result.status, 'APPROVED');
  assert.equal(result.lines.length, 1000);
  assert.equal(result.totals.totalCostKRW, 200000);
});

test('input currency is explicit and a mismatched line never receives an invented conversion', () => {
  const input = commonInput('CN_SEA_ACTUAL_V1', { lineInputs: chinaLineInputs() });
  const lines = chinaLines();
  lines[1] = { ...lines[1], currency: 'USD' };
  const result = previewInvoiceCost(chinaDocument(input), lines);
  assert.equal(result.status, 'REVIEW_REQUIRED');
  assert.equal(result.lines.length, 0);
  assert.equal(result.totals, null);
  assert.ok(result.issues.some(item => item.code === 'LINE_CURRENCY_MISMATCH' && item.lineId === IDS.line2));
});

test('explicit zero costs remain zero instead of being treated as missing', () => {
  const input = commonInput('CN_SEA_ACTUAL_V1', {
    freightAmount: 0,
    lineInputs: [{ lineId: IDS.line1, tariffRate: 0, otherCostPerUnitKRW: 0 }],
  });
  const line = [{ ...chinaLines()[0], unitPrice: 0, lineAmount: 0 }];
  const result = previewInvoiceCost(chinaDocument(input), line);
  assert.equal(result.status, 'APPROVED');
  assert.equal(result.lines[0].costPerUnitKRW, 0);
  assert.equal(result.lines[0].totalCostKRW, 0);
  assert.equal(result.totals.totalCostKRW, 0);
});

test('missing actual inputs stay REVIEW_REQUIRED even when a 95% quantity exists', () => {
  const input = commonInput('CN_SEA_ACTUAL_V1', { freightAmount: null, expected95Quantity: 50, lineInputs: chinaLineInputs() });
  const result = previewInvoiceCost(chinaDocument(input), chinaLines());
  assert.equal(result.status, 'REVIEW_REQUIRED');
  assert.equal(result.lines.length, 0);
  assert.equal(result.totals, null);
  assert.equal(result.expected95, null);
  assert.ok(result.issues.some(item => item.code === 'FREIGHT_AMOUNT_REQUIRED'));
});

test('unsupported countries and formulas are review blockers, never fake zero approvals', () => {
  const result = previewInvoiceCost({ reviewedMetadata: { country: 'TH' }, costInput: { formulaId: 'TH_UNKNOWN' } }, chinaLines());
  assert.equal(result.status, 'REVIEW_REQUIRED');
  assert.equal(result.lines.length, 0);
  assert.equal(result.totals, null);
  assert.ok(result.issues.some(item => item.code === 'FORMULA_UNSUPPORTED'));
});

const types = new Proxy({ MAX: 'MAX' }, { get(target, key) {
  if (key in target) return target[key];
  return (...args) => `${String(key)}(${args.join(',')})`;
} });
const values = params => Object.fromEntries(Object.entries(params || {}).map(([key, item]) => [key, item?.value]));

function persistenceDb() {
  const input = commonInput('CN_SEA_ACTUAL_V1', { lineInputs: [{ lineId: IDS.line1, tariffRate: 0, otherCostPerUnitKRW: 0 }] });
  const state = {
    queries: [], revisions: [], costLines: [], history: [], documentCostStatus: 'PENDING',
    warehouseHeader: { WarehouseKey: 901, OrderYear: '2026', OrderWeek: '41-01', FarmName: 'Fixture Farm',
      InvoiceNo: 'CN-1', OrderNo: '', InputDateISO: '2026-10-08', GrossWeight: null,
      ChargeableWeight: null, FreightRateUSD: null, DocFeeUSD: null, isDeleted: 0 },
    warehouseDetails: [{ WdetailKey: 7001, WarehouseKey: 901, ProdKey: 10, BoxQuantity: 1,
      BunchQuantity: 10, SteamQuantity: 100, OutQuantity: 10, EstQuantity: 10, UPrice: 10, TPrice: 100 }],
  };
  const document = {
    DocumentId: IDS.document, OrderYear: '2026', OrderWeek: '41-01', Revision: 1, FarmKey: 7, InvoiceNo: 'CN-1', InvoiceYear: '2026',
    SourceHash: Buffer.from('aa'.repeat(32), 'hex'), OriginalFileName: 'cn.xlsx', ReceiptStatus: 'COMMITTED', CostStatus: 'PENDING',
    RawMetadataJson: '{}', ReviewedMetadataJson: JSON.stringify({ country: 'CN', transportMode: 'SEA', inputDate: '2026-10-08' }),
    CreatedBy: 'creator', CreatedAt: new Date('2026-10-08T00:00:00Z'), UpdatedBy: 'writer', UpdatedAt: new Date('2026-10-08T00:01:00Z'), RowVersion: Buffer.alloc(8),
  };
  const line = { DocumentId: IDS.document, Revision: 1, LineId: IDS.line1, LineNo: 1, OriginalName: 'Rose', LengthText: null, ProdKey: 10,
    BoxQuantity: null, BunchQuantity: 10, StemQuantity: null, PriceUnit: 'BUNCH', UnitPrice: 10, Currency: 'CNY', LineAmount: 100,
    SourceEvidenceJson: '{}', ReviewedJson: '{}' };
  const operation = { OperationId: IDS.operation, DocumentId: IDS.document, DocumentRevision: 1, ReceiptPartId: IDS.part,
    RequestHash: Buffer.from('cc'.repeat(32), 'hex'), Action: 'CREATE_RECEIPT', Status: 'COMMITTED', WarehouseKey: 901,
    ResultJson: JSON.stringify({ receiptDigest: 'dd'.repeat(32), lineMappings: [{ lineId: IDS.line1, wdetailKey: 7001,
      prodKey: 10, outQuantity: 10, unit: 'BUNCH', boxQuantity: 1, bunchQuantity: 10, stemQuantity: 100,
      unitPrice: 10, lineAmount: 100 }], receiptSnapshot: { header: state.warehouseHeader,
      details: state.warehouseDetails } }),
    ErrorCode: null, Actor: 'writer', CreatedAt: new Date('2026-10-08T00:01:00Z'), CompletedAt: new Date('2026-10-08T00:02:00Z') };
  state.operation = operation;

  const execute = async (sqlText, rawParams = {}) => {
    const p = values(rawParams); state.queries.push({ sql: sqlText, params: p, rawParams });
    if (sqlText.includes('transaction-lock')) return { recordset: [] };
    if (sqlText.includes('lock-document')) return { recordset: [{ DocumentId: IDS.document, Revision: 1 }] };
    if (sqlText.includes('invoice-receipt:get-document')) return { recordset: [{ ...document, CostStatus: state.documentCostStatus }] };
    if (sqlText.includes('invoice-receipt:get-lines')) return { recordset: [line] };
    if (sqlText.includes('invoice-receipt:get-history')) return { recordset: [] };
    if (sqlText.includes('invoice-receipt:get-operations')) return { recordset: [{ ...state.operation }] };
    if (sqlText.includes('validate-live-receipt-header')) return { recordset: [{ ...state.warehouseHeader }] };
    if (sqlText.includes('validate-live-receipt-details')) return { recordset: state.warehouseDetails.map(row => ({ ...row })) };
    if (sqlText.includes('check-source-identity')) return { recordset: [] };
    if (sqlText.includes('idempotent-read')) {
      const found = state.revisions.find(row => row.DocumentId === p.documentId && row.DocumentRevision === p.documentRevision
        && row.Basis === 'ACTUAL' && row.Status === 'APPROVED' && JSON.parse(row.InputSnapshotJson).saveFingerprint === p.saveFingerprint);
      return { recordset: found ? [{ CostRevisionId: found.CostRevisionId, RevisionNo: found.RevisionNo, WarehouseKey: found.WarehouseKey }] : [] };
    }
    if (sqlText.includes('stale-prior')) { state.revisions.forEach(row => { if (row.DocumentId === p.documentId && row.Status === 'APPROVED') row.Status = 'STALE'; }); return { recordset: [] }; }
    if (sqlText.includes('next-revision')) return { recordset: [{ RevisionNo: 1 + Math.max(0, ...state.revisions.filter(row => row.DocumentId === p.documentId && row.OperationId === p.operationId && row.Basis === p.basis).map(row => row.RevisionNo)) }] };
    if (sqlText.includes('insert-revision')) {
      state.revisions.push({ CostRevisionId: p.costRevisionId, DocumentId: p.documentId, DocumentRevision: p.documentRevision,
        OperationId: p.operationId, WarehouseKey: p.warehouseKey, RevisionNo: p.revisionNo, Basis: p.basis, Status: 'APPROVED', Currency: p.currency,
        FormulaId: p.formulaId, FormulaVersion: p.formulaVersion, FormulaSourceHash: p.formulaSourceHash, InputSnapshotJson: p.snapshot,
        ApprovedBy: p.actor, ApprovedAt: p.now, CreatedAt: p.now });
      return { recordset: [] };
    }
    if (sqlText.includes('insert-line')) {
      state.costLines.push({ CostRevisionId: p.costRevisionId, LineId: p.lineId, WdetailKey: p.wdetailKey, ProdKey: p.prodKey,
        Unit: p.unit, Quantity: p.quantity, CostPerUnit: p.costPerUnit, TotalCost: p.totalCost, ComponentAmountsJson: p.components });
      return { recordset: [] };
    }
    if (sqlText.includes('verify-save')) {
      const rows = state.costLines.filter(row => row.CostRevisionId === p.costRevisionId);
      return { recordset: [{ LineCount: rows.length, TotalCost: rows.reduce((sum, row) => sum + Number(row.TotalCost), 0) }] };
    }
    if (sqlText.includes('approve-document')) { state.documentCostStatus = 'APPROVED'; state.history.push({ action: 'APPROVE_INVOICE_COST', actor: p.actor }); return { recordset: [] }; }
    if (sqlText.includes('read-warehouse-scope')) return { recordset: [{ DocumentId: IDS.document,
      CurrentDocumentRevision: 1, CostStatus: state.documentCostStatus, OperationId: IDS.operation,
      DocumentRevision: 1, OrderYear: '2026', OrderWeek: '41-01', InvoiceNo: 'CN-1' }] };
    if (sqlText.includes('read-warehouse-revisions')) {
      const rows = [];
      for (const revision of state.revisions.filter(row => row.WarehouseKey === p.warehouseKey)) {
        const revisionLines = state.costLines.filter(row => row.CostRevisionId === revision.CostRevisionId);
        if (!revisionLines.length) rows.push({ ...revision, OrderYear: '2026', OrderWeek: '41-01', InvoiceNo: 'CN-1' });
        for (const costLine of revisionLines) rows.push({ ...revision,
          OrderYear: '2026', OrderWeek: '41-01', InvoiceNo: 'CN-1', ...costLine });
      }
      return { recordset: rows };
    }
    if (sqlText.includes('read-live-receipt-header')) return { recordset: [{ ...state.warehouseHeader }] };
    if (sqlText.includes('read-live-receipt-details')) return { recordset: state.warehouseDetails.map(row => ({ ...row })) };
    throw new Error(`Unhandled SQL: ${sqlText}`);
  };
  const withTransactionFn = async (callback, options) => { state.options = options; return callback(execute); };
  return { input, state, execute, withTransactionFn };
}

test('cost persistence locks, maps committed lineId to WdetailKey, stales separately, and retries idempotently', async () => {
  const db = persistenceDb();
  const first = await saveInvoiceCostRevision({ withTransactionFn: db.withTransactionFn, types, documentId: IDS.document,
    revision: 1, actor: 'approver', input: db.input, reason: 'source checked' });
  assert.equal(first.idempotent, false);
  assert.equal(first.currentActual.lines[0].wdetailKey, 7001);
  assert.equal(first.status, 'APPROVED');
  assert.equal(first.documentCostStatus, 'APPROVED');
  assert.equal(first.currentActual.liveReceiptStatus, 'MATCH');
  const approvedSnapshot = JSON.parse(db.state.revisions[0].InputSnapshotJson).receiptSnapshot;
  assert.equal(approvedSnapshot.details[0].boxQuantity, 1, 'derived committed quantity overrides raw null');
  assert.equal(approvedSnapshot.details[0].stemQuantity, 100, 'derived committed quantity overrides raw null');
  assert.equal(first.currentActual.lines[0].currency, undefined, 'line response exposes KRW amounts without native metadata');
  assert.equal(db.state.documentCostStatus, 'APPROVED');
  assert.deepEqual(db.state.options, { retries: 0 });
  assert.equal(db.state.history[0].actor, 'approver');
  assert.ok(db.state.queries.some(call => call.sql.includes('sp_getapplock')));
  assert.ok(db.state.queries.some(call => call.sql.includes('JSON_VALUE(InputSnapshotJson,N\'$.costSourceId\')')
    && call.sql.includes("Status IN (N'APPROVED',N'STALE')")));
  assert.deepEqual(JSON.parse(db.state.revisions[0].InputSnapshotJson).formula.applicabilityScope,
    { country: 'CN', transportMode: 'SEA', prodKeys: [10] });
  assert.ok(db.state.queries.every(call => !/\b(?:INSERT|UPDATE|DELETE|MERGE)\s+(?:INTO\s+)?dbo\.(?:WarehouseMaster|WarehouseDetail|OrderMaster|ShipmentDetail|ProductStock|StockHistory)\b/i.test(call.sql)));

  const second = await saveInvoiceCostRevision({ withTransactionFn: db.withTransactionFn, types, documentId: IDS.document,
    revision: 1, actor: 'approver', input: db.input, reason: 'source checked' });
  assert.equal(second.idempotent, true);
  assert.equal(db.state.revisions.length, 1);
  assert.equal(db.state.costLines.length, 1);
});

test('warehouse cost read returns approved safe fields and rejects invalid keys', async () => {
  const db = persistenceDb();
  await saveInvoiceCostRevision({ withTransactionFn: db.withTransactionFn, types, documentId: IDS.document,
    revision: 1, actor: 'approver', input: db.input, reason: 'source checked' });
  const costs = await readInvoiceCosts({ queryFn: db.execute, types, warehouseKey: 901 });
  assert.equal(costs.currentActual.warehouseKey, 901);
  assert.equal(costs.currentActual.totalCostKRW, 28000);
  assert.equal(costs.status, 'APPROVED');
  assert.equal(costs.documentCostStatus, 'APPROVED');
  assert.equal('inputSnapshot' in costs.currentActual, false);
  assert.equal('rawMetadata' in costs.currentActual, false);
  await assert.rejects(readInvoiceCosts({ queryFn: db.execute, types, warehouseKey: 0 }), error => error.code === 'WAREHOUSE_KEY_REQUIRED');
});

test('save rejects live WarehouseDetail quantity or price drift before approval', async () => {
  const db = persistenceDb();
  db.state.warehouseDetails[0].UPrice = 11;
  await assert.rejects(saveInvoiceCostRevision({ withTransactionFn: db.withTransactionFn, types,
    documentId: IDS.document, revision: 1, actor: 'approver', input: db.input, reason: 'source checked' }),
  error => error.code === 'ERP_RECEIPT_CHANGED' && error.issues[0].fields.includes('unitPrice'));
  assert.equal(db.state.revisions.length, 0);
});

test('save fails closed when a legacy committed operation has no exact receipt header snapshot', async () => {
  const db = persistenceDb();
  const result = JSON.parse(db.state.operation.ResultJson);
  delete result.receiptSnapshot;
  db.state.operation.ResultJson = JSON.stringify(result);
  await assert.rejects(saveInvoiceCostRevision({ withTransactionFn: db.withTransactionFn, types,
    documentId: IDS.document, revision: 1, actor: 'approver', input: db.input, reason: 'source checked' }),
  error => error.code === 'RECEIPT_SNAPSHOT_REQUIRED');
  assert.equal(db.state.revisions.length, 0);
});

test('save rejects live WarehouseMaster header drift or deletion before approval', async () => {
  const db = persistenceDb();
  db.state.warehouseHeader.GrossWeight = 1;
  await assert.rejects(saveInvoiceCostRevision({ withTransactionFn: db.withTransactionFn, types,
    documentId: IDS.document, revision: 1, actor: 'approver', input: db.input, reason: 'source checked' }),
  error => error.code === 'ERP_RECEIPT_CHANGED' && error.issues[0].code === 'ERP_RECEIPT_HEADER_CHANGED');
  assert.equal(db.state.revisions.length, 0);
});

test('read returns stale history and suppresses current approval when live WarehouseDetail drifts', async () => {
  const db = persistenceDb();
  await saveInvoiceCostRevision({ withTransactionFn: db.withTransactionFn, types, documentId: IDS.document,
    revision: 1, actor: 'approver', input: db.input, reason: 'source checked' });
  db.state.warehouseDetails[0].OutQuantity = 9;
  const costs = await readInvoiceCosts({ queryFn: db.execute, types, warehouseKey: 901 });
  assert.equal(costs.status, 'STALE');
  assert.equal(costs.documentCostStatus, 'APPROVED');
  assert.equal(costs.currentActual, null);
  assert.equal(costs.revisions[0].storedStatus, 'APPROVED');
  assert.equal(costs.revisions[0].status, 'STALE');
  assert.equal(costs.revisions[0].liveReceiptStatus, 'STALE');
  assert.equal(costs.revisions[0].totalCostKRW, 28000, 'historical approved value remains visible, but never current');
});

test('read suppresses an approved cost when the live WarehouseMaster header changes', async () => {
  const db = persistenceDb();
  await saveInvoiceCostRevision({ withTransactionFn: db.withTransactionFn, types, documentId: IDS.document,
    revision: 1, actor: 'approver', input: db.input, reason: 'source checked' });
  db.state.warehouseHeader.isDeleted = 1;
  const costs = await readInvoiceCosts({ queryFn: db.execute, types, warehouseKey: 901 });
  assert.equal(costs.status, 'STALE');
  assert.equal(costs.currentActual, null);
  assert.equal(costs.revisions[0].liveReceiptStatus, 'STALE');
});

test('read suppresses a previously approved revision when the document cost status is stale', async () => {
  const db = persistenceDb();
  await saveInvoiceCostRevision({ withTransactionFn: db.withTransactionFn, types, documentId: IDS.document,
    revision: 1, actor: 'approver', input: db.input, reason: 'source checked' });
  db.state.documentCostStatus = 'STALE';
  const costs = await readInvoiceCosts({ queryFn: db.execute, types, warehouseKey: 901 });
  assert.equal(costs.status, 'STALE');
  assert.equal(costs.documentCostStatus, 'STALE');
  assert.equal(costs.currentActual, null);
  assert.equal(costs.revisions[0].storedStatus, 'APPROVED');
  assert.equal(costs.revisions[0].status, 'STALE');
  assert.equal(costs.revisions[0].liveReceiptStatus, 'MATCH');
});

test('read exposes persisted stale revisions and never invents a zero total for a revision without lines', async () => {
  const db = persistenceDb();
  db.state.documentCostStatus = 'STALE';
  db.state.revisions.push({ CostRevisionId: '66666666-6666-8666-8666-666666666666', DocumentId: IDS.document,
    DocumentRevision: 1, OperationId: IDS.operation, WarehouseKey: 901, RevisionNo: 1, Basis: 'ACTUAL',
    Status: 'STALE', Currency: 'KRW', FormulaId: 'CN_SEA_ACTUAL_V1', FormulaVersion: '1.0.0',
    FormulaSourceHash: Buffer.from(INVOICE_COST_FORMULAS.CN_SEA_ACTUAL_V1.formulaSourceHash, 'hex'),
    InputSnapshotJson: JSON.stringify({}), ApprovedBy: 'approver', ApprovedAt: new Date(), CreatedAt: new Date() });
  const costs = await readInvoiceCosts({ queryFn: db.execute, types, warehouseKey: 901 });
  assert.equal(costs.status, 'STALE');
  assert.equal(costs.documentCostStatus, 'STALE');
  assert.equal(costs.currentActual, null);
  assert.equal(costs.revisions[0].status, 'STALE');
  assert.equal(costs.revisions[0].totalCostKRW, null);
});
