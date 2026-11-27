// 도착원가 생태계 통합 계약 테스트 (dbWrites: 0)
// 1. 콜롬비아(CO_GROUP_42_1_V1) · 네덜란드(NL_AMOUNT_V1) · 중국 신형(CLOUD 항공 · HUBFRESH 해상) .xlsx → parseArrivalCostWorkbook + summarizeReview 라운드트립 100% 복구
// 2. NL·CN 농장 무관 국가의 profitReport(profitArrivalRows / resolveExactArrivalPriceEvidence) 원가 누락 해소 (콜롬비아 FARM_REQUIRED 및 미검토 UPLOAD 제외 보존)
// 3. 상단 원가 계산기 ↔ ArrivalUploadReview 원클릭 브릿지 · 상단 오해 문구 정정 · 전 구간 품종·농장·품목 3단 버튼 조회 · '사용금지수국'→'수국' 정제
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseArrivalCostWorkbook, isFarmlessArrivalCountry } from '../lib/arrivalCostExcel.js';
import { namedCountry, prepareSheetReviews, summarizeReview } from '../lib/arrivalUploadReview.js';
import { createCnArrivalCostWorkbook } from '../lib/cnArrivalCostWorkbook.js';
import { buildCnDraft, cnSourceFromDbRows, computeCnCost, normalizeCnPayload } from '../lib/cnArrivalCostEngine.js';
import { createInvoiceCostWorkbook } from '../lib/invoiceReceiptCostExport.js';
import { INVOICE_COST_FORMULAS, previewInvoiceCost } from '../lib/invoiceReceiptCost.js';
import { resolveExactArrivalPriceEvidence } from '../lib/profitReportEvidence/sourceResolvers.mjs';
import { arrivalCountryFlowerKey, cleanDeprecatedOriginToken } from '../lib/arrivalCostProductSearch.js';
import {
  buildArrivalThreeTierChips,
  cleanArrivalFlowerChip,
  cleanArrivalVarietyTabLabel,
  filterArrivalRowsThreeTier,
  normalizeArrivalVarietyTabs,
  summarizeArrivalFilteredRows,
} from '../lib/arrivalCostView.js';
import {
  ARRIVAL_UPLOAD_BRIDGE_KEY,
  arrivalBridgeCountryLabel,
  consumePendingArrivalUploadBridge,
  sendWorkbookToArrivalUploadReview,
  toArrivalXlsxFile,
} from '../lib/arrivalCostUploadBridge.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const cnFixtureDir = path.join(root, '__tests__', 'fixtures', 'cnArrivalCost');
const loadCnFixture = name => JSON.parse(fs.readFileSync(path.join(cnFixtureDir, `${name}.json`), 'utf8'));

