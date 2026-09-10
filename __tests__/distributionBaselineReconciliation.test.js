'use strict';

const assert = require('node:assert/strict');
const {
  ALSTRO_RE,
  BaselineReconciliationError,
  reconcileDistributionBaseline,
} = require('../lib/distributionBaselineReconcile');

const ID = 'a'.repeat(64);

function baseline({
  week = '37-01',
  coverage = 'single',
  rows = [
    { id: 'sheet-a!A4', label: '수국 A', key: 11, values: { 'sheet-a!B3': 2 } },
    { id: 'sheet-a!A5', label: '루스커스 A', key: 12, values: { 'sheet-a!B3': 1 } },
  ],
  clients = [{ id: 'sheet-a!B3', label: '거래처 A', day: '목', key: 21 }],
} = {}) {
  return {
    id: ID,
    year: '2026',
    week,
    coverage,
    parsed: { sheets: [{ id: 'sheet-a', name: '수국', rows, clients }] },
  };
}

function product(ProdKey, FlowerName, overrides = {}) {
  return {
    ProdKey,
    ProdName: `${FlowerName} ${ProdKey}`,
    DisplayName: `${FlowerName} ${ProdKey}`,
    CounName: '콜롬비아',
    FlowerName,
    OutUnit: '박스',
    BunchOf1Box: 0,
    SteamOf1Box: 0,
    ...overrides,
  };
}

const products = [
  product(11, '수국'),
  product(12, '루스커스', { OutUnit: '단' }),
  product(13, '수국'),
  product(14, '장미'),
];
const customers = [{ CustKey: 21, CustName: '거래처 A' }];

function current(prodKey, qty, overrides = {}) {
  return {
    year: '2026',
    week: '37-01',
    custKey: 21,
    prodKey,
    SdetailKey: 1000 + prodKey,
    SdateKey: 2000 + prodKey,
    shipmentDate: '2026-09-10',
    qty,
    unit: products.find(item => item.ProdKey === prodKey)?.OutUnit || '박스',
    ...overrides,
  };
}

function bindings({ groups, columns = ['sheet-a!B3'], extra = {} } = {}) {
  return {
    sheetScopes: {
      'sheet-a': {
        confirmed: true,
        groups: groups || [
          { country: '콜롬비아', flower: '수국' },
          { country: '콜롬비아', flower: '루스커스' },
        ],
      },
    },
    keymapBatch: { 'sheet-a': { confirmRows: true, confirmClients: true } },
    rowOverrides: {},
    columnOverrides: {},
    dateGroups: [{ columnIds: columns, shipmentDate: '2026-09-10', confirmed: true }],
    columnDateOverrides: {},
    unitAttestation: { originalExportUnitsPreserved: true },
    rowUnitOverrides: {},
    ...extra,
  };
}

function project(overrides = {}) {
  return reconcileDistributionBaseline({
    baseline: baseline(),
    bindings: {},
    products,
    customers,
    currentRows: [],
    currentComplete: true,
    ...overrides,
  });
}

function cell(result, rowId = 'sheet-a!A4', columnId = 'sheet-a!B3') {
  return result.sheets[0].cells.find(item => item.rowId === rowId && item.columnId === columnId);
}

assert.match('알스트로메리아', ALSTRO_RE);
assert.match('Premium Alstro', ALSTRO_RE);

{
  const rows = [
    current(11, 3),
    current(12, 1),
    current(13, 4),
    current(14, 8),
    current(11, 99, { year: '2025', SdetailKey: 901, SdateKey: 902 }),
    current(11, 99, { week: '37-02', SdetailKey: 903, SdateKey: 904 }),
  ];
  const result = project({ currentRows: rows });
  assert.deepEqual(result.sheetCandidates[0].groups.map(group => group.flower), ['수국', '루스커스']);
  assert.equal(result.sheetCandidates[0].state, 'TENTATIVE');
  assert.equal(result.sheetCandidates[0].source, 'ERP_CANDIDATE');
  assert.deepEqual(result.sheets[0].rows.slice(0, 2).map(row => row.id), ['sheet-a!A4', 'sheet-a!A5']);
  assert.equal(result.sheets[0].rows.find(row => row.prodKey === 13).origin, 'ERP_CANDIDATE');
  assert.equal(result.sheets[0].cells.some(item => item.state === 'ERP_CANDIDATE'), true,
    'unconfirmed appended cells must not be presented as ERP_ONLY');
  assert.equal(result.sheets[0].id, 'sheet-a');
  assert.equal(result.sheets[0].sheetId, undefined);
  assert.equal(result.sheets[0].cells.every(item => item.delta === null), true);
  assert.equal(result.unclassifiedCurrent.reduce((sum, item) => sum + item.duplicateCount, 0), 4,
    'unconfirmed candidate rows and outside-scope rows stay visible once; cross-year/subweek rows are excluded');
  assert.equal(result.unclassifiedCurrent.filter(item => item.issues.includes('UNCONFIRMED_SHEET_SCOPE')).length, 3);
}

