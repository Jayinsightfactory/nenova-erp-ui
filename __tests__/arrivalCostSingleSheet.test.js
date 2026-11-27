// 전 국가(CO · NL · CN CLOUD/HUBFRESH · AU · US · VN · NZ · EC · TH) 도착원가 .xlsx 단일 시트 회귀 계약 테스트.
// 사장님 절대 규칙: "원가자료에 별도 시트가 있으면 안 돼. 차수별 원가시트(예: 48-2, 48-1) 단일 1장만 있어야 함."
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import XLSX from 'xlsx';
import { formatCostSheetName } from '../lib/costMasterStore.js';
import { INVOICE_COST_EXPORT_PROFILES } from '../lib/invoiceCostExportProfiles.js';
import { createInvoiceCostWorkbook, createNativeCostWorkbook, createInvoicePreviewCostWorkbook, createSharedAwbCostWorkbook } from '../lib/invoiceReceiptCostExport.js';
import { createCnArrivalCostWorkbook } from '../lib/cnArrivalCostWorkbook.js';
import { buildCnDraft, cnSourceFromDbRows, computeCnCost, normalizeCnPayload } from '../lib/cnArrivalCostEngine.js';
import { prepareNativeShared } from '../lib/nativeSharedCost.js';
import { createSharedAwbHandler } from '../lib/invoiceSharedAwbApi.js';
import { calculateSharedAwbCost } from '../lib/invoiceSharedAwbCost.js';
import { buildNlCustomerComparison } from '../lib/nlCostCustomerComparison.js';
import { CLOUD_COST_FORMULA, CLOUD_CUSTOMS_DEFAULTS, matchCloudCategory } from '../lib/chinaCloudCost.js';
import { previewInvoiceCost } from '../lib/invoiceReceiptCost.js';
import { createArrivalWeekCostWorkbook } from '../lib/arrivalWeekCostWorkbook.js';
import { prepareArrivalWeekCost, calculateArrivalWeekCost } from '../lib/arrivalWeekCost.js';
import { invoiceCostExportFixture } from './invoiceReceiptCostExport.test.js';

const FORBIDDEN_SHEET_NAMES = ['원본 양식 계산', '원본수식 비교', '주광·기타 비교', '카테고리 규격표', '품종 기준', '도착원가', 'CLOUD 원가'];