function buildInvoiceExportFixture(count, formulaId) {
  const DOC = '11111111-1111-8111-8111-111111111111';
  const OP = '22222222-2222-8222-8222-222222222222';
  const COST = '33333333-3333-8333-8333-333333333333';
  const formula = INVOICE_COST_FORMULAS[formulaId];
  const additional = Boolean(formula.priceBasis);
  const nl = formulaId === 'NL_AMOUNT_V1';
  const currency = additional ? 'USD' : nl ? 'EUR' : 'CNY';
  const document = {
    documentId: DOC,
    revision: 2,
    sourceHash: 'ab'.repeat(32),
    orderYear: '2026',
    orderWeek: '48-02',
    invoiceYear: '2026',
    invoiceNo: 'ROUNDTRIP-EXPORT',
    receiptStatus: 'COMMITTED',
    costStatus: 'APPROVED',
    history: [],
    reviewedMetadata: {
      country: additional ? formula.country : nl ? 'NL' : 'CN',
      transportMode: 'AIR',
      inputDate: '2026-11-22',
      gw: count * 20,
      cw: count * 25,
      farmName: nl ? 'Holex' : 'Antioquia',
    },
    lines: Array.from({ length: count }, (_, i) => ({
      lineId: `aaaaaaaa-aaaa-8aaa-8aaa-${(i + 1).toString(16).padStart(12, '0')}`,
      lineNo: i + 1,
      originalName: nl ? `Agapanthus NL Variety ${i + 1}` : `Hydrangea Colombia Variety ${i + 1}`,
      prodKey: 500 + i,
      lineAmount: 100 + i * 10,
      unitPrice: 2,
      currency,
      priceUnit: additional ? formula.priceBasis : 'STEM',
    })),
  };
  if (nl) {
    document.lines.forEach((line, i) => {
      line.stemQuantity = (10 + i) * 5;
      line.lineAmount = line.unitPrice * line.stemQuantity;
    });
  }
  const input = {
    ...formula,
    formulaApplicabilityConfirmed: true,
    formulaEffectiveDate: '2026-11-22',
    nativeCurrency: currency,
    freightCurrency: currency,
    exchangeRateKRW: nl ? 1520 : 1360,
    exchangeRateType: 'PURCHASE',
    exchangeRateDate: '2026-11-22',
    freightAmount: 450,
    customsTotalKRW: 180000,
    costSourceId: 'roundtrip-bill',
    allocationScope: 'SINGLE_INVOICE',
    allocationShareNumerator: 1,
    allocationShareDenominator: 1,
    lineInputs: document.lines.map(line => ({
      lineId: line.lineId,
      grossWeightKg: 20,
      volumeWeightKg: 25,
      tariffRate: 0,
      otherCostPerUnitKRW: 0,
      stemsPerBunch: 5,
      bunchesPerBox: 20,
    })),
  };
  const receipt = document.lines.map((line, i) => ({
    ...line,
    wdetailKey: 2000 + i,
    outQuantity: 10 + i,
    outUnit: '단',
  }));
  if (additional) {
    receipt.forEach((line, i) => {
      line.lineAmount = line.unitPrice * line.outQuantity * 5;
      document.lines[i].lineAmount = line.lineAmount;
    });
  }
  if (formula.groupIds) {
    const groups = new Map();
    input.lineInputs.forEach((line, i) => {
      delete line.grossWeightKg;
      delete line.volumeWeightKg;
      line.groupId = formula.groupIds[i % formula.groupIds.length];
      line.tariffRate = 0;
      receipt[i].boxQuantity = receipt[i].lineAmount / receipt[i].unitPrice / 100;
      document.lines[i].boxQuantity = receipt[i].boxQuantity;
      groups.set(line.groupId, (groups.get(line.groupId) || 0) + receipt[i].lineAmount / receipt[i].unitPrice);
    });
    input.costGroups = [...groups].map(([groupId, quantity]) => ({
      groupId,
      quantity,
      boxQuantity: receipt.reduce((sum, row, i) => sum + (input.lineInputs[i].groupId === groupId ? row.boxQuantity : 0), 0),
      grossWeightKg: document.reviewedMetadata.gw / groups.size,
      volumeWeightKg: document.reviewedMetadata.cw / groups.size,
    }));
    input.lossTreatmentConfirmed = true;
  }
  const computed = previewInvoiceCost({ ...document, costInput: input }, receipt);
  assert.equal(computed.status, 'APPROVED');
  const revision = {
    costRevisionId: COST,
    documentId: DOC,
    documentRevision: 2,
    warehouseKey: 901,
    operationId: OP,
    revisionNo: 1,
    basis: 'ACTUAL',
    status: 'APPROVED',
    storedStatus: 'APPROVED',
    liveReceiptStatus: 'MATCH',
    formulaId: formula.formulaId,
    formulaVersion: formula.formulaVersion,
    formulaSourceHash: formula.formulaSourceHash,
    lines: computed.lines.map((line, i) => ({ ...line, wdetailKey: receipt[i].wdetailKey })),
    totalCostKRW: computed.totals.totalCostKRW,
  };
  document.operations = [{
    operationId: OP,
    status: 'COMMITTED',
    documentRevision: 2,
    warehouseKey: 901,
    result: {
      receiptDigest: 'cd'.repeat(32),
      lineMappings: receipt.map(line => ({
        lineId: line.lineId,
        wdetailKey: line.wdetailKey,
        prodKey: line.prodKey,
        outQuantity: line.outQuantity,
        unit: line.outUnit,
      })),
    },
  }];
  const snapshot = {
    schemaVersion: 1,
    basis: 'ACTUAL',
    saveFingerprint: 'ef'.repeat(32),
    invoiceSourceHash: document.sourceHash,
    receiptDigest: 'cd'.repeat(32),
    formula: {
      id: formula.formulaId,
      version: formula.formulaVersion,
      sourceHash: formula.formulaSourceHash,
      sheet: formula.formulaSourceSheet,
      cells: formula.formulaSourceCells,
      applicabilityConfirmed: true,
    },
    input,
    receiptSnapshot: {
      warehouseKey: 901,
      details: receipt.map(line => ({
        lineId: line.lineId,
        wdetailKey: line.wdetailKey,
        prodKey: line.prodKey,
        outQuantity: line.outQuantity,
        boxQuantity: line.boxQuantity,
        stemQuantity: line.stemQuantity,
        unitPrice: line.unitPrice,
        lineAmount: line.lineAmount,
      })),
    },
  };
  return { document, revision, snapshot };
}

