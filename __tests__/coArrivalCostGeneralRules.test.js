import test from 'node:test';
import assert from 'node:assert/strict';
import XLSX from 'xlsx';
import {
  isInheritableOriginValue,
  isChinaMasterPollutedAsColombia,
  resolveInheritedRowCountries,
  resolveColombiaStemsPerBunch,
} from '../lib/receiptOriginInheritance.js';
import { prepareNativeShared } from '../lib/nativeSharedCost.js';
import { createSharedAwbHandler } from '../lib/invoiceSharedAwbApi.js';
import { prepareArrivalWeekCost, calculateArrivalWeekCost } from '../lib/arrivalWeekCost.js';
import { readNativeCostSource, nativeCostDocument, calculateNativeCost } from '../lib/nativeReceiptCost.js';
import { createNativeCostWorkbook } from '../lib/invoiceReceiptCostExport.js';
import { costWarehouseDisplay, listCostWarehouse } from '../lib/invoiceWarehouseBrowse.js';

const types = { Int: 'int', NVarChar: n => `nvarchar(${n})`, Char: n => `char(${n})`, VarChar: n => `varchar(${n})` };
const mockRes = () => ({
  code: 200,
  headers: {},
  setHeader(k, v) { this.headers[k] = v; },
  status(c) { this.code = c; return this; },
  json(d) { this.data = d; return this; },
  send(b) { this.body = b; return this; },
});

test('1. 원산지 상속 및 중국 [MEL]/[오경] CHINA 마스터 오염 방어', async () => {
  assert.equal(isInheritableOriginValue('사용금지'), true);
  assert.equal(isInheritableOriginValue('단종'), true);
  assert.equal(isInheritableOriginValue('  '), true);
  assert.equal(isInheritableOriginValue(null), true);
  assert.equal(isInheritableOriginValue('네덜란드'), false);
  assert.equal(isInheritableOriginValue('국내'), false);

  assert.equal(isChinaMasterPollutedAsColombia({
    ProdName: '[MEL] ROSE CHINA / 카롤라 (Carola)',
    FlowerName: '아나나스',
    CounName: '콜롬비아',
  }), true);
  assert.equal(isChinaMasterPollutedAsColombia({
    ProdName: '[오경] ROSE CHINA / 만달라(Mandala)',
    FlowerName: '아나나스',
    CounName: '콜롬비아',
  }), true);
  assert.equal(isChinaMasterPollutedAsColombia({
    ProdName: 'ROSE / Mondial White 60cm',
    FlowerName: '장미',
    CounName: '콜롬비아',
  }), false);

  const raw = [
    // 동일 입고 내 '콜롬비아' + '사용금지' + '단종' + 공란
    { WarehouseKey: 8162, OrderYear: '2026', OrderWeek: '47-02', OrderNo: '992-04727822', WdetailKey: 1, ProdKey: 888, ProdName: 'Hydrangea tinted Lavender', FlowerName: '수국', CounName: '사용금지', SteamQuantity: 120, TPrice: 108 },
    { WarehouseKey: 8162, OrderYear: '2026', OrderWeek: '47-02', OrderNo: '992-04727822', WdetailKey: 2, ProdKey: 868, ProdName: 'Hydrangea Dark Pink', FlowerName: '수국', CounName: '콜롬비아', SteamQuantity: 270, TPrice: 243 },
    { WarehouseKey: 8162, OrderYear: '2026', OrderWeek: '47-02', OrderNo: '992-04727822', WdetailKey: 3, ProdKey: 999, ProdName: 'Hydrangea Discontinued', FlowerName: '수국', CounName: '단종', SteamQuantity: 60, TPrice: 54 },
    { WarehouseKey: 8162, OrderYear: '2026', OrderWeek: '47-02', OrderNo: '992-04727822', WdetailKey: 4, ProdKey: 1000, ProdName: 'Hydrangea BlankOrigin', FlowerName: '수국', CounName: '', SteamQuantity: 30, TPrice: 27 },
    // 입고 내 모든 행이 '사용금지'이지만 동일 AWB의 다른 농장(#8162)이 '콜롬비아'인 경우 AWB 상속
    { WarehouseKey: 8163, OrderYear: '2026', OrderWeek: '47-02', OrderNo: '99204727822', WdetailKey: 5, ProdKey: 3498, ProdName: 'Hydrangea light pink', FlowerName: '수국', CounName: '사용금지', SteamQuantity: 750, TPrice: 675 },
    // 중국 마스터 오등록 품목
    { WarehouseKey: 5100, OrderYear: '2026', OrderWeek: '47-02', OrderNo: '784-12345678', WdetailKey: 6, ProdKey: 2738, ProdName: '[MEL] ROSE CHINA / 카롤라 (Carola)', FlowerName: '아나나스', CounName: '콜롬비아', SteamQuantity: 200, TPrice: 400 },
  ];
  const { rowCountryOf } = resolveInheritedRowCountries(raw);
  assert.equal(rowCountryOf(raw[0]), '콜롬비아');
  assert.equal(rowCountryOf(raw[2]), '콜롬비아');
  assert.equal(rowCountryOf(raw[3]), '콜롬비아');
  assert.equal(rowCountryOf(raw[4]), '콜롬비아');
  assert.equal(rowCountryOf(raw[5]), '중국');

  // listCostWarehouse / costWarehouseDisplay 반영 확인
  assert.equal(costWarehouseDisplay({
    CostProductRows: JSON.stringify([
      { ProdName: '[MEL] ROSE CHINA / 카롤라', FlowerName: '아나나스', CounName: '콜롬비아' },
    ]),
  }).CountryName, '중국');

  const browse = await listCostWarehouse({
    types,
    input: { orderYear: '2026', orderWeek: '47-02' },
    queryFn: async () => ({
      recordset: [
        { WarehouseKey: 8162, OrderYear: '2026', OrderWeek: '47-02', OrderNo: '992-04727822', CostProductRows: JSON.stringify([{ ProdName: 'Hydrangea Dark Pink', CounName: '콜롬비아', FlowerName: '수국' }]) },
        { WarehouseKey: 8163, OrderYear: '2026', OrderWeek: '47-02', OrderNo: '99204727822', CostProductRows: JSON.stringify([{ ProdName: 'Hydrangea light pink', CounName: '사용금지', FlowerName: '수국' }]) },
      ],
    }),
  });
  assert.equal(browse.rows.find(r => r.WarehouseKey === 8163).CountryName, '콜롬비아');
});