async function assertSingleSelfContainedCostSheet(bytes, expectedSheetName, label) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes);
  assert.equal(wb.worksheets.length, 1, `${label}: 시트 수는 반드시 1장이어야 한다 (${wb.worksheets.map(s => s.name).join(', ')})`);
  assert.equal(wb.worksheets[0].name, expectedSheetName, `${label}: 시트명은 실무 차수 표기(${expectedSheetName})여야 한다`);
  for (const forbidden of FORBIDDEN_SHEET_NAMES) {
    assert.notEqual(wb.worksheets[0].name, forbidden, `${label}: 금지된 부가 시트명(${forbidden}) 사용 불가`);
  }

  const zip = await JSZip.loadAsync(bytes);
  const worksheetFiles = Object.keys(zip.files).filter(name => /^xl\/worksheets\/sheet\d+\.xml$/.test(name));
  assert.deepEqual(worksheetFiles, ['xl/worksheets/sheet1.xml'], `${label}: OOXML 패키지 내 worksheet XML도 단일 1개여야 한다`);
  const sheetXml = await zip.file('xl/worksheets/sheet1.xml').async('string');
  assert.doesNotMatch(sheetXml, /#REF!|t="e"/, `${label}: #REF! 또는 엑셀 에러 셀이 없어야 한다`);
  assert.doesNotMatch(
    sheetXml,
    /미승인 계산본|운영 DB 변경 없음|실제 청구액 아님|ERP에는 반영되지 않습니다|실제 판매가 아님|실판매 아님|ERP\/승인 원가 변경 없음|ERP 원장 불변|\[핵심 목적 · PURPOSE\]/,
    `${label}: 시스템 경고/안내 문구가 시트에 포함되면 안 된다`,
  );
  assert.match(sheetXml, /<autoFilter\b[^>]*ref="[A-Z]+\d+:[A-Z]+\d+"/, `${label}: 데이터 헤더 AutoFilter가 부착되어야 한다`);
  for (const [, f] of sheetXml.matchAll(/<f\b[^>]*>([\s\S]*?)<\/f>/g)) {
    assert.doesNotMatch(f, /!/, `${label}: 타 시트 참조 수식이 없어야 한다 (${f})`);
  }

  const xbook = XLSX.read(bytes, { type: 'buffer', cellFormula: true });
  assert.deepEqual(xbook.SheetNames, [expectedSheetName]);
  const xsheet = xbook.Sheets[expectedSheetName];
  let formulaCount = 0;
  for (const [ref, cell] of Object.entries(xsheet)) {
    if (!/^[A-Z]+\d+$/.test(ref)) continue;
    assert.notEqual(cell.t, 'e', `${label}!${ref}: 에러 셀 금지`);
    if (typeof cell.v === 'number') assert.ok(Number.isFinite(cell.v), `${label}!${ref}: NaN/Infinity 금지`);
    if (cell.f) {
      formulaCount++;
      assert.doesNotMatch(cell.f, /!|#REF!/, `${label}!${ref}: 단일 시트 내부 참조만 허용 (${cell.f})`);
    }
  }
  assert.ok(formulaCount > 0, `${label}: 원가 산출 수식이 포함되어야 한다`);
  return { wb, ws: wb.worksheets[0], xsheet };
}

test('formatCostSheetName: 차수 문자열을 실무 단일 시트명(48-2, 48-1, 8-2)으로 정규화', () => {
  assert.equal(formatCostSheetName('48-02'), '48-2');
  assert.equal(formatCostSheetName('48-01'), '48-1');
  assert.equal(formatCostSheetName('08-02'), '8-2');
  assert.equal(formatCostSheetName('47-02A'), '47-2A');
});

test('1. 콜롬비아 공동 AWB(48-02 / 992-04727833 형태, 환율 1,360원): 오직 "48-2" 단일 시트 1장만 출력되고 수식 오차 0.00원', async () => {
  const rows = [
    { WarehouseKey: 8289, OrderYear: '2026', OrderWeek: '48-02', OrderNo: '992-04727833', FarmName: 'Apollo', InvoiceNo: '콜카장수국', InputDate: '2026-11-26', WdetailKey: 1, ProdKey: 2182, ProdName: '운송료', OutQuantity: 1, SteamQuantity: 1, UPrice: 11513.48, TPrice: 11513.48 },
    { WarehouseKey: 8289, OrderYear: '2026', OrderWeek: '48-02', OrderNo: '992-04727833', FarmName: 'Apollo', InvoiceNo: '콜카장수국', InputDate: '2026-11-26', WdetailKey: 2, ProdKey: 2182, ProdName: '운송료', OutQuantity: 1, SteamQuantity: 1, UPrice: 90.47, TPrice: 90.47 },
    { WarehouseKey: 8289, OrderYear: '2026', OrderWeek: '48-02', OrderNo: '992-04727833', FarmName: 'Apollo', InvoiceNo: '콜카장수국', InputDate: '2026-11-26', WdetailKey: 3, ProdKey: 3100, ProdName: 'Gross weight', OutQuantity: 3502, SteamQuantity: 3502, UPrice: 0, TPrice: 0 },
    { WarehouseKey: 8289, OrderYear: '2026', OrderWeek: '48-02', OrderNo: '992-04727833', FarmName: 'Apollo', InvoiceNo: '콜카장수국', InputDate: '2026-11-26', WdetailKey: 4, ProdKey: 3101, ProdName: 'Chargeable weight', OutQuantity: 4202, SteamQuantity: 4202, UPrice: 0, TPrice: 0 },
    { WarehouseKey: 8270, OrderYear: '2026', OrderWeek: '48-02', OrderNo: '99204727833', FarmName: 'C.I Flores Balverde S.A.S', InvoiceNo: '25610', InputDate: '2026-11-26', WdetailKey: 10, ProdKey: 888, ProdName: 'Hydrangea Lavender (라벤더)', FlowerName: '수국', CounName: '콜롬비아', OutUnit: '박스', BoxQuantity: 324, BunchQuantity: 9720, SteamQuantity: 9720, OutQuantity: 324, UPrice: 0.9, TPrice: 8748, SteamOf1Bunch: 1, SteamOf1Box: 30 },
    { WarehouseKey: 8271, OrderYear: '2026', OrderWeek: '48-02', OrderNo: '99204727833', FarmName: 'Ayura', InvoiceNo: '18020', InputDate: '2026-11-26', WdetailKey: 11, ProdKey: 3513, ProdName: 'CARNATION Caramel', FlowerName: '카네이션', CounName: '콜롬비아', OutUnit: '박스', BoxQuantity: 53, BunchQuantity: 795, SteamQuantity: 15900, OutQuantity: 53, UPrice: 0.2, TPrice: 3180, SteamOf1Bunch: 20, SteamOf1Box: 300 },
    { WarehouseKey: 8272, OrderYear: '2026', OrderWeek: '48-02', OrderNo: '99204727833', FarmName: 'Elite Flower', InvoiceNo: 'EL-1', InputDate: '2026-11-26', WdetailKey: 12, ProdKey: 201, ProdName: 'ROSE / Mondial White 60cm', FlowerName: '장미', CounName: '콜롬비아', OutUnit: '박스', BoxQuantity: 93, BunchQuantity: 372, SteamQuantity: 9300, OutQuantity: 93, UPrice: 0.42, TPrice: 3906, SteamOf1Bunch: 25, SteamOf1Box: 100 },
    { WarehouseKey: 8282, OrderYear: '2026', OrderWeek: '48-02', OrderNo: '99204727833', FarmName: 'C.I. FLORES DE FUNZA SAS', InvoiceNo: 'FE204589', InputDate: '2026-11-26', WdetailKey: 13, ProdKey: 401, ProdName: 'ALSTROMERIA Mix', FlowerName: '알스트로', CounName: '콜롬비아', OutUnit: '박스', BoxQuantity: 65, BunchQuantity: 1040, SteamQuantity: 10400, OutQuantity: 65, UPrice: 0.18, TPrice: 1872, SteamOf1Bunch: 10, SteamOf1Box: 160 },
  ];
  const types = { NVarChar: () => 1 };
  const queryFn = async () => ({ recordset: rows });
  const handler = createSharedAwbHandler({ authorize: () => true, prepare: prepareNativeShared, queryFn, types });

  const prep = { code: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(d) { this.data = d; }, send(b) { this.body = b; } };
  await handler({ method: 'POST', user: {}, body: { action: 'prepare', orderYear: '2026', orderWeek: '48-02', awb: '992-04727833', scope: 'ALL' } }, prep);
  assert.equal(prep.code, 200);
  const lineInputs = prep.data.members.flatMap(m => m.lineInputs.map(l => ({ ...l, groupId: l.suggestedGroupId })));
  const input = {
    gw: 3502,
    cw: 4202,
    freightAmount: 11603.95,
    freightCurrency: 'USD',
    exchangeRate: 1360,
    customsMode: 'FORMULA',
    exchangeRateType: 'MANUAL',
    fullBoxCounts: { HYDRANGEA: 81, CARNATION: 25.5, ROSE: 36.75, ALSTROMERIA: 30.25 },
  };

  const previewRes = { code: 200, headers: {}, setHeader() {}, status(c) { this.code = c; return this; }, json(d) { this.data = d; } };
  await handler({ method: 'POST', user: {}, body: { action: 'preview', orderYear: '2026', orderWeek: '48-02', awb: '992-04727833', scope: 'ALL', baselineDigest: prep.data.baselineDigest, completeManifestConfirmed: true, lineInputs, input } }, previewRes);
  assert.equal(previewRes.code, 200);

  const dl = { code: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(d) { this.data = d; }, send(b) { this.body = b; } };
  await handler({ method: 'POST', user: {}, body: { action: 'download', orderYear: '2026', orderWeek: '48-02', awb: '992-04727833', scope: 'ALL', baselineDigest: prep.data.baselineDigest, completeManifestConfirmed: true, lineInputs, input } }, dl);
  assert.equal(dl.code, 200);

  const { xsheet } = await assertSingleSelfContainedCostSheet(dl.body, '48-2', 'CO Shared AWB 48-02');
  const previewTotalKRW = previewRes.data.result.lines.reduce((s, l) => s + l.totalCostKRW, 0);
  assert.equal(xsheet.B1.v, 'COLOMBIA                                    콜카장 + 수국');
  assert.equal(xsheet.B2?.v, undefined);
  assert.equal(xsheet.B3?.v, undefined);
  assert.equal(xsheet.C5.v, '48-2');
  assert.equal(xsheet.C7.t, 'n');
  assert.equal(xsheet.C7.v, 1360);
  assert.equal(xsheet.D9.v, 'Rate');
  assert.ok(Math.abs(xsheet.E9.v - 2.74) < 1e-9);
  assert.equal(xsheet.D11.v, '서류');
  assert.equal(xsheet.E11.v, 90.47);
  assert.equal(xsheet.F11.v, '운송비');
  assert.equal(xsheet.G11.f, 'E9*E8');
  assert.ok(Math.abs(xsheet.G11.v - 11513.48) < 1e-6);
  assert.equal(xsheet.C11.f, 'E11+G11');
  assert.ok(Math.abs(xsheet.C11.v - 11603.95) < 1e-6);
  assert.equal(xsheet.O5.v, '그외에 통관비');
  assert.match(xsheet.Q14.v, /판매가[\s\S]*부가세 포함/);
  assert.equal(xsheet.U13.f, 'SUBTOTAL(9,U15:U18)');
  assert.equal(xsheet.V13.f, 'SUBTOTAL(9,V15:V18)');
  assert.deepEqual([xsheet.AB8.v, xsheet.AB9.v, xsheet.AB10.v, xsheet.AB11.v, xsheet.AB12.v], [8, 11, 9.7, 8, 5.5]);
  assert.deepEqual([xsheet.AG8.v, xsheet.AG9.v, xsheet.AG10.v, xsheet.AG11.v, xsheet.AG12.v], [10, 9, 7, 9.6, 6.7]);
  assert.equal(xsheet.P6.f, 'C8*460');
  assert.equal(xsheet.P10.f, 'SUM(P6:P9)+R6+R7');
  assert.ok(Math.abs(xsheet.AL12.v - previewTotalKRW) < 0.01, 'AL12 === 미리보기 총도착원가 (0.00원 오차)');
  assert.ok(Math.abs(xsheet.AL13.v) < 0.01, 'AL13(오차) === 0.00원');
});

test('2. 전 국가 템플릿 프로파일(10종 + NL 주광 분류 + CN_CLOUD_CBM_V1): 모두 단일 차수 시트 1장 · 타 시트 참조 0건 · 오차 0.00원', async () => {
  for (const profile of Object.values(INVOICE_COST_EXPORT_PROFILES).filter(p => !p.generated)) {
    const f = invoiceCostExportFixture(4, profile.formulaId);
    f.document.orderWeek = '48-01';
    if (profile.id === 'CO_42_1_ORIGINAL_V1') {
      f.snapshot.input.customsExplicitTotal = true;
    }
    if (profile.id === 'CN_SEA_ORIGINAL_V1') {
      f.snapshot.input.lineInputs.forEach(l => { l.boxCbm = 0.12; l.bunchesPerBox = 10; });
    }
    const extra = profile.id === 'NL_ORIGINAL_V1'
      ? {
          nlComparison: buildNlCustomerComparison({
            orderYear: '2026',
            orderWeek: '48-01',
            warehouseKey: 901,
            customers: [{ CustKey: 533, OrderCode: 'YCL2' }],
            orders: [{ OrderYear: '2026', OrderWeek: '48-01', CustKey: 533, ProdKey: 1, ProdName: 'CURRENT FLOWER 1', SteamQuantity: 50 }],
            receipts: f.revision.lines.map((cost, i) => ({
              OrderYear: '2026',
              OrderWeek: '48-01',
              WarehouseKey: 901,
              WdetailKey: 1000 + i,
              ProdKey: i + 1,
              ProdName: f.document.lines[i].originalName,
              SteamQuantity: f.snapshot.receiptSnapshot.details[i].stemQuantity,
            })),
          }),
        }
      : {};
    const bytes = await createInvoiceCostWorkbook({ ...f, ...extra });
    const { xsheet } = await assertSingleSelfContainedCostSheet(bytes, '48-1', `Approved ${profile.id}`);
    if (profile.id === 'CO_42_1_ORIGINAL_V1') {
      assert.ok(Math.abs(xsheet.AL12.v - f.revision.totalCostKRW) < 0.01);
    } else if (profile.id === 'AU_ORIGINAL_V1') {
      assert.ok(Math.abs(xsheet.W21.v - f.revision.totalCostKRW) < 0.01);
    } else if (profile.id !== 'CN_SEA_ORIGINAL_V1') {
      assert.ok(Math.abs(xsheet.AB7.v - f.revision.totalCostKRW) < 0.01, `${profile.id} AB7 === approved total`);
    }
  }

  // CN_CLOUD_CBM_V1 (구 CLOUD 인보이스 미리보기 경로)
  const cloudLines = [['ROSE CHINA White', 30, 20], ['ORCHID CHINA White', 80, 23]].map(([name, q, p], i) => ({
    lineId: `dddddddd-dddd-4ddd-8ddd-${String(i + 1).padStart(12, '0')}`,
    lineNo: i + 1, originalName: name, prodKey: i + 1, bunchQuantity: q, outQuantity: q, outUnit: 'BUNCH', unitPrice: p, lineAmount: q * p, currency: 'CNY',
  }));
  const cloudDoc = {
    documentId: 'eeeeeeee-eeee-4eee-8eee-000000000001',
    revision: 1, orderYear: '2026', orderWeek: '47-02', invoiceNo: 'CLD-1', sourceHash: 'a'.repeat(64),
    receiptStatus: 'INVOICE_PREVIEW', costStatus: 'PREVIEW_ONLY',
    reviewedMetadata: { country: 'CN', transportMode: 'AIR', farmName: 'CLOUD', inputDate: '2026-11-20', gw: 1896 },
    lines: cloudLines, receiptLines: cloudLines,
  };
  const cloudInput = {
    ...CLOUD_COST_FORMULA, ...CLOUD_CUSTOMS_DEFAULTS, cloudCustomsMode: 'FORMULA', formulaApplicabilityConfirmed: true,
    formulaEffectiveDate: '2026-11-20', nativeCurrency: 'CNY', freightCurrency: 'CNY', freightAmount: 24087, exchangeRateKRW: 210,
    exchangeRateType: 'MANUAL', exchangeRateDate: '2026-11-20', costSourceId: 'CLD-1',
    allocationScope: 'SINGLE_INVOICE', allocationShareNumerator: 1, allocationShareDenominator: 1,
    lineInputs: cloudLines.map(l => ({ lineId: l.lineId, categoryCode: matchCloudCategory(l.originalName) })),
  };
  const cloudPreview = previewInvoiceCost({ ...cloudDoc, costInput: cloudInput }, cloudLines);
  const cloudBytes = await createInvoicePreviewCostWorkbook({ document: cloudDoc, input: cloudInput });
  const { xsheet: cloudSheet } = await assertSingleSelfContainedCostSheet(cloudBytes, '47-2', 'CN_CLOUD_CBM_V1');
  assert.ok(Math.abs(cloudSheet.C8.v - cloudPreview.totals.totalCostKRW) < 1e-6);
});

test('3. 중국 신형 엔진(CLOUD 항공 · HUBFRESH 40ft 해상) 및 주차별 통합 원가(CO · CN): 모두 단일 차수 시트 1장 출력', async () => {
  for (const [mode, farmName, orderWeek, expectedSheet] of [
    ['CLOUD', 'Cloudland', '47-02', '47-2'],
    ['HUBFRESH', 'KUN MING HUBFRESH', '48-01', '48-1'],
  ]) {
    const dbRows = [
      { WarehouseKey: 8801, OrderYear: '2026', OrderWeek: orderWeek, FarmName: farmName, InvoiceNo: 'CN-1', WdetailKey: 1, ProdKey: 101, ProdName: 'ROSE CHINA / 카롤라', CounName: '중국', OutUnit: '단', BunchQuantity: 50, OutQuantity: 50, UPrice: 22, TPrice: 1100 },
      { WarehouseKey: 8801, OrderYear: '2026', OrderWeek: orderWeek, FarmName: farmName, InvoiceNo: 'CN-1', WdetailKey: 2, ProdKey: 102, ProdName: 'Eucalyptus CHINA / 블랙잭 1kg', CounName: '중국', OutUnit: '단', BunchQuantity: 30, OutQuantity: 30, UPrice: 18, TPrice: 540 },
    ];
    const draft = buildCnDraft(cnSourceFromDbRows(dbRows), { mode });
    const payload = normalizeCnPayload({
      mode,
      header: { ...draft.header, exchangeRate: 210, gw: 500, cw: 620, airFreight: 6200, nenovaCbm: 15, realCbm: 45, seaFreight: 30000 },
      rows: draft.rows,
      warehouseKey: 8801,
      orderYear: '2026',
      orderWeek,
      farmName,
    });
    const preview = computeCnCost(payload);
    const { buffer, layout } = await createCnArrivalCostWorkbook(payload);
    const { ws } = await assertSingleSelfContainedCostSheet(buffer, expectedSheet, `CN ${mode}`);
    assert.ok(Math.abs(ws.getCell(`${layout.col.totalCost}${layout.totalRow}`).value.result - preview.totals.totalCostKrw) < 1e-6);
    const zip = await JSZip.loadAsync(buffer);
    assert.doesNotMatch(await zip.file('xl/styles.xml').async('string'), /굴림/, '굴림체 0건');
  }

  // 주차별 통합 원가 (ArrivalWeekCost: CO 및 CN)
  const types = { Int: 1, NVarChar: n => n };
  for (const [country, counName, currency, orderWeek, expectedSheet] of [
    ['CO', '콜롬비아', 'USD', '48-02', '48-2'],
    ['CN', '중국', 'CNY', '47-02', '47-2'],
  ]) {
    const raw = [{
      WarehouseKey: 1, OrderYear: '2026', OrderWeek: orderWeek, OrderNo: '784-69519262', FarmName: country === 'CN' ? 'Cloudland' : 'Ayura',
      InvoiceNo: 'INV-1', FileName: 'f.xlsx', InputDate: '2026-11-26', WdetailKey: 10, ProdKey: 2265, OrderCode: '1',
      ProdName: country === 'CN' ? 'ROSE CHINA Red' : 'ROSE / Mondial', CounName: counName, FlowerName: '장미',
      OutUnit: country === 'CN' ? '단' : '송이', BoxQuantity: 1, BunchQuantity: 10, SteamQuantity: 100, OutQuantity: country === 'CN' ? 10 : 100,
      SteamOf1Bunch: 10, SteamOf1Box: 100, UPrice: 2, TPrice: country === 'CN' ? 20 : 200,
    }];
    const prepared = await prepareArrivalWeekCost({
      types,
      request: { country, orderYear: '2026', orderWeek, selectedKeys: [1] },
      queryFn: async sql => ({ recordset: sql.includes('invoice-expenses:') ? [] : raw }),
    });
    const calc = calculateArrivalWeekCost(prepared, {
      confirmed: true,
      awbInputs: [{ awb: '78469519262', input: { gw: 100, cw: 120, exchangeRate: country === 'CN' ? 210 : 1360, exchangeRateSource: 'MANUAL', exchangeRateType: 'VALIDATION_ONLY', permitAmount: 0, fullBoxCounts: { ROSE: 1 } } }],
      expensePools: [
        { kind: 'FREIGHT', sourceId: 'F-1', awbs: ['78469519262'], amount: 150, currency, basis: 'CW', mode: 'TOTAL', confirmed: true },
        { kind: 'CUSTOMS', sourceId: 'C-1', awbs: ['78469519262'], amount: 50000, currency: 'KRW', basis: 'GW', mode: 'TOTAL', confirmed: true },
      ],
    });
    const bytes = await createArrivalWeekCostWorkbook({ prepared, calculation: calc });
    await assertSingleSelfContainedCostSheet(bytes, expectedSheet, `ArrivalWeekCost ${country}`);
  }
});

test('4. 모든 원가 다운로드 API 라우트는 과거 시트 자동 병합(exportWithCostHistory)을 호출하지 않는다', () => {
  for (const routeFile of [
    'pages/api/import/receipts/native-shared-cost.js',
    'pages/api/import/receipts/shared-awb-cost.js',
    'pages/api/import/receipts/native-cost.js',
    'pages/api/import/receipts/invoice-cost.js',
    'pages/api/import/receipts/[id]/cost-export.js',
  ]) {
    const src = fs.readFileSync(new URL(`../${routeFile}`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /exportWithCostHistory/, `${routeFile}: 단일 시트 다운로드에 과거 차수 시트가 합쳐지면 안 된다`);
  }
});

test('5. 콜롬비아 분리 내역 미보유 단일 총운임 폴백(내역 없음 0건) 및 원클릭 버튼형 도착원가 UI 계약 검증', async () => {
  // DB 참고전표 없이 총운임만 입력된 경우에도 E9=total/cw, E11=0, G11=E9*E8, C11=E11+G11 수식 작동 및 '내역 없음' 문구 0건
  const soloRows = [
    { WarehouseKey: 8270, OrderYear: '2026', OrderWeek: '48-02', OrderNo: '99204727833', FarmName: 'Balverde', InvoiceNo: '25610', InputDate: '2026-11-26', WdetailKey: 10, ProdKey: 888, ProdName: 'Hydrangea Lavender', FlowerName: '수국', CounName: '콜롬비아', OutUnit: '박스', BoxQuantity: 10, BunchQuantity: 300, SteamQuantity: 300, OutQuantity: 10, UPrice: 0.9, TPrice: 270, SteamOf1Bunch: 1, SteamOf1Box: 30 },
  ];
  const handler = createSharedAwbHandler({ authorize: () => true, prepare: prepareNativeShared, queryFn: async () => ({ recordset: soloRows }), types: { NVarChar: () => 1 } });
  const prep = { code: 200, headers: {}, setHeader() {}, status(c) { this.code = c; return this; }, json(d) { this.data = d; } };
  await handler({ method: 'POST', user: {}, body: { action: 'prepare', orderYear: '2026', orderWeek: '48-02', awb: '992-04727833', scope: 'HYDRANGEA' } }, prep);
  const lineInputs = prep.data.members.flatMap(m => m.lineInputs.map(l => ({ ...l, groupId: 'HYDRANGEA' })));
  const dl = { code: 200, headers: {}, setHeader() {}, status(c) { this.code = c; return this; }, json(d) { this.data = d; }, send(b) { this.body = b; } };
  await handler({
    method: 'POST',
    user: {},
    body: {
      action: 'download',
      orderYear: '2026',
      orderWeek: '48-02',
      awb: '992-04727833',
      scope: 'HYDRANGEA',
      baselineDigest: prep.data.baselineDigest,
      completeManifestConfirmed: true,
      lineInputs,
      input: { gw: 300, cw: 400, freightAmount: 1000, freightCurrency: 'USD', exchangeRate: '1360', customsMode: 'FORMULA', exchangeRateType: 'MANUAL' },
    },
  }, dl);
  assert.equal(dl.code, 200);
  const { xsheet } = await assertSingleSelfContainedCostSheet(dl.body, '48-2', 'CO Fallback No-Ref');
  assert.equal(xsheet.B1.v, 'COLOMBIA                                    수국');
  assert.equal(xsheet.C7.t, 'n');
  assert.equal(xsheet.C7.v, 1360);
  assert.equal(xsheet.E9.v, 2.5);
  assert.equal(xsheet.E11.v, 0);
  assert.equal(xsheet.G11.f, 'E9*E8');
  assert.equal(xsheet.G11.v, 1000);
  assert.equal(xsheet.C11.f, 'E11+G11');
  assert.equal(xsheet.C11.v, 1000);
  const allValues = Object.values(xsheet).map(c => String(c?.v ?? '')).join('\n');
  assert.doesNotMatch(allValues, /내역 없음|미승인/);

  // 원클릭 버튼형 뷰(SharedAwbCostReview · CnArrivalCostWorkbench) JSX 변환 및 핵심 UI 토큰 검증
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const babel = require('next/dist/compiled/babel/core');
  const presetReact = require('next/dist/compiled/babel/preset-react');
  for (const uiPath of [
    'components/import-tools/SharedAwbCostReview.js',
    'components/import-tools/CnArrivalCostWorkbench.js',
    'components/import-tools/CostAwbEvidence.js',
  ]) {
    const src = fs.readFileSync(new URL(`../${uiPath}`, import.meta.url), 'utf8');
    babel.transformSync(src, { filename: uiPath, presets: [presetReact], configFile: false, babelrc: false });
    assert.doesNotMatch(src, /[\u{1F300}-\u{1FAFF}]/u, `${uiPath}: 장식성 이모지 0건`);
  }
  const sharedSrc = fs.readFileSync(new URL('../components/import-tools/SharedAwbCostReview.js', import.meta.url), 'utf8');
  assert.match(sharedSrc, /품종 버튼 필터/);
  assert.match(sharedSrc, /농장 버튼 필터/);
  assert.match(sharedSrc, /품목 버튼 필터/);
  assert.match(sharedSrc, /선택 조건 소계/);
  assert.match(sharedSrc, /도착원가 합계 \(KRW\)/);
  assert.match(sharedSrc, /운송비 \(USD · G11\)/);
  assert.match(sharedSrc, /서류비 \(USD · E11\)/);
  assert.match(sharedSrc, /적용 Rate \(USD\/kg/);
  const cnSrc = fs.readFileSync(new URL('../components/import-tools/CnArrivalCostWorkbench.js', import.meta.url), 'utf8');
  assert.match(cnSrc, /카테고리 원클릭 버튼 필터/);
  assert.match(cnSrc, /중국 품목 원클릭 버튼 필터/);
});