test('중국 신형 CLOUD(항공) · HUBFRESH(해상) .xlsx → parseArrivalCostWorkbook + summarizeReview 100% 라운드트립', async () => {
  for (const [fixtureName, mode, headerOverride] of [
    ['cloud-8249', 'CLOUD', { exchangeRate: 210, gw: 1823, cw: 2452, airFreight: 23168, quarantineCount: 18 }],
    ['hubfresh-8170', 'HUBFRESH', { exchangeRate: 210, nenovaCbm: 15.266, realCbm: 57.5035, seaFreight: 29600, processBoxes: 342, quarantineBoxes: 418 }],
    ['hubfresh-8259', 'HUBFRESH', { exchangeRate: 210, nenovaCbm: 23.63, realCbm: 68.009, seaFreight: 55600, processBoxes: 466, quarantineBoxes: 513 }],
  ]) {
    const f = loadCnFixture(fixtureName);
    const source = cnSourceFromDbRows(f.dbRows);
    const draft = buildCnDraft(source, { mode });
    const payload = normalizeCnPayload({
      mode,
      header: { ...draft.header, ...headerOverride },
      rows: draft.rows,
      warehouseKey: draft.warehouseKey,
      orderYear: '2026',
      orderWeek: draft.orderWeek,
      farmName: draft.farmName,
    });
    const expected = computeCnCost(payload);
    const { buffer, sheetName } = await createCnArrivalCostWorkbook(payload);
    const fileName = `중국도착원가_${mode}_2026_${draft.orderWeek}_${draft.warehouseKey}.xlsx`;

    assert.equal(namedCountry(fileName, sheetName), '중국');
    assert.equal(namedCountry(`HUBFRESH_${sheetName}.xlsx`, sheetName), '중국');

    const products = [...new Map(draft.rows.map((r, i) => {
      const pk = r.prodKey || (9000 + i);
      return [pk, {
        ProdKey: pk,
        ProdName: r.name,
        DisplayName: r.name,
        FlowerName: '기타',
        CounName: '중국',
        OutUnit: '단',
      }];
    })).values()];

    const reviews = prepareSheetReviews([{
      sheetName,
      selected: true,
      country: '중국',
      orderWeek: sheetName,
      confirmYear: false,
    }], fileName);

    const parsed = parseArrivalCostWorkbook(buffer, {
      fileName,
      orderYear: '2026',
      products,
      sheetReviews: reviews,
    });

    assert.equal(parsed.rowCount, expected.rows.length, `${fixtureName}: 전 품목행 누락 없이 파싱`);
    assert.equal(parsed.rejectedRows.length, 0, `${fixtureName}: 원가 누락 행 0건`);
    assert.equal(parsed.unmatchedCount, 0, `${fixtureName}: 농장 무관 중국 품목 매칭 시 MATCHED 처리`);

    const summary = summarizeReview(parsed, reviews, '2026');
    assert.equal(summary.canCommit, true, `${fixtureName}: 연도(A1 2026)·국가·차수 자동 검증으로 즉시 저장 가능`);

    for (let i = 0; i < expected.rows.length; i += 1) {
      const exp = expected.rows[i];
      const act = parsed.rows[i];
      assert.equal(act.countryName, '중국');
      assert.equal(act.unit, '단');
      assert.equal(act.quantity, exp.quantity);
      assert.ok(!/^\d+$/.test(act.farmNameRaw), 'No 순번 열이 농장명으로 오인되면 안 됨');
      assert.ok(Math.abs(act.sourceArrivalCostKRW - exp.cost) < 0.01, `${fixtureName} row ${i}: 도착원가(단) 일치 (${act.sourceArrivalCostKRW} vs ${exp.cost})`);
      assert.ok(Math.abs(act.sourceArrivalCostPerStemKRW - exp.costPerStem) < 0.01, `${fixtureName} row ${i}: 줄기당 원가 일치`);
      assert.ok(Math.abs((act.customsPerUnitKRW || 0) - exp.duty) < 0.01, `${fixtureName} row ${i}: 관세(원)가 관세율과 혼동되지 않아야 함`);
      assert.ok(Math.abs((act.otherPerUnitKRW || 0) - exp.customs) < 0.01, `${fixtureName} row ${i}: 그외통관(단) 일치`);
    }
  }
});