{
  const result = project({ bindings: bindings(), currentRows: [current(11, 3), current(12, 1), current(13, 4), current(14, 8)] });
  assert.equal(result.sheetCandidates[0].state, 'CONFIRMED');
  assert.equal(cell(result).baselineQuantity, 2);
  assert.equal(cell(result).erpCurrentQuantity, 3);
  assert.equal(cell(result).delta, 1);
  assert.equal(result.sheets[0].rows.find(row => row.prodKey === 13).origin, 'ERP_ONLY');
  assert.deepEqual(result.unclassifiedCurrent.map(item => item.prodKey), [14]);
}

{
  const noBatch = bindings();
  noBatch.keymapBatch['sheet-a'].confirmRows = false;
  const result = project({ bindings: noBatch, currentRows: [current(11, 3)] });
  assert.equal(result.sheetCandidates[0].state, 'TENTATIVE');
  assert.equal(cell(result).delta, null);
  assert.ok(result.issues.some(item => item.code === 'UNVERIFIED_SCOPE_KEYMAP'));

  const wrongSet = bindings({ groups: [{ country: '콜롬비아', flower: '수국' }] });
  const mismatch = project({ bindings: wrongSet, currentRows: [current(11, 3)] });
  assert.equal(mismatch.sheetCandidates[0].state, 'TENTATIVE');
  assert.ok(mismatch.issues.some(item => item.code === 'SHEET_SCOPE_SET_MISMATCH'));
}

{
  const missingRawKey = baseline({ rows: [{ id: 'sheet-a!A4', label: '직접 연결', key: null, values: { 'sheet-a!B3': 2 } }] });
  const manual = bindings({
    groups: [{ country: '콜롬비아', flower: '수국' }],
    extra: { rowOverrides: { 'sheet-a!A4': { prodKey: 11, confirmed: true } } },
  });
  const result = project({ baseline: missingRawKey, bindings: manual, currentRows: [current(11, 3)] });
  assert.deepEqual(result.sheetCandidates[0].groups, []);
  assert.equal(result.sheetCandidates[0].state, 'TENTATIVE');
  assert.equal(cell(result).delta, null, 'a manual row override must not silently widen sheet scope');
}

{
  const incomplete = project({ bindings: bindings(), currentRows: [current(11, 3)], currentComplete: false });
  assert.equal(cell(incomplete).erpCurrentQuantity, 3);
  assert.equal(cell(incomplete).delta, null, 'an incomplete query cannot produce a delta even with observed contributions');
  const absent = cell(incomplete, 'sheet-a!A5');
  assert.equal(absent.erpCurrentQuantity, null, 'an incomplete query cannot infer absent current as zero');

  const complete = project({ bindings: bindings(), currentRows: [current(11, 3)] });
  assert.equal(cell(complete, 'sheet-a!A5').erpCurrentQuantity, 0);
  assert.equal(cell(complete, 'sheet-a!A5').delta, -1);
}

{
  const alstroBaseline = baseline({ rows: [{ id: 'sheet-a!A4', label: 'Alstro', key: 31, values: { 'sheet-a!B3': 2 } }] });
  const alstroProducts = [product(31, '기타', { ProdName: 'Premium Alstro', OutUnit: '송이' })];
  const result = project({
    baseline: alstroBaseline,
    products: alstroProducts,
    bindings: bindings({ groups: [{ country: '콜롬비아', flower: '기타' }] }),
    currentRows: [{ ...current(31, 32), unit: '송이' }],
  });
  assert.equal(cell(result).baselineQuantity, 32, 'exporter alstro reverse normalization is raw * 16');
  assert.equal(cell(result).delta, 0);
}

{
  const noUnitProducts = [product(11, '수국', { OutUnit: null }), product(12, '루스커스', { OutUnit: '단' })];
  const result = project({ bindings: bindings(), products: noUnitProducts, currentRows: [] });
  assert.equal(cell(result).baselineQuantity, null);
  assert.equal(cell(result).erpCurrentQuantity, null, 'unit attestation cannot infer zero without canonical OutUnit');
  assert.ok(cell(result).issues.includes('UNVERIFIED_UNIT'));
}

{
  const duplicateRows = baseline({ rows: [
    { id: 'sheet-a!A4', label: '수국 A', key: 11, values: { 'sheet-a!B3': 2 } },
    { id: 'sheet-a!A5', label: '수국 B', key: 11, values: { 'sheet-a!B3': 4 } },
  ] });
  const duplicateBindings = bindings({ groups: [{ country: '콜롬비아', flower: '수국' }] });
  const result = project({ baseline: duplicateRows, bindings: duplicateBindings, currentRows: [current(11, 3)] });
  for (const rowId of ['sheet-a!A4', 'sheet-a!A5']) {
    assert.ok(result.sheets[0].rows.find(row => row.id === rowId).issues.includes('DUPLICATE_BOUND_ROW'));
    assert.equal(cell(result, rowId).erpCurrentQuantity, null);
    assert.equal(cell(result, rowId).delta, null);
    assert.deepEqual(cell(result, rowId).contributions, []);
  }
  assert.equal(result.unclassifiedCurrent.length, 1);
  assert.ok(result.unclassifiedCurrent[0].issues.includes('DUPLICATE_BOUND_ROW'));
}