test('2 & 3 & 5. 혼적 AWB ALL(통합 5품종) 스코프, 200% 이중계상 차단, SteamOf1Bunch=NULL/0 보완, 404 폴백 및 미매핑 유상행 경고', async () => {
  const mixedRows = [
    // Apollo 혼적 참고입고
    { WarehouseKey: 8194, OrderYear: '2026', OrderWeek: '47-02', OrderNo: '992-04727822', FarmName: 'Apollo', InvoiceNo: '콜카장수국', InputDate: '2026-11-22', WdetailKey: 1, ProdKey: 2182, ProdName: '운송료', OutQuantity: 1, SteamQuantity: 1, UPrice: 10362.28, TPrice: 10362.28 },
    { WarehouseKey: 8194, OrderYear: '2026', OrderWeek: '47-02', OrderNo: '992-04727822', FarmName: 'Apollo', InvoiceNo: '콜카장수국', InputDate: '2026-11-22', WdetailKey: 2, ProdKey: 2182, ProdName: '운송료', OutQuantity: 1, SteamQuantity: 1, UPrice: 78.91, TPrice: 78.91 },
    { WarehouseKey: 8194, OrderYear: '2026', OrderWeek: '47-02', OrderNo: '992-04727822', FarmName: 'Apollo', InvoiceNo: '콜카장수국', InputDate: '2026-11-22', WdetailKey: 3, ProdKey: 3100, ProdName: 'Gross weight', OutQuantity: 3148, SteamQuantity: 3148, UPrice: 0, TPrice: 0 },
    { WarehouseKey: 8194, OrderYear: '2026', OrderWeek: '47-02', OrderNo: '992-04727822', FarmName: 'Apollo', InvoiceNo: '콜카장수국', InputDate: '2026-11-22', WdetailKey: 4, ProdKey: 3101, ProdName: 'Chargeable weight', OutQuantity: 3786, SteamQuantity: 3786, UPrice: 0, TPrice: 0 },
    // 수국 농장 ('사용금지' 품목 + wd.SteamOf1Bunch=null, p.SteamOf1Bunch=0)
    { WarehouseKey: 8162, OrderYear: '2026', OrderWeek: '47-02', OrderNo: '99204727822', FarmName: 'Balverde', InvoiceNo: '25587', InputDate: '2026-11-22', WdetailKey: 10, ProdKey: 888, ProdName: 'Hydrangea tinted Lavender', FlowerName: '수국', CounName: '사용금지', OutUnit: '박스', BoxQuantity: 4, BunchQuantity: null, SteamQuantity: 120, OutQuantity: 4, UPrice: 0.9, TPrice: 108, SteamOf1Bunch: null, SteamOf1Box: null, ProductSteamOf1Bunch: 0, ProductSteamOf1Box: 30 },
    { WarehouseKey: 8162, OrderYear: '2026', OrderWeek: '47-02', OrderNo: '99204727822', FarmName: 'Balverde', InvoiceNo: '25587', InputDate: '2026-11-22', WdetailKey: 11, ProdKey: 868, ProdName: 'Hydrangea Dark Pink', FlowerName: '수국', CounName: '콜롬비아', OutUnit: '박스', BoxQuantity: 6, BunchQuantity: 0, SteamQuantity: 180, OutQuantity: 6, UPrice: 0.9, TPrice: 162, SteamOf1Bunch: 0, SteamOf1Box: 0, ProductSteamOf1Bunch: 0, ProductSteamOf1Box: 30 },
    // 카네이션 농장 (wd.SteamOf1Bunch=null이나 p.SteamOf1Bunch=20 + 미매핑 유상행 1건)
    { WarehouseKey: 8170, OrderYear: '2026', OrderWeek: '47-02', OrderNo: '99204727822', FarmName: 'Ayura', InvoiceNo: '17999', InputDate: '2026-11-22', WdetailKey: 20, ProdKey: 3513, ProdName: 'CARNATION Vintage Honey', FlowerName: '카네이션', CounName: '콜롬비아', OutUnit: '박스', BoxQuantity: 10, BunchQuantity: 0, SteamQuantity: 3000, OutQuantity: 10, UPrice: 0.215, TPrice: 645, SteamOf1Bunch: null, SteamOf1Box: null, ProductSteamOf1Bunch: 20, ProductSteamOf1Box: 300 },
    { WarehouseKey: 8170, OrderYear: '2026', OrderWeek: '47-02', OrderNo: '99204727822', FarmName: 'Ayura', InvoiceNo: '17999', InputDate: '2026-11-22', WdetailKey: 21, ProdKey: null, ProdName: null, FlowerName: null, CounName: null, OutUnit: null, BoxQuantity: 1, BunchQuantity: 15, SteamQuantity: 300, OutQuantity: null, UPrice: 0.215, TPrice: 64.5, SteamOf1Bunch: 20, SteamOf1Box: 300 },
  ];

  const queryFn = async (sql) => {
    assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|MERGE|EXEC)\b/i);
    return { recordset: mixedRows };
  };

  // 부분 스코프(MAIN) 선택 시: 혼적 AWB 감지 및 전체 AWB 운임 자동대입 차단
  const partialMain = await prepareNativeShared({
    queryFn, types,
    request: { orderYear: '2026', orderWeek: '47-02', awb: '992-04727822', scope: 'MAIN' },
  });
  assert.equal(partialMain.awbScopeSummary.mixedAwb, true);
  assert.equal(partialMain.awbScopeSummary.partialScopeOfMixedAwb, true);
  assert.equal(partialMain.awbReference, undefined);
  assert.equal(partialMain.mixedAwbReference?.freightAmount, 10441.19);
  assert.equal(partialMain.unmappedPaidRows.length, 1);
  assert.equal(partialMain.unmappedPaidRows[0].wdetailKey, 21);

  // ALL(통합 5품종) 스코프 선택 시: 전체 농장 통합 + 1회 awbReference 반영 + 단당 송이수 자동 보완 + .xlsx 200 OK
  const handler = createSharedAwbHandler({ authorize: () => true, prepare: prepareNativeShared, queryFn, types });
  const prepRes = mockRes();
  await handler({ method: 'POST', user: {}, body: { action: 'prepare', orderYear: '2026', orderWeek: '47-02', awb: '992-04727822', scope: 'ALL' } }, prepRes);
  assert.equal(prepRes.code, 200);
  assert.equal(prepRes.data.members.length, 2);
  assert.equal(prepRes.data.awbReference?.freightAmount, 10441.19);
  assert.equal(prepRes.data.unmappedPaidRows.length, 1);

  const lineInputs = prepRes.data.members.flatMap(m => m.lineInputs.map(l => ({ ...l, groupId: l.suggestedGroupId })));
  assert.deepEqual(lineInputs.map(l => l.stemsPerBunch), [1, 1, 20]);

  const dlRes = mockRes();
  await handler({
    method: 'POST',
    user: {},
    body: {
      action: 'download',
      orderYear: '2026',
      orderWeek: '47-02',
      awb: '992-04727822',
      scope: 'ALL',
      baselineDigest: prepRes.data.baselineDigest,
      completeManifestConfirmed: true,
      lineInputs,
      input: {
        gw: 3148,
        cw: 3786,
        freightAmount: 10441.19,
        freightCurrency: 'USD',
        exchangeRate: 1400,
        customsMode: 'FORMULA',
        exchangeRateType: 'TEST_ONLY',
        fullBoxCounts: { HYDRANGEA: 10, CARNATION: 5 },
      },
    },
  }, dlRes);
  assert.equal(dlRes.code, 200, JSON.stringify(dlRes.data));
  const wb = XLSX.read(dlRes.body, { cellFormula: true });
  assert.deepEqual(wb.SheetNames, ['47-2']);
  const sheet = wb.Sheets['47-2'];
  assert.equal(sheet.N15.v, 1);
  assert.equal(sheet.N16.v, 1);
  assert.equal(sheet.N17.v, 20);
  assert.ok(Math.abs(sheet.AL12.v - sheet.AL4.v) < 1e-6);

  // 수국 전용 AWB를 MAIN으로 조회했을 때 503이 아닌 404를 반환해야 MAIN -> HYDRANGEA 자동 폴백이 작동함
  const hyOnlyRows = mixedRows.filter(r => r.WarehouseKey === 8162);
  const hyHandler = createSharedAwbHandler({ authorize: () => true, prepare: prepareNativeShared, queryFn: async () => ({ recordset: hyOnlyRows }), types });
  const fallbackRes = mockRes();
  await hyHandler({ method: 'POST', user: {}, body: { action: 'prepare', orderYear: '2026', orderWeek: '47-02', awb: '992-04727822', scope: 'MAIN' } }, fallbackRes);
  assert.equal(fallbackRes.code, 404);
});