test('3개국(콜롬비아 · 네덜란드 · 중국) 생성 .xlsx → parseArrivalCostWorkbook + summarizeReview 계약 검증', async () => {
  const coFixture = buildInvoiceExportFixture(4, 'CO_GROUP_42_1_V1');
  const coBytes = await createInvoiceCostWorkbook(coFixture);
  const coProducts = coFixture.document.lines.map(l => ({
    ProdKey: l.prodKey,
    ProdName: l.originalName,
    FlowerName: '수국',
    CounName: '콜롬비아',
    OutUnit: '단',
  }));
  const coFarms = [{ FarmKey: 10, FarmName: 'Antioquia' }];
  const coReviews = prepareSheetReviews([{ sheetName: '48-2', selected: true, country: '콜롬비아', orderWeek: '48-02', confirmYear: true }], '콜롬비아_공동원가_2026_48-02.xlsx');
  const coParsed = parseArrivalCostWorkbook(coBytes, {
    fileName: '콜롬비아_공동원가_2026_48-02.xlsx',
    orderYear: '2026',
    products: coProducts,
    farms: coFarms,
    sheetReviews: coReviews,
  });
  assert.equal(coParsed.rowCount, 4);
  assert.equal(coParsed.rejectedRows.length, 0);
  assert.equal(coParsed.unmatchedCount, 0);
  assert.equal(summarizeReview(coParsed, coReviews, '2026').canCommit, true);

  const nlFixture = buildInvoiceExportFixture(3, 'NL_AMOUNT_V1');
  const nlBytes = await createInvoiceCostWorkbook(nlFixture);
  const nlProducts = nlFixture.document.lines.map(l => ({
    ProdKey: l.prodKey,
    ProdName: l.originalName,
    FlowerName: '아가판서스',
    CounName: '네덜란드',
    OutUnit: '단',
  }));
  const nlReviews = prepareSheetReviews([{ sheetName: '48-2', selected: true, country: '네덜란드', orderWeek: '48-02', confirmYear: true }], '네덜란드_도착원가_계산본_2026_48-02_901.xlsx');
  const nlParsed = parseArrivalCostWorkbook(nlBytes, {
    fileName: '네덜란드_도착원가_계산본_2026_48-02_901.xlsx',
    orderYear: '2026',
    products: nlProducts,
    sheetReviews: nlReviews,
  });
  assert.equal(nlParsed.rowCount, 3);
  assert.equal(nlParsed.rejectedRows.length, 0);
  assert.equal(nlParsed.unmatchedCount, 0, '네덜란드는 농장 열이 없어도 품목 매칭 시 MATCHED 처리');
  assert.equal(summarizeReview(nlParsed, nlReviews, '2026').canCommit, true);
});