{
  const duplicateColumns = baseline({ clients: [
    { id: 'sheet-a!B3', label: '거래처 A-1', day: '목', key: 21 },
    { id: 'sheet-a!C3', label: '거래처 A-2', day: '목', key: 21 },
  ], rows: [{ id: 'sheet-a!A4', label: '수국 A', key: 11, values: { 'sheet-a!B3': 2, 'sheet-a!C3': 2 } }] });
  const result = project({
    baseline: duplicateColumns,
    bindings: bindings({ groups: [{ country: '콜롬비아', flower: '수국' }], columns: ['sheet-a!B3', 'sheet-a!C3'] }),
    currentRows: [current(11, 3)],
  });
  assert.equal(result.sheets[0].columns.every(column => column.issues.includes('DUPLICATE_BOUND_COLUMN')), true);
  assert.equal(result.sheets[0].cells.every(item => item.delta === null && item.erpCurrentQuantity === null), true);
}

{
  const first = current(11, 3);
  const second = { ...first, qty: 4 };
  const result = project({ bindings: bindings(), currentRows: [first, second] });
  assert.equal(cell(result).erpCurrentQuantity, null);
  assert.equal(cell(result).delta, null);
  assert.deepEqual(cell(result).contributions, []);
  assert.equal(result.unclassifiedCurrent[0].duplicateCount, 2);
  assert.equal(result.unclassifiedCurrent[0].qty, null);
  assert.ok(result.unclassifiedCurrent[0].issues.includes('DUPLICATE_CURRENT_IDENTITY'));
}

{
  const first = current(11, 3);
  const differentDateSameSixKeys = { ...first, shipmentDate: '2026-09-11', qty: 4 };
  const result = project({ bindings: bindings(), currentRows: [first, differentDateSameSixKeys] });
  const relatedCells = result.sheets[0].cells.filter(item => item.rowId === 'sheet-a!A4');
  assert.equal(relatedCells.every(item => item.erpCurrentQuantity === null && item.delta === null), true,
    'the exact six-key identity is duplicate even when observed shipment dates differ');
  assert.equal(relatedCells.every(item => item.contributions.length === 0), true);
  assert.equal(result.unclassifiedCurrent.length, 1);
  assert.equal(result.unclassifiedCurrent[0].duplicateCount, 2);
  assert.ok(result.unclassifiedCurrent[0].issues.includes('DUPLICATE_CURRENT_IDENTITY'));
}

{
  const combinedBaseline = baseline({ week: '37-02', coverage: 'combined', rows: [{ id: 'sheet-a!A4', label: '수국 A', key: 11, values: { 'sheet-a!B3': 5 } }] });
  const combinedBindings = bindings({ groups: [{ country: '콜롬비아', flower: '수국' }] });
  const rows = [
    current(11, 2, { year: 2026 }),
    current(11, 3, { year: 2026, week: '37-02', SdetailKey: 1112, SdateKey: 2112 }),
    current(11, 90, { year: 2025, SdetailKey: 1113, SdateKey: 2113 }),
    current(11, 90, { year: 2026, week: '37-03', SdetailKey: 1114, SdateKey: 2114 }),
  ];
  const result = project({ baseline: combinedBaseline, bindings: combinedBindings, currentRows: rows });
  assert.equal(cell(result).erpCurrentQuantity, 5);
  assert.equal(cell(result).delta, 0);
  assert.equal(cell(result).contributions.length, 2);
}

{
  const identityConversion = bindings({ extra: { rowUnitOverrides: { 'sheet-a!A4': { unit: '박스', confirmed: true } }, unitAttestation: { originalExportUnitsPreserved: false } } });
  const result = project({ bindings: identityConversion, currentRows: [current(11, 2)] });
  assert.equal(cell(result).baselineQuantity, 2, 'same-unit conversion does not require a conversion ratio');
  assert.equal(cell(result).delta, 0);
}

assert.throws(
  () => project({ bindings: { keymapBatch: [], dateGroups: [] } }),
  error => error instanceof BaselineReconciliationError && error.code === 'INVALID_BINDINGS',
);

assert.throws(
  () => project({ baseline: { ...baseline(), id: 'A'.repeat(64) } }),
  error => error instanceof BaselineReconciliationError && error.code === 'INVALID_BASELINE_ID',
);

console.log('distribution baseline reconciliation projector tests passed');