test('4. 소매형(BoxQuantity=0) 농장 송장 계산·다운로드 및 농장 부대비($15) + Apollo 공동운임 분리 합산', async () => {
  const weekDataset = [
    // Apollo 공동 AWB 참고입고
    { WarehouseKey: 8205, OrderYear: '2026', OrderWeek: '48-01', OrderNo: '865-14699786', FarmName: 'Apollo', InvoiceNo: '콜카장', WdetailKey: 1, ProdKey: 2182, ProdName: '운송료', OutQuantity: 1, SteamQuantity: 1, UPrice: 27425.75, TPrice: 27425.75 },
    { WarehouseKey: 8205, OrderYear: '2026', OrderWeek: '48-01', OrderNo: '865-14699786', FarmName: 'Apollo', InvoiceNo: '콜카장', WdetailKey: 2, ProdKey: 2182, ProdName: '운송료', OutQuantity: 1, SteamQuantity: 1, UPrice: 70, TPrice: 70 },
    { WarehouseKey: 8205, OrderYear: '2026', OrderWeek: '48-01', OrderNo: '865-14699786', FarmName: 'Apollo', InvoiceNo: '콜카장', WdetailKey: 3, ProdKey: 3100, ProdName: 'Gross weight', OutQuantity: 1000, SteamQuantity: 1000, UPrice: 0, TPrice: 0 },
    { WarehouseKey: 8205, OrderYear: '2026', OrderWeek: '48-01', OrderNo: '865-14699786', FarmName: 'Apollo', InvoiceNo: '콜카장', WdetailKey: 4, ProdKey: 3101, ProdName: 'Chargeable weight', OutQuantity: 1000, SteamQuantity: 1000, UPrice: 0, TPrice: 0 },
    // #8221 Esperance Roses: 전 행 BoxQuantity=0 단일 품종(ROSE) + 농장 자체 부대비 $15 포함
    { WarehouseKey: 8221, OrderYear: '2026', OrderWeek: '48-01', OrderNo: '86514699786', FarmName: 'Esperance Roses', InvoiceNo: 'FEER 4378', InputDate: '2026-11-25', GrossWeight: null, ChargeableWeight: null, WdetailKey: 10, ProdKey: 201, ProdName: 'ROSE / Mondial White 60cm', CounName: '콜롬비아', FlowerName: '장미', OutUnit: '송이', BoxQuantity: 0, BunchQuantity: 0, SteamQuantity: 800, OutQuantity: 800, UPrice: 0.5, TPrice: 400, SteamOf1Bunch: 0, SteamOf1Box: 0, ProductSteamOf1Bunch: 0, ProductSteamOf1Box: 0, TariffRate: null, ProductDeleted: 0 },
    { WarehouseKey: 8221, OrderYear: '2026', OrderWeek: '48-01', OrderNo: '86514699786', FarmName: 'Esperance Roses', InvoiceNo: 'FEER 4378', InputDate: '2026-11-25', GrossWeight: null, ChargeableWeight: null, WdetailKey: 11, ProdKey: 202, ProdName: 'ROSE / Pink Floyd 60cm', CounName: '콜롬비아', FlowerName: '장미', OutUnit: '송이', BoxQuantity: 0, BunchQuantity: 0, SteamQuantity: 200, OutQuantity: 200, UPrice: 0.6, TPrice: 120, SteamOf1Bunch: 0, SteamOf1Box: 0, ProductSteamOf1Bunch: 0, ProductSteamOf1Box: 0, TariffRate: null, ProductDeleted: 0 },
    { WarehouseKey: 8221, OrderYear: '2026', OrderWeek: '48-01', OrderNo: '86514699786', FarmName: 'Esperance Roses', InvoiceNo: 'FEER 4378', InputDate: '2026-11-25', GrossWeight: null, ChargeableWeight: null, WdetailKey: 12, ProdKey: 2182, ProdName: '운송료', CounName: '콜롬비아', FlowerName: '기타', OutUnit: '박스', BoxQuantity: 0, BunchQuantity: 0, SteamQuantity: 1, OutQuantity: 1, UPrice: 15, TPrice: 15, SteamOf1Bunch: 1, SteamOf1Box: 1, ProductDeleted: 0 },
    // 동일 AWB 다른 농장 (9,000송이 → 전체 10,000송이 중 #8221 비중 10%)
    { WarehouseKey: 8222, OrderYear: '2026', OrderWeek: '48-01', OrderNo: '86514699786', FarmName: 'Ayura', InvoiceNo: 'AY-2', InputDate: '2026-11-25', WdetailKey: 20, ProdKey: 301, ProdName: 'CARNATION Red', CounName: '콜롬비아', FlowerName: '카네이션', OutUnit: '박스', BoxQuantity: 30, BunchQuantity: 450, SteamQuantity: 9000, OutQuantity: 30, UPrice: 0.2, TPrice: 1800, SteamOf1Bunch: 20, SteamOf1Box: 300 },
  ];

  const queryFn = async (sql, params) => {
    assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|MERGE|EXEC)\b/i);
    if (sql.includes('invoice-expenses:committed-scope')) return { recordset: [] };
    if (sql.includes('native-awb-reference:readonly-source')) {
      return { recordset: weekDataset.filter(r => r.OrderYear === params.orderYear.value && r.OrderWeek === params.orderWeek.value) };
    }
    return { recordset: weekDataset.filter(r => r.WarehouseKey === params.warehouseKey.value && r.OrderYear === params.orderYear.value && r.OrderWeek === params.orderWeek.value) };
  };

  const source = await readNativeCostSource({ queryFn, types, input: { orderYear: '2026', orderWeek: '48-01', warehouseKey: 8221 } });
  const doc = nativeCostDocument(source, { currency: 'USD', transportMode: 'AIR' });
  const breakdown = doc.reviewedMetadata.freightBreakdown;
  assert.ok(breakdown, 'Expected freightBreakdown separating shared AWB freight and farm embedded fee');
  assert.equal(breakdown.sharedAwbFreight, 2749.575); // 27495.75 * (1000 / 10000)
  assert.equal(breakdown.farmEmbeddedFee, 15);
  assert.equal(doc.reviewedMetadata.invoiceCostInput.freightAmount, 2764.575);

  // BoxQuantity=0 단일 품종군(ROSE) 송이 비중 배분 계산 및 엑셀 수식 무결성(AL12 == AL4)
  const calc = calculateNativeCost(source, {
    sourceHash: source.sourceHash,
    metadata: { currency: 'USD', transportMode: 'AIR', gw: source.gw, cw: source.cw },
    input: {
      ...doc.reviewedMetadata.invoiceCostInput,
      formulaId: 'CO_GROUP_42_1_V1',
      formulaVersion: '1.0.0',
      formulaSourceHash: 'd5f71f57a93d3006bb889321d00e249592ab136b855f3f20a4b2b693f78a8da3',
      formulaSourceSheet: '42-1',
      formulaSourceCells: 'K7:M11,T7:U11,AA8:AI12,G265:O301',
      formulaApplicabilityConfirmed: true,
      exchangeRateKRW: 1400,
      exchangeRateType: 'TEST_ONLY',
      customsTotalKRW: 100 * 460 + 33000 + 10000 + 99000 + 40000,
      costGroups: [{ groupId: 'ROSE', quantity: 1000, boxQuantity: 0, grossWeightKg: source.gw, volumeWeightKg: source.cw }],
      lineInputs: doc.reviewedMetadata.invoiceCostInput.lineInputs.map(l => ({ ...l, groupId: 'ROSE', tariffRate: 0 })),
    },
  });
  assert.equal(calc.preview.status, 'APPROVED', JSON.stringify(calc.preview.issues));
  const xlsxBytes = await createNativeCostWorkbook(calc);
  const wb = XLSX.read(xlsxBytes, { cellFormula: true });
  assert.deepEqual(wb.SheetNames, ['48-1']);
  const orig = wb.Sheets['48-1'];
  assert.equal(orig.AD8.f, 'IF($C$10=0,0,L7/$C$10)');
  assert.equal(orig.AD8.v, 1);
  assert.ok(Math.abs(orig.AL12.v - orig.AL4.v) < 1e-6);

  // Mode 3(ArrivalWeekCost)에서도 BoxQuantity=0 입고의 INVOICE_FEE($15)가 송이수 비중 폴백으로 배분됨
  const preparedWeek = await prepareArrivalWeekCost({
    types,
    request: { country: 'CO', orderYear: '2026', orderWeek: '48-01', selectedKeys: [8221, 8222] },
    queryFn: async () => ({ recordset: weekDataset }),
  });
  assert.equal(preparedWeek.issues.length, 0);
  const weekCalc = calculateArrivalWeekCost(preparedWeek, {
    confirmed: true,
    awbInputs: [{
      awb: '86514699786',
      input: {
        gw: 1000,
        cw: 1000,
        exchangeRate: 1400,
        exchangeRateSource: 'TEST_ONLY',
        exchangeRateType: 'VALIDATION_ONLY',
        fullBoxCounts: { ROSE: 4, CARNATION: 30 },
      },
    }],
    expensePools: [
      { kind: 'FREIGHT', sourceId: 'Apollo #8205', awbs: ['86514699786'], currency: 'USD', basis: 'CW', mode: 'TOTAL', amount: 27495.75, confirmed: true },
      { kind: 'CUSTOMS', sourceId: 'Apollo #8205 customs', awbs: ['86514699786'], currency: 'KRW', basis: 'GW', mode: 'FORMULA', amount: null, confirmed: true },
    ],
    expenseDecisions: [
      { wdetailKey: 12, treatment: 'INVOICE_FEE', currency: 'USD', basis: 'BOX', evidence: 'FEER 4378 local fee', confirmed: true },
    ],
  });
  assert.equal(weekCalc.status, 'CALCULATED');
  assert.equal(weekCalc.totals.invoiceFeeNative, 15);
  const feeSource = weekCalc.sources.find(s => s.kind === 'INVOICE_FEE');
  assert.equal(feeSource.basis, 'STEM');
});

