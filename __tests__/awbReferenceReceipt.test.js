import test from 'node:test';
import assert from 'node:assert/strict';
import { extractAwbReferenceFromReceipts, isCostReferenceReceiptRows, isValidAwbCode } from '../lib/awbReferenceReceipt.js';
import { prepareNativeShared } from '../lib/nativeSharedCost.js';
import { createSharedAwbHandler } from '../lib/invoiceSharedAwbApi.js';
import { prepareColombiaWeekCost } from '../lib/colombiaWeekCostSource.js';
import { readNativeCostSource, nativeCostDocument, calculateNativeCost } from '../lib/nativeReceiptCost.js';
import { receiptFreightAmount, invoiceExpenseValues } from '../lib/invoiceReceiptExpenses.js';

const types = { Int: 'int', NVarChar: n => `nvarchar(${n})` };

test('extractAwbReferenceFromReceipts extracts Apollo GW, CW, summed freight+docFee, and stem share while blocking ambiguous duplicates', () => {
  const raw = [
    { WarehouseKey: 8205, OrderYear: '2026', OrderWeek: '48-01', OrderNo: '865-14699786', FarmName: 'Apollo', InvoiceNo: '콜카장', GrossWeight: null, ChargeableWeight: null, WdetailKey: 1, ProdKey: 2182, ProdName: '운송료', OutQuantity: 1, BoxQuantity: 1, BunchQuantity: 1, SteamQuantity: 1, UPrice: 27425.75, TPrice: 27425.75 },
    { WarehouseKey: 8205, OrderYear: '2026', OrderWeek: '48-01', OrderNo: '865-14699786', FarmName: 'Apollo', InvoiceNo: '콜카장', GrossWeight: null, ChargeableWeight: null, WdetailKey: 2, ProdKey: 2182, ProdName: '운송료', OutQuantity: 1, BoxQuantity: 1, BunchQuantity: 1, SteamQuantity: 1, UPrice: 70, TPrice: 70 },
    { WarehouseKey: 8205, OrderYear: '2026', OrderWeek: '48-01', OrderNo: '865-14699786', FarmName: 'Apollo', InvoiceNo: '콜카장', GrossWeight: null, ChargeableWeight: null, WdetailKey: 3, ProdKey: 3100, ProdName: 'Gross weight', OutQuantity: 9973, BoxQuantity: 1, BunchQuantity: 1, SteamQuantity: 9973, UPrice: 0, TPrice: 0 },
    { WarehouseKey: 8205, OrderYear: '2026', OrderWeek: '48-01', OrderNo: '865-14699786', FarmName: 'Apollo', InvoiceNo: '콜카장', GrossWeight: null, ChargeableWeight: null, WdetailKey: 4, ProdKey: 3101, ProdName: 'Chargeable weigth', OutQuantity: 9973, BoxQuantity: 1, BunchQuantity: 1, SteamQuantity: 9973, UPrice: 0, TPrice: 0 },
    { WarehouseKey: 8246, OrderYear: '2026', OrderWeek: '48-01', OrderNo: '86514699786', FarmName: 'Flores El Zorro', InvoiceNo: 'FZ-1', WdetailKey: 10, ProdKey: 1001, ProdName: 'CARNATION Red', CounName: '콜롬비아', FlowerName: '카네이션', OutUnit: '송이', BoxQuantity: 44, BunchQuantity: 660, SteamQuantity: 13200, OutQuantity: 13200, UPrice: 0.2, TPrice: 2640 },
    { WarehouseKey: 8247, OrderYear: '2026', OrderWeek: '48-01', OrderNo: '86514699786', FarmName: 'Ayura', InvoiceNo: 'AY-1', WdetailKey: 11, ProdKey: 1002, ProdName: 'ROSE White', CounName: '콜롬비아', FlowerName: '장미', OutUnit: '송이', BoxQuantity: 20, BunchQuantity: 200, SteamQuantity: 26800, OutQuantity: 26800, UPrice: 0.4, TPrice: 10720 },
  ];
  assert.equal(isValidAwbCode('865-14699786'), true);
  assert.equal(isValidAwbCode('12345'), false);
  assert.equal(isCostReferenceReceiptRows(raw.filter(r => r.WarehouseKey === 8205)), true);
  assert.equal(isCostReferenceReceiptRows(raw.filter(r => r.WarehouseKey === 8246)), false);

  const ref = extractAwbReferenceFromReceipts(raw, '865-14699786', { targetWarehouseKey: 8246 });
  assert.ok(ref);
  assert.equal(ref.warehouseKey, 8205);
  assert.equal(ref.gw, 9973);
  assert.equal(ref.cw, 9973);
  assert.equal(ref.freightAmount, 27495.75);
  assert.equal(ref.freightOnlyUSD, 27425.75);
  assert.equal(ref.docFeeUSD, 70);
  assert.ok(Math.abs(ref.freightRateUSD - 27425.75 / 9973) < 1e-5);
  assert.equal(ref.sharedGoodsReceiptCount, 2);
  assert.equal(ref.stemShareNumerator, 13200);
  assert.equal(ref.stemShareDenominator, 40000);
  assert.match(ref.sourceId, /#8205 Apollo/);

  // 48-02 #8289 Apollo pattern: row 1 has SteamQuantity === cw (4202, $11,513.48) and row 2 has SteamQuantity === 1 ($90.47)
  const apollo8289 = [
    { WarehouseKey: 8289, OrderYear: '2026', OrderWeek: '48-02', OrderNo: '992-04727833', FarmName: 'Apollo', InvoiceNo: '콜카장수국', WdetailKey: 51922, ProdKey: 3100, ProdName: 'Gross weight', OutQuantity: 3502, SteamQuantity: 3502, UPrice: 0, TPrice: 0 },
    { WarehouseKey: 8289, OrderYear: '2026', OrderWeek: '48-02', OrderNo: '992-04727833', FarmName: 'Apollo', InvoiceNo: '콜카장수국', WdetailKey: 51923, ProdKey: 3101, ProdName: 'Chargeable weight', OutQuantity: 4202, SteamQuantity: 4202, UPrice: 0, TPrice: 0 },
    { WarehouseKey: 8289, OrderYear: '2026', OrderWeek: '48-02', OrderNo: '992-04727833', FarmName: 'Apollo', InvoiceNo: '콜카장수국', WdetailKey: 51924, ProdKey: 2182, ProdName: '운송료', OutQuantity: 1, BunchQuantity: 4202, SteamQuantity: 4202, UPrice: 2.74, TPrice: 11513.48 },
    { WarehouseKey: 8289, OrderYear: '2026', OrderWeek: '48-02', OrderNo: '992-04727833', FarmName: 'Apollo', InvoiceNo: '콜카장수국', WdetailKey: 51925, ProdKey: 2182, ProdName: '운송료', OutQuantity: 1, BunchQuantity: 1, SteamQuantity: 1, UPrice: 90.47, TPrice: 90.47 },
  ];
  const ref8289 = extractAwbReferenceFromReceipts(apollo8289, '99204727833');
  assert.equal(ref8289.freightAmount, 11603.95);
  assert.equal(ref8289.freightOnlyUSD, 11513.48);
  assert.equal(ref8289.docFeeUSD, 90.47);
  assert.equal(ref8289.freightRateUSD, 2.74);

  // Near-miss: duplicate reference receipts for the same AWB return null instead of double-summing
  const duplicate = [...raw, { ...raw[0], WarehouseKey: 8999, WdetailKey: 99, TPrice: 500 }];
  assert.equal(extractAwbReferenceFromReceipts(duplicate, '865-14699786'), null);
  assert.equal(extractAwbReferenceFromReceipts(raw, '999-99999999'), null);
});

test('prepareNativeShared and prepareColombiaWeekCost attach awbReference without altering group confirmation or baselineDigest', async () => {
  const baseRows = [
    { WarehouseKey: 8204, OrderYear: '2026', OrderWeek: '48-01', OrderNo: '992-04728043', FarmName: 'Hydrangea Farm A', InvoiceNo: 'H-1', InputDate: '2026-11-20', GrossWeight: null, ChargeableWeight: null, WdetailKey: 21, ProdKey: 2001, ProdName: 'Hydrangea White', CounName: '콜롬비아', FlowerName: '수국', OutUnit: '송이', BoxQuantity: 10, BunchQuantity: 10, SteamQuantity: 400, OutQuantity: 400, UPrice: 0.7, TPrice: 280, SteamOf1Bunch: 1, SteamOf1Box: 40 },
  ];
  const apolloRows = [
    { WarehouseKey: 8203, OrderYear: '2026', OrderWeek: '48-01', OrderNo: '992-04728043', FarmName: 'Apollo', InvoiceNo: '콜수국', InputDate: '2026-11-20', GrossWeight: 2752, ChargeableWeight: 3509, WdetailKey: 31, ProdKey: 2182, ProdName: '운송료', CounName: null, FlowerName: null, OutUnit: '박스', BoxQuantity: 1, BunchQuantity: 1, SteamQuantity: 1, OutQuantity: 1, UPrice: 10000.65, TPrice: 10000.65, SteamOf1Bunch: 1, SteamOf1Box: 1 },
    { WarehouseKey: 8203, OrderYear: '2026', OrderWeek: '48-01', OrderNo: '992-04728043', FarmName: 'Apollo', InvoiceNo: '콜수국', InputDate: '2026-11-20', GrossWeight: 2752, ChargeableWeight: 3509, WdetailKey: 32, ProdKey: 2182, ProdName: '운송료', CounName: null, FlowerName: null, OutUnit: '박스', BoxQuantity: 1, BunchQuantity: 1, SteamQuantity: 1, OutQuantity: 1, UPrice: 90, TPrice: 90, SteamOf1Bunch: 1, SteamOf1Box: 1 },
  ];
  const withoutApollo = await prepareNativeShared({
    queryFn: async () => ({ recordset: baseRows }),
    types,
    request: { orderYear: '2026', orderWeek: '48-01', awb: '992-04728043', scope: 'HYDRANGEA' },
  });
  const withApollo = await prepareNativeShared({
    queryFn: async () => ({ recordset: [...baseRows, ...apolloRows] }),
    types,
    request: { orderYear: '2026', orderWeek: '48-01', awb: '992-04728043', scope: 'HYDRANGEA' },
  });
  assert.equal(withApollo.baselineDigest, withoutApollo.baselineDigest);
  assert.equal(withApollo.members[0].lineInputs[0].groupId, '');
  assert.equal(withApollo.members[0].lineInputs[0].suggestedGroupId, 'HYDRANGEA');
  assert.equal(withApollo.awbReference?.gw, 2752);
  assert.equal(withApollo.awbReference?.cw, 3509);
  assert.equal(withApollo.awbReference?.freightAmount, 10090.65);

  const apiRes = { code: 200, setHeader() {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await createSharedAwbHandler({
    authorize: () => true,
    prepare: prepareNativeShared,
    queryFn: async () => ({ recordset: [...baseRows, ...apolloRows] }),
    types,
  })({ method: 'POST', user: {}, body: { action: 'prepare', orderYear: '2026', orderWeek: '48-01', awb: '992-04728043', scope: 'HYDRANGEA' } }, apiRes);
  assert.equal(apiRes.code, 200);
  assert.equal(apiRes.body?.awbReference?.gw, 2752);
  assert.equal(apiRes.body?.awbReference?.cw, 3509);
  assert.equal(apiRes.body?.awbReference?.freightAmount, 10090.65);

  const weekPrepared = await prepareColombiaWeekCost({
    queryFn: async () => ({ recordset: [...baseRows, ...apolloRows] }),
    types,
    request: { country: 'CO', orderYear: '2026', orderWeek: '48-01', selectedKeys: [8204] },
  });
  assert.equal(weekPrepared.awbs.length, 1);
  assert.equal(weekPrepared.awbs[0].awbReference?.freightAmount, 10090.65);
  assert.equal(weekPrepared.awbs[0].awbReference?.gw, 2752);
  assert.equal(weekPrepared.awbs[0].awbReference?.cw, 3509);
});

test('EC native receipt auto-links 1:1 Apollo AWB weights/freight and reconciles ERP placeholder SteamOf1Bunch=1', async () => {
  const weekDataset = [
    { WarehouseKey: 8189, OrderYear: '2026', OrderWeek: '47-01', OrderNo: '00645556571', FarmName: 'Mystic Flowers', InvoiceNo: 'MF-8189', FileName: 'ec.xlsx', InputDate: '2026-11-18', GrossWeight: null, ChargeableWeight: null, WdetailKey: 501, ProdKey: 3001, OrderCode: '1', BoxQuantity: 18, BunchQuantity: 450, SteamQuantity: 11250, OutQuantity: 450, UPrice: 0.2, TPrice: 2250, SteamOf1Bunch: 1, SteamOf1Box: 1, ProdName: 'GYPSOPHILA Million Stars', CounName: '에콰도르', FlowerName: '안개꽃', OutUnit: '단', TariffRate: null, ProductDeleted: 0 },
    { WarehouseKey: 8190, OrderYear: '2026', OrderWeek: '47-01', OrderNo: '006-45556571', FarmName: 'Apollo', InvoiceNo: '에콰', FileName: 'apollo-ec.xlsx', InputDate: '2026-11-18', GrossWeight: null, ChargeableWeight: null, WdetailKey: 502, ProdKey: 2182, BoxQuantity: 1, BunchQuantity: 1, SteamQuantity: 1, OutQuantity: 1, UPrice: 3070.07, TPrice: 3070.07, SteamOf1Bunch: 1, SteamOf1Box: 1, ProdName: '운송료', CounName: null },
    { WarehouseKey: 8190, OrderYear: '2026', OrderWeek: '47-01', OrderNo: '006-45556571', FarmName: 'Apollo', InvoiceNo: '에콰', FileName: 'apollo-ec.xlsx', InputDate: '2026-11-18', GrossWeight: null, ChargeableWeight: null, WdetailKey: 503, ProdKey: 2182, BoxQuantity: 1, BunchQuantity: 1, SteamQuantity: 1, OutQuantity: 1, UPrice: 91, TPrice: 91, SteamOf1Bunch: 1, SteamOf1Box: 1, ProdName: '운송료', CounName: null },
    { WarehouseKey: 8190, OrderYear: '2026', OrderWeek: '47-01', OrderNo: '006-45556571', FarmName: 'Apollo', InvoiceNo: '에콰', FileName: 'apollo-ec.xlsx', InputDate: '2026-11-18', GrossWeight: null, ChargeableWeight: null, WdetailKey: 504, ProdKey: 3100, BoxQuantity: 1, BunchQuantity: 1, SteamQuantity: 768, OutQuantity: 768, UPrice: 0, TPrice: 0, SteamOf1Bunch: 1, SteamOf1Box: 1, ProdName: 'Gross weight', CounName: null },
    { WarehouseKey: 8190, OrderYear: '2026', OrderWeek: '47-01', OrderNo: '006-45556571', FarmName: 'Apollo', InvoiceNo: '에콰', FileName: 'apollo-ec.xlsx', InputDate: '2026-11-18', GrossWeight: null, ChargeableWeight: null, WdetailKey: 505, ProdKey: 3101, BoxQuantity: 1, BunchQuantity: 1, SteamQuantity: 911, OutQuantity: 911, UPrice: 0, TPrice: 0, SteamOf1Bunch: 1, SteamOf1Box: 1, ProdName: 'Chargeable weight', CounName: null },
  ];
  const queryFn = async (sql, params) => {
    assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|EXEC|MERGE)\b/i);
    if (sql.includes('invoice-expenses:committed-scope')) return { recordset: [] };
    if (sql.includes('native-awb-reference:readonly-source')) {
      return { recordset: weekDataset.filter(r => r.OrderYear === params.orderYear.value && r.OrderWeek === params.orderWeek.value) };
    }
    return { recordset: weekDataset.filter(r => r.WarehouseKey === params.warehouseKey.value && r.OrderYear === params.orderYear.value && r.OrderWeek === params.orderWeek.value) };
  };
  const source = await readNativeCostSource({ queryFn, types, input: { orderYear: '2026', orderWeek: '47-01', warehouseKey: 8189 } });
  assert.equal(source.gw, 768);
  assert.equal(source.cw, 911);
  assert.equal(source.awbReference?.freightAmount, 3161.07);
  const doc = nativeCostDocument(source, { currency: 'USD', transportMode: 'AIR' });
  const costInput = doc.reviewedMetadata.invoiceCostInput;
  assert.equal(costInput.freightAmount, 3161.07);
  assert.equal(costInput.lineInputs[0].stemsPerBunch, 25);
  assert.equal(costInput.lineInputs[0].bunchesPerBox, 25);

  const calc = calculateNativeCost(source, {
    sourceHash: source.sourceHash,
    metadata: { currency: 'USD', transportMode: 'AIR', gw: source.gw, cw: source.cw },
    input: {
      ...costInput,
      formulaId: 'EC_FOB_STEM_V1',
      formulaVersion: '1.0.0',
      formulaSourceHash: '9f889056cbed364d30b20edd51cc803f2ba8a4c789ac17cf9908ab80976406eb',
      formulaSourceSheet: '40-2',
      formulaSourceCells: 'C7,C10,C11,P10,E14:O27',
      formulaApplicabilityConfirmed: true,
      exchangeRateKRW: 1450,
      customsTotalKRW: 508280,
      lineInputs: [{ ...costInput.lineInputs[0], tariffRate: 0.25 }],
    },
  });
  assert.equal(calc.preview.status, 'APPROVED', JSON.stringify(calc.preview.issues));
});

test('non-NL WebInvoiceDocument freight and positive own freight rows auto-populate while 0-amount CN_SEA placeholder freight stays empty', () => {
  const thDoc = { lines: [{ currency: 'USD' }], reviewedMetadata: { transportMode: 'AIR', costInputs: { freight: { amount: 820, currency: 'USD' } } } };
  const thValues = invoiceExpenseValues(thDoc);
  const thSource = { country: 'TH', orderYear: '2026', orderWeek: '47-01', warehouseKey: 8198, receiptExpenses: { ...thValues, verified: true, orderYear: '2026', orderWeek: '47-01', warehouseKey: 8198 } };
  assert.equal(receiptFreightAmount(thSource, null), 820);
  assert.throws(() => receiptFreightAmount({ ...thSource, receiptExpenses: { ...thSource.receiptExpenses, entries: [{ kind: 'freight', currency: 'EUR', amount: 100 }] } }, null), /통화/);

  // CN_SEA receipt with template 0-yuan 운송료 row must NOT invent freightAmount=0
  const cnSeaZeroPlaceholder = nativeCostDocument({
    warehouseKey: 8259, orderYear: '2026', orderWeek: '48-01', country: 'CN', farmName: 'HUBFRESH', invoiceNo: 'HF-1', inputDate: '2026-11-20',
    excluded: [{ key: 1, name: '운송료', quantity: 0, amount: 0 }, { key: 2, name: '(공란·비상품 행)', quantity: null, amount: 0 }],
    lines: [{ lineId: '00000000-0000-5000-a000-000000000001', prodKey: 101, originalName: 'CARNATION', outQuantity: 100, outUnit: '단', bunchQuantity: 100, stemQuantity: 2000, unitPrice: 5, lineAmount: 500, stemsPerBunch: 20 }],
  }, { currency: 'CNY', transportMode: 'SEA' });
  assert.equal(cnSeaZeroPlaceholder.reviewedMetadata.invoiceCostInput.freightAmount, undefined);

  // CO native receipt gets 0% FTA tariff default
  const coDoc = nativeCostDocument({
    warehouseKey: 8246, orderYear: '2026', orderWeek: '48-01', country: 'CO', farmName: 'Flores El Zorro', invoiceNo: 'FZ-1', inputDate: '2026-11-20',
    excluded: [],
    lines: [{ lineId: '00000000-0000-5000-a000-000000000002', prodKey: 202, originalName: 'CARNATION Red', outQuantity: 660, outUnit: '단', boxQuantity: 44, bunchQuantity: 660, stemQuantity: 13200, unitPrice: 0.2, lineAmount: 2640, stemsPerBunch: 20, stemsPerBox: 300 }],
  }, { currency: 'USD', transportMode: 'AIR' });
  assert.equal(coDoc.reviewedMetadata.invoiceCostInput.lineInputs[0].tariffRate, 0);
  assert.match(coDoc.reviewedMetadata.tariffDefaults['00000000-0000-5000-a000-000000000002'].label, /콜롬비아 기본 0%/);
});