test('타 메뉴 연동: NL·CN 농장 무관 국가 원가의 profitReport 누락 해소 및 안전 가드 유지', () => {
  assert.equal(isFarmlessArrivalCountry('네덜란드'), true);
  assert.equal(isFarmlessArrivalCountry('중국'), true);
  assert.equal(isFarmlessArrivalCountry('콜롬비아'), false);

  const baseRow = {
    arrivalLineKey: 501,
    importKey: 55,
    revisionNo: 4,
    orderYear: '2026',
    orderWeek: '45-01',
    prodKey: 3355,
    farmKey: 0,
    farmNameRaw: '',
    countryName: '네덜란드',
    isCurrent: 1,
    importIsDeleted: 0,
    matchStatus: 'FARM_REQUIRED',
    confirmationAction: 'REVIEW_UPLOAD',
    selectedArrivalCostKRW: 4384,
    sourceArrivalCostKRW: 4384,
    quantity: 30,
    unit: '단',
    sourceFileName: '45-1 NL 원가자료.xlsx',
    sheetName: '45-1',
    sourceRow: 18,
    confirmedBy: 'nenovaSS4',
    confirmedAt: '2026-11-10T02:00:00Z',
  };

  const nlReviewResolved = resolveExactArrivalPriceEvidence([baseRow], {
    orderYear: 2026,
    orderWeek: '45-01',
    prodKey: 3355,
    estimateUnit: '단',
  });
  assert.equal(nlReviewResolved.status, 'PASS', 'NL FARM_REQUIRED + REVIEW_UPLOAD 확정행은 매출이익 원가 근거로 인정');
  assert.equal(nlReviewResolved.value, 4384);

  const cnMatchResolved = resolveExactArrivalPriceEvidence([{
    ...baseRow,
    countryName: '중국',
    farmNameRaw: 'CLOUD',
    orderWeek: '45-02',
    confirmationAction: 'REVIEW_UPLOAD',
    selectedArrivalCostKRW: 8207,
    sourceArrivalCostKRW: 8207,
  }], {
    orderYear: 2026,
    orderWeek: '45-02',
    prodKey: 3355,
    estimateUnit: '단',
  });
  assert.equal(cnMatchResolved.status, 'PASS', 'CN FARM_REQUIRED(FarmNameRaw=CLOUD, FarmKey=0) + REVIEW_UPLOAD/MATCH 확정행도 매출이익 원가 근거로 인정');
  assert.equal(cnMatchResolved.value, 8207);

  const coMissingFarm = resolveExactArrivalPriceEvidence([{
    ...baseRow,
    countryName: '콜롬비아',
    matchStatus: 'FARM_REQUIRED',
  }], {
    orderYear: 2026,
    orderWeek: '45-01',
    prodKey: 3355,
    estimateUnit: '단',
  });
  assert.equal(coMissingFarm.status, 'INPUT_REQUIRED', '콜롬비아 등 농장 필수 국가의 FARM_REQUIRED 미매칭 행은 계속 차단');

  const unreviewedUpload = resolveExactArrivalPriceEvidence([{
    ...baseRow,
    confirmationAction: 'UPLOAD',
  }], {
    orderYear: 2026,
    orderWeek: '45-01',
    prodKey: 3355,
    estimateUnit: '단',
  });
  assert.equal(unreviewedUpload.status, 'INPUT_REQUIRED', '검토 없는 단순 UPLOAD 자동매칭 행은 계속 차단');

  const profitSource = fs.readFileSync(path.join(root, 'lib', 'profitReport.js'), 'utf8');
  assert.match(profitSource, /h\.ActionType=N'REVIEW_UPLOAD'/);
  assert.match(profitSource, /l\.MatchStatus=N'FARM_REQUIRED'[\s\S]*?l\.CountryName IN \(N'네덜란드',N'중국'\)/);
});