test('5b. Mode 3 미매핑 유상 행(ProdKey=NULL)은 암묵 제외되지 않고 명시적 포함/제외 결정 후에만 계산된다 (연도 경계 포함)', async () => {
  const rows = [
    { WarehouseKey: 8127, OrderYear: '2026', OrderWeek: '47-01', OrderNo: '865-14699775', FarmName: 'Ayura', InvoiceNo: '17963', InputDate: '2026-11-18', WdetailKey: 1, ProdKey: 359, ProdName: 'CARNATION Brut', CounName: '콜롬비아', FlowerName: '카네이션', OutUnit: '박스', BoxQuantity: 4, BunchQuantity: 60, SteamQuantity: 1200, OutQuantity: 4, UPrice: 0.215, TPrice: 258, SteamOf1Bunch: 20, SteamOf1Box: 300 },
    { WarehouseKey: 8127, OrderYear: '2026', OrderWeek: '47-01', OrderNo: '865-14699775', FarmName: 'Ayura', InvoiceNo: '17963', InputDate: '2026-11-18', WdetailKey: 2, ProdKey: null, ProdName: null, CounName: null, FlowerName: null, OutUnit: null, BoxQuantity: 1, BunchQuantity: 15, SteamQuantity: 300, OutQuantity: null, UPrice: 0.215, TPrice: 64.5, SteamOf1Bunch: 20, SteamOf1Box: 300 },
  ];
  const p1 = await prepareArrivalWeekCost({
    types,
    request: { country: 'CO', orderYear: '2026', orderWeek: '47-01', selectedKeys: [8127] },
    queryFn: async () => ({ recordset: rows }),
  });
  assert.equal(p1.issues.length, 1);
  assert.equal(p1.issues[0].code, 'UNMAPPED_PAID_ROW_REVIEW');
  const unmappedLineId = p1.issues[0].lineId;

  // 결정 없이 계산 시도 시 차단
  assert.throws(() => calculateArrivalWeekCost(p1, {
    confirmed: true,
    awbInputs: [{ awb: '86514699775', input: { gw: 100, cw: 100, exchangeRate: 1400, exchangeRateSource: 'TEST_ONLY', exchangeRateType: 'VALIDATION_ONLY' } }],
    expensePools: [
      { kind: 'FREIGHT', sourceId: 'F1', awbs: ['86514699775'], currency: 'USD', basis: 'CW', mode: 'TOTAL', amount: 100, confirmed: true },
      { kind: 'CUSTOMS', sourceId: 'C1', awbs: ['86514699775'], currency: 'KRW', basis: 'GW', mode: 'FORMULA', amount: null, confirmed: true },
    ],
  }));

  // 명시적 원가 포함(groupId='CARNATION') 시 $258 + $64.5 = $322.5 전액 반영
  const pInclude = await prepareArrivalWeekCost({
    types,
    request: { country: 'CO', orderYear: '2026', orderWeek: '47-01', selectedKeys: [8127], lineInputs: [{ lineId: unmappedLineId, groupId: 'CARNATION' }] },
    queryFn: async () => ({ recordset: rows }),
  });
  assert.equal(pInclude.issues.length, 0);
  const calcInclude = calculateArrivalWeekCost(pInclude, {
    confirmed: true,
    awbInputs: [{ awb: '86514699775', input: { gw: 100, cw: 100, exchangeRate: 1400, exchangeRateSource: 'TEST_ONLY', exchangeRateType: 'VALIDATION_ONLY' } }],
    expensePools: [
      { kind: 'FREIGHT', sourceId: 'F1', awbs: ['86514699775'], currency: 'USD', basis: 'CW', mode: 'TOTAL', amount: 100, confirmed: true },
      { kind: 'CUSTOMS', sourceId: 'C1', awbs: ['86514699775'], currency: 'KRW', basis: 'GW', mode: 'FORMULA', amount: null, confirmed: true },
    ],
  });
  assert.equal(calcInclude.totals.goodsNative, 322.5);

  // 명시적 중복 확인 제외(unmappedAction='EXCLUDE') 시 $258만 반영되고 비용행 중복 요구 없음
  const pExclude = await prepareArrivalWeekCost({
    types,
    request: { country: 'CO', orderYear: '2026', orderWeek: '47-01', selectedKeys: [8127], lineInputs: [{ lineId: unmappedLineId, unmappedAction: 'EXCLUDE' }] },
    queryFn: async () => ({ recordset: rows }),
  });
  assert.equal(pExclude.issues.length, 0);
  const calcExclude = calculateArrivalWeekCost(pExclude, {
    confirmed: true,
    awbInputs: [{ awb: '86514699775', input: { gw: 100, cw: 100, exchangeRate: 1400, exchangeRateSource: 'TEST_ONLY', exchangeRateType: 'VALIDATION_ONLY' } }],
    expensePools: [
      { kind: 'FREIGHT', sourceId: 'F1', awbs: ['86514699775'], currency: 'USD', basis: 'CW', mode: 'TOTAL', amount: 100, confirmed: true },
      { kind: 'CUSTOMS', sourceId: 'C1', awbs: ['86514699775'], currency: 'KRW', basis: 'GW', mode: 'FORMULA', amount: null, confirmed: true },
    ],
  });
  assert.equal(calcExclude.totals.goodsNative, 258);

  // 다른 연도(2025) 혼입 시 즉시 409 차단
  await assert.rejects(() => prepareArrivalWeekCost({
    types,
    request: { country: 'CO', orderYear: '2026', orderWeek: '47-01', selectedKeys: [8127] },
    queryFn: async () => ({ recordset: rows.map(r => ({ ...r, OrderYear: '2025' })) }),
  }), /연도/);

  assert.equal(resolveColombiaStemsPerBunch({ OutUnit: '송이', SteamOf1Bunch: 0 }, ''), 1);
  assert.equal(resolveColombiaStemsPerBunch({ OutUnit: '박스', FlowerName: '수국', SteamOf1Bunch: null, ProductSteamOf1Bunch: 0 }, 'HYDRANGEA'), 1);
  assert.equal(resolveColombiaStemsPerBunch({ OutUnit: '박스', FlowerName: '카네이션', SteamOf1Bunch: null, ProductSteamOf1Bunch: 20 }, 'CARNATION'), 20);
});