test('전 구간 품종·농장·품목 3단 원클릭 버튼 조회 · 사용금지수국 정제 · 업로드 검토 브릿지 계약', async () => {
  assert.equal(cleanDeprecatedOriginToken('사용금지'), '');
  assert.equal(cleanDeprecatedOriginToken('사용금지수국'), '수국');
  assert.equal(arrivalCountryFlowerKey({ CountryFlower: '사용금지수국', CountryName: '콜롬비아', CounName: '사용금지', FlowerName: '수국' }), '콜롬비아수국');
  assert.equal(arrivalCountryFlowerKey({ CountryFlower: '사용금지수국', CounName: '사용금지', FlowerName: '수국' }), '수국');
  assert.equal(cleanArrivalVarietyTabLabel('사용금지수국'), '수국');
  assert.deepEqual(normalizeArrivalVarietyTabs(['콜롬비아수국', '사용금지수국', '수국', '콜롬비아장미']), ['콜롬비아수국', '수국', '콜롬비아장미']);

  const sampleRows = [
    { arrivalLineKey: 1, orderWeek: '48-2', countryName: '콜롬비아', countryFlower: '사용금지수국', dbFlowerName: '수국', displayName: 'Hydrangea Lavender', farmName: 'Balverde', quantity: 120, unit: '송이', selectedArrivalCostKRW: 1940, uploadStatus: 'UPLOADED' },
    { arrivalLineKey: 2, orderWeek: '48-2', countryName: '콜롬비아', countryFlower: '콜롬비아장미', dbFlowerName: '장미', displayName: 'ROSE Freedom', farmName: 'Ayura', quantity: 250, unit: '송이', selectedArrivalCostKRW: 980, uploadStatus: 'UPLOADED' },
    { arrivalLineKey: 3, orderWeek: '48-1', countryName: '네덜란드', countryFlower: '네덜란드', dbFlowerName: '', displayName: 'Tulip White', farmName: '', quantity: 40, unit: '단', selectedArrivalCostKRW: 4500, uploadStatus: 'UPLOADED' },
  ];
  assert.equal(cleanArrivalFlowerChip(sampleRows[0]), '수국');
  const chipsAll = buildArrivalThreeTierChips(sampleRows);
  assert.ok(!chipsAll.varietyButtons.some(v => v.label.includes('사용금지')), '사용금지수국 노출 0건');
  assert.ok(chipsAll.varietyButtons.some(v => v.label === '수국' && v.count === 1));
  assert.deepEqual(chipsAll.farmButtons.map(f => f.farmName), ['Ayura', 'Balverde'], '농장 없는 네덜란드 행은 빈 농장 버튼을 만들지 않음');

  const filtered = filterArrivalRowsThreeTier(sampleRows, { selectedVarieties: ['수국'], selectedFarms: ['Balverde'], selectedProducts: ['Hydrangea Lavender'] });
  assert.equal(filtered.length, 1);
  const sub = summarizeArrivalFilteredRows(filtered);
  assert.equal(sub.totalCostKRW, 120 * 1940);

  // 업로드 검토 브릿지 인라인 & 세션 스토리지 라운드트립
  assert.equal(arrivalBridgeCountryLabel('CO'), '콜롬비아');
  assert.equal(arrivalBridgeCountryLabel('NL'), '네덜란드');
  assert.equal(arrivalBridgeCountryLabel('CN'), '중국');
  const blob = new Blob([new Uint8Array([80, 75, 3, 4])], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const file = toArrivalXlsxFile(blob, '중국도착원가_CLOUD_2026_47-02_8249.xlsx');
  assert.equal(file.name, '중국도착원가_CLOUD_2026_47-02_8249.xlsx');
  let inlineReceived = null;
  const inlineRes = await sendWorkbookToArrivalUploadReview({
    blob,
    fileName: file.name,
    orderYear: '2026',
    orderWeek: '47-02',
    country: 'CN',
    onSendToUploadReview: payload => { inlineReceived = payload; },
  });
  assert.equal(inlineRes.mode, 'inline');
  assert.equal(inlineReceived.country, '중국');
  assert.equal(inlineReceived.orderWeek, '47-02');
  assert.equal(consumePendingArrivalUploadBridge(), null);
  assert.ok(ARRIVAL_UPLOAD_BRIDGE_KEY.includes('uploadBridge'));

  // 화면 소스 계약 확인: 오해 문구 제거 + 전 계산기 브릿지 버튼 + 3단 버튼 바
  const pageSrc = fs.readFileSync(path.join(root, 'pages', 'arrival-cost.js'), 'utf8');
  assert.doesNotMatch(pageSrc, /엑셀 재업로드는 필요 없습니다/);
  assert.match(pageSrc, /도착원가 업로드 검토로 바로 보내기/);
  assert.match(pageSrc, /aria-label="품종·농장·품목 원클릭 필터"/);
  assert.match(pageSrc, /aria-label="품종별 버튼 필터"/);
  assert.match(pageSrc, /aria-label="농장별 버튼 필터"/);
  assert.match(pageSrc, /aria-label="품목별 버튼 필터"/);

  for (const rel of [
    'components/import-tools/CnArrivalCostWorkbench.js',
    'components/import-tools/SharedAwbCostReview.js',
    'components/import-tools/NativeReceiptCost.js',
    'components/import-tools/InvoiceReceiptCostReview.js',
    'components/import-tools/ArrivalWeekCostReview.js',
  ]) {
    const compSrc = fs.readFileSync(path.join(root, rel), 'utf8');
    assert.match(compSrc, /도착원가 업로드 검토로 바로 보내기/, `${rel}: 원클릭 브릿지 버튼 존재`);
  }

  // 웹·데스크톱 도착원가 표: 농장|품종|품목 순서 배치 + 상단(top:0) 및 좌측(left:...) 동시 고정헤드(Sticky) 계약
  const sharedUi = fs.readFileSync(path.join(root, 'components/import-tools/SharedAwbCostReview.js'), 'utf8');
  assert.match(sharedUi, /<th>농장·송장<\/th>\s*<th>품종<\/th>\s*<th>품목<\/th>/);
  assert.match(sharedUi, /<th>농장<\/th>\s*<th>품종<\/th>\s*<th>품목명<\/th>/);
  const cnUi = fs.readFileSync(path.join(root, 'components/import-tools/CnArrivalCostWorkbench.js'), 'utf8');
  assert.match(cnUi, /<th>No<\/th><th>품종<\/th><th>품명<\/th><th>수량\(단\)<\/th>/);
  assert.match(pageSrc, /<th>차수<\/th><th>국가<\/th><th>품종<\/th><th>품목<\/th><th>농장별 원가<\/th>/);
  assert.match(pageSrc, /position:\s*sticky;\s*left:\s*0/);
  for (const cssRel of [
    'styles/ArrivalCostLedger.module.css',
    'styles/CnArrivalCost.module.css',
    'styles/InvoiceReceiptCost.module.css',
  ]) {
    const cssSrc = fs.readFileSync(path.join(root, cssRel), 'utf8');
    assert.match(cssSrc, /position:\s*sticky[\s\S]*?top:\s*0/, `${cssRel}: 상단 고정헤드(top:0)`);
    assert.match(cssSrc, /position:\s*sticky[\s\S]*?left:\s*0/, `${cssRel}: 좌측 식별열 고정(left:0)`);
    assert.match(cssSrc, /border-collapse:\s*separate/, `${cssRel}: sticky 테두리 깨짐 방지 border-collapse: separate`);
  }
});