test('6. 화면 수정값(운임·GW/CW·검역R6/소독비R7·통관비직접입력·행별 관세율·단당송이수·환산박스) 미리보기 ↔ .xlsx 완전 동기화', async () => {
  const rows = [
    { WarehouseKey: 8162, OrderYear: '2026', OrderWeek: '47-02', OrderNo: '99204727822', FarmName: 'Balverde', InvoiceNo: '25587', InputDate: '2026-11-22', WdetailKey: 10, ProdKey: 888, ProdName: 'Hydrangea tinted Lavender', FlowerName: '수국', CounName: '사용금지', OutUnit: '박스', BoxQuantity: 4, BunchQuantity: null, SteamQuantity: 120, OutQuantity: 4, UPrice: 0.9, TPrice: 108, SteamOf1Bunch: null, SteamOf1Box: null, ProductSteamOf1Bunch: 0, ProductSteamOf1Box: 30 },
    { WarehouseKey: 8170, OrderYear: '2026', OrderWeek: '47-02', OrderNo: '99204727822', FarmName: 'Ayura', InvoiceNo: '17999', InputDate: '2026-11-22', WdetailKey: 20, ProdKey: 3513, ProdName: 'CARNATION Vintage Honey', FlowerName: '카네이션', CounName: '콜롬비아', OutUnit: '박스', BoxQuantity: 10, BunchQuantity: 0, SteamQuantity: 3000, OutQuantity: 10, UPrice: 0.215, TPrice: 645, SteamOf1Bunch: 20, SteamOf1Box: 300, ProductSteamOf1Bunch: 20, ProductSteamOf1Box: 300 },
  ];
  const queryFn = async () => ({ recordset: rows });
  const handler = createSharedAwbHandler({ authorize: () => true, prepare: prepareNativeShared, queryFn, types });

  const prep = mockRes();
  await handler({ method: 'POST', user: {}, body: { action: 'prepare', orderYear: '2026', orderWeek: '47-02', awb: '992-04727822', scope: 'ALL' } }, prep);
  assert.equal(prep.code, 200);

  // 사용자 보정: 수국 단당 송이수 5로 변경 + 카네이션 관세율 8%(0.08) 수기 부여 + 검역차감(R6) 65,000 + 소독비(R7) 85,000 보정
  const editedLines = prep.data.members.flatMap(m => m.lineInputs.map(l => (
    l.suggestedGroupId === 'HYDRANGEA'
      ? { ...l, groupId: 'HYDRANGEA', stemsPerBunch: 5, tariffRate: 0 }
      : { ...l, groupId: 'CARNATION', stemsPerBunch: 25, tariffRate: 0.08 }
  )));
  const editedInput = {
    gw: 2800,
    cw: 3400,
    freightAmount: 9876.54,
    freightCurrency: 'USD',
    exchangeRate: 1425,
    customsMode: 'FORMULA',
    coCustomsOverrides: {
      storagePerKg: 500,
      clearance: 35000,
      inspectionPerGroup: 12000,
      domestic: 110000,
      quarantine: 65000,
      disinfection: 85000,
    },
    exchangeRateType: 'TEST_ONLY',
    fullBoxCounts: { HYDRANGEA: 8, CARNATION: 6 },
  };

  const prevRes = mockRes();
  await handler({
    method: 'POST',
    user: {},
    body: {
      action: 'preview',
      orderYear: '2026',
      orderWeek: '47-02',
      awb: '992-04727822',
      scope: 'ALL',
      baselineDigest: prep.data.baselineDigest,
      completeManifestConfirmed: true,
      lineInputs: editedLines,
      input: editedInput,
    },
  }, prevRes);
  assert.equal(prevRes.code, 200, JSON.stringify(prevRes.data));
  assert.equal(prevRes.data.result.status, 'CALCULATED');
  const expectedCustoms = 2800 * 500 + 35000 + 2 * 12000 + 110000 + 65000 + 85000;
  assert.equal(prevRes.data.result.totals.customsKRW, expectedCustoms);
  assert.ok(prevRes.data.result.totals.tariffKRW > 0);

  const dlRes = mockRes();
  await handler({
    method: 'POST',
    user: {},
    body: {
      action: 'download',
      orderYear: '2026',
      orderWeek: '47-02',
      awb: '992-04727822',
      scope: 'ALL',
      baselineDigest: prep.data.baselineDigest,
      completeManifestConfirmed: true,
      lineInputs: editedLines,
      input: editedInput,
    },
  }, dlRes);
  assert.equal(dlRes.code, 200, JSON.stringify(dlRes.data));
  const wb = XLSX.read(dlRes.body, { cellFormula: true });
  assert.deepEqual(wb.SheetNames, ['47-2']);
  const sh = wb.Sheets['47-2'];
  assert.equal(sh.C8.v, 2800);
  assert.equal(sh.E8.v, 3400);
  assert.equal(sh.C11.v, 9876.54);
  assert.equal(sh.P6.f, 'C8*500');
  assert.equal(sh.P7.v, 35000);
  assert.equal(sh.P8.f, 'C9*12000');
  assert.equal(sh.P9.v, 110000);
  assert.equal(sh.R6.v, 65000);
  assert.equal(sh.R7.v, 85000);
  assert.equal(sh.P10.v, expectedCustoms);
  assert.equal(sh.N15.v, 5);
  assert.equal(sh.N16.v, 25);
  assert.equal(sh.K16.f, 'J16*0.08');
  assert.ok(Math.abs(sh.AL12.v - sh.AL4.v) < 0.01, `Expected AL12==AL4, got ${sh.AL12.v} vs ${sh.AL4.v}`);

  // 통관비 TOTAL 모드 직접 입력 시에도 미리보기 합계와 엑셀 P10 / AL12 완전 일치
  const dlTotalRes = mockRes();
  await handler({
    method: 'POST',
    user: {},
    body: {
      action: 'download',
      orderYear: '2026',
      orderWeek: '47-02',
      awb: '992-04727822',
      scope: 'ALL',
      baselineDigest: prep.data.baselineDigest,
      completeManifestConfirmed: true,
      lineInputs: editedLines,
      input: { ...editedInput, customsMode: 'TOTAL', customsTotalKRW: 777000 },
    },
  }, dlTotalRes);
  assert.equal(dlTotalRes.code, 200);
  const wbTotal = XLSX.read(dlTotalRes.body, { cellFormula: true });
  assert.deepEqual(wbTotal.SheetNames, ['47-2']);
  const shTotal = wbTotal.Sheets['47-2'];
  assert.equal(shTotal.P10.v, 777000);
  assert.ok(Math.abs(shTotal.AL12.v - shTotal.AL4.v) < 0.01);
});
