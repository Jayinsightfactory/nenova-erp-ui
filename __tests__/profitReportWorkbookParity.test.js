// 주차별 매출이익 보고서 — 22~26차 완성본과 수식 포함 26차 파일 회귀 검증
// 실행: node __tests__/profitReportWorkbookParity.test.js
const fs = require('fs');
const path = require('path');

const near = (actual, expected, tolerance = 0.01) => Math.abs(Number(actual) - Number(expected)) <= tolerance;
let failed = 0;
const check = (label, condition, detail = '') => {
  if (condition) console.log(`  ✓ ${label}`);
  else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
    failed += 1;
  }
};

async function main() {
  const {
    RATE_DEFAULTS,
    computeCountryCustomsTotal,
    computeColombiaAllocation,
  } = await import('../lib/customsForwarding.js');
  const { computeAutoEndingStock, computeProfitRow, computeProfitTotals } = await import('../lib/profitReportCalc.js');
  const { buildProfitReportAudit } = await import('../lib/profitReportAudit.js');
  const { formatUnclassifiedNote, composeProfitReportNote } = await import('../lib/profitReportNotes.js');

  console.log('=== 22~26차 공통 콜롬비아 배부계수 ===');
  check('장미 박스당 무게 = 7', RATE_DEFAULTS.BoxWeight_콜롬비아장미 === 7);
  check('카네이션 박스당 CBM = 11', RATE_DEFAULTS.BoxCBM_콜롬비아카네이션 === 11);

  console.log('\n=== 26차 콜롬비아 1·2차 H/S 합계 ===');
  const first = computeColombiaAllocation(
    { GW: 6706, CW: 6706, CustomsFee: 3432760 - 6706 * 460, AirRateUSD: 18191.2 },
    { '콜롬비아 장미': 209, '콜롬비아 카네이션': 441, '콜롬비아 알스트로': 16, '콜롬비아 루스커스': 27 },
    RATE_DEFAULTS,
  );
  const second = computeColombiaAllocation(
    { GW: 655, CW: 670, CustomsFee: 473300 - 655 * 460, AirRateUSD: 1915.5 },
    { '콜롬비아 장미': 27, '콜롬비아 카네이션': 40, '콜롬비아 알스트로': 4, '콜롬비아 루스커스': 0 },
    RATE_DEFAULTS,
  );
  const expected26 = {
    '콜롬비아 장미': { H: 885183.5906745286, S: 4681.784366047753 },
    '콜롬비아 카네이션': { H: 2802770.9065670753, S: 14342.162838041953 },
    '콜롬비아 알스트로': { H: 107192.41713642544, S: 494.99189122532044 },
    '콜롬비아 루스커스': { H: 110913.08562197092, S: 587.760904684976 },
  };
  for (const [category, expected] of Object.entries(expected26)) {
    const actualH = first[category].H + second[category].H;
    const actualS = first[category].S + second[category].S;
    check(`${category} H`, near(actualH, expected.H, 0.02), `${actualH} != ${expected.H}`);
    check(`${category} S`, near(actualS, expected.S, 0.0001), `${actualS} != ${expected.S}`);
  }

  console.log('\n=== 베트남 선율 공급가 예외 ===');
  const vietnamRow = { GW1: 270, Customs1: 818650, SunYul1: 69300, WorldFreight1: 99000 };
  check('베트남 H = 1,102,150', near(computeCountryCustomsTotal(vietnamRow, RATE_DEFAULTS, '베트남'), 1102150));
  check('일반 국가는 선율 ÷1.1 유지', near(computeCountryCustomsTotal(vietnamRow, RATE_DEFAULTS, '태국'), 1095850));

  console.log('\n=== 본표 계산식 ===');
  const normal = computeProfitRow({
    category: '태국', variant: 'normal', stock: {},
    auto: { N: 1000, L: -100, O: 50, Q: 2, R: 1500, S: 1, H: 100, E: 200, F: 300 },
    manual: {},
  });
  check('C=N+L+O', near(normal.C, 950));
  check('G=Q×R+S×R', near(normal.G, 4500));
  check('I=E+G+H-F', near(normal.I, 4500));
  check('J=C-I', near(normal.J, -3550));
  const clearedF = computeProfitRow({
    category: '태국', variant: 'normal', stock: {},
    auto: { N: 1000, L: 0, O: 0, Q: 0, R: 1, S: 0, H: 0, E: 0, F: 300 },
    manual: { F: 999 },
  }, { 태국: { F: '' } });
  check('F 수기값을 비우면 자동값으로 즉시 복귀', near(clearedF.F, 300));
  const noEnding = computeProfitRow({
    category: '일본', variant: 'noEnding', stock: {},
    auto: { N: 1000, L: 0, O: 0, Q: 1, R: 100, S: 0, H: 0, E: 20, F: 30 }, manual: {},
  });
  check('이스라엘/뉴질랜드/일본 J=C-I+F', near(noEnding.J, 910));
  const totals = computeProfitTotals([
    { category: '태국', calc: normal },
    { category: '공제', calc: { C: -10, E: 0, F: 0, J: -10, G: 999, H: 999, I: 999, L: 0, N: 0, O: -10, P: 0, Q: 0, S: 0, T: 0 } },
  ]);
  check('합계 C는 공제 포함', near(totals.C, 940));
  check('합계 G는 공제 제외', near(totals.G, 4500));

  console.log('\n=== 재고·환율·감사 회귀 ===');
  const reportSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'profitReport.js'), 'utf8');
  const reportApiSource = fs.readFileSync(path.join(__dirname, '..', 'pages', 'api', 'sales', 'profit-report.js'), 'utf8');
  const pageSource = fs.readFileSync(path.join(__dirname, '..', 'pages', 'sales', 'profit-report.js'), 'utf8');
  const customsPanelSource = fs.readFileSync(path.join(__dirname, '..', 'components', 'CustomsClearancePanel.js'), 'utf8');
  const stockApiSource = fs.readFileSync(path.join(__dirname, '..', 'pages', 'api', 'stock', 'index.js'), 'utf8');
  const stockSection = reportSource.slice(reportSource.indexOf('export async function stockSnapshotByCategory'), reportSource.indexOf('/** 카테고리별 구매 통화'));
  check('재고수량은 EXE 재고현황 마지막 Stock 열을 직접 사용', stockSection.includes('SUM(ps.Stock * (${STOCK_TO_EST_UNIT_EXPR})) AS q'));
  check('기말 스냅샷은 마지막 ProductStock 세부차수를 선택',
    reportSource.includes('export async function latestStockSnapshotWeek')
      && reportSource.includes('EXISTS (SELECT 1 FROM ProductStock ps WHERE ps.StockKey=sm.StockKey)')
      && reportSource.includes('OrderWeek LIKE @pfx')
      && reportSource.includes('TRY_CONVERT(INT, SUBSTRING(sm.OrderWeek, CHARINDEX(\'-\', sm.OrderWeek)+1, 10)) DESC')
      && reportSource.slice(reportSource.indexOf('export async function latestStockSnapshotWeek'), reportSource.indexOf('/** 재고단가표 편집용')).includes('ISNULL(sm.isFix,0)=1'));
  check('단가표도 동일한 마지막 ProductStock 스냅샷을 사용', reportSource.includes('latestStockSnapshotWeek(major, orderYear)') && reportSource.includes('latestStockSnapshotWeek(prevMajor, prevOrderYear)'));
  check('중복 StockMaster는 선택된 StockKey 하나만 집계', stockSection.includes('smk.StockKey=@stockKey') && reportSource.includes('smk.StockKey = @beginStockKey'));
  check('01차 기초재고는 전년도 전차수 스냅샷을 사용', reportApiSource.includes("currentMajor <= 1 ? String(Number(orderYear) - 1) : String(orderYear)") && reportApiSource.includes("currentMajor <= 1 ? '52'"));
  check('27차 기초재고는 같은 연도의 26차 스냅샷을 사용', reportApiSource.includes('currentMajor <= 1 ? String(Number(orderYear) - 1) : String(orderYear)') && reportApiSource.includes("currentMajor - 1).padStart(2, '0')"));
  check('시작재고·입출고를 보고서에서 임의 재계산하지 않음', !stockSection.includes('FlowDelta') && !stockSection.includes('EffectiveStock'));
  check('박스→단/송이와 단→송이 환산을 구분', reportSource.includes("p.OutUnit,N'') = N'박스'") && reportSource.includes("p.EstUnit,N'') = N'단'") && reportSource.includes("p.OutUnit,N'') = N'단'") && reportSource.includes("p.EstUnit,N'') = N'송이'"));
  check('음수 재고도 감사 대상으로 조회', stockSection.includes('ISNULL(ps.Stock,0) <> 0'));
  const countryResolverSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'profitReportCountryResolver.js'), 'utf8');
  check('호주는 AUD', countryResolverSource.includes("호주: 'AUD'"));
  check('차수별 인보이스 환율 스냅샷을 현재 환율보다 우선', reportSource.includes('export async function invoiceRatesByCategory') && reportSource.includes('FreightCost fc') && reportSource.includes('fc.ExchangeRate'));
  check('과거 환율은 당주 정확 원천만 자동 적용하고 전차수·CurrencyMaster는 제안으로만 표시',
    reportApiSource.includes('resolveTaxableRate')
      && reportApiSource.includes('rateSuggestions')
      && !reportApiSource.includes('previous_report_taxable_rate')
      && !reportApiSource.includes('currency_master_fallback'));
  check('환율 원천이 없으면 해당 R 입력칸을 자동 노출', pageSource.includes('function needsRateInput') && pageSource.includes("cd.key === 'R' && needsRateInput(row)") && pageSource.includes('과세환율(R) 입력 필요'));
  check('보고서 저장 뒤 과세환율 캐시 저장 실패를 조용히 무시하지 않음',
    pageSource.includes('과세환율 별도 저장 실패')
      && pageSource.includes('보고서 수기값은 저장되었습니다.')
      && !pageSource.includes("}).catch(() => null));"));
  // 2026-08-11: 각 함수의 인라인 LIKE '%운송료%' 조건이 공용 stockablePurchaseItemSql()로
  // 통합됐다(27차 F 폭증 결함 수정 — 상세는 __tests__/profitReportStockCostExclusionContract.test.js).
  // 원래 의도(Q와 매입수량 모두 포워딩/운송료 행을 제외해 이중계상하지 않음)는 두 함수 각각이
  // 공용 조건을 실제로 사용하는지로 검증한다.
  const purchaseByCategorySection = reportSource.slice(
    reportSource.indexOf('export async function purchaseByCategory'),
    reportSource.indexOf('export async function forwardingByCategory'));
  const purchaseQtyByCategorySection = reportSource.slice(
    reportSource.indexOf('export async function purchaseQtyByCategory'),
    reportSource.indexOf('export async function invoiceRatesByCategory'));
  check('Q와 매입수량에서 포워딩/운송료 행 이중계상 차단',
    purchaseByCategorySection.includes("stockablePurchaseItemSql('p')")
      && purchaseQtyByCategorySection.includes("stockablePurchaseItemSql('p')"));
  check('매출·불량·그외매출은 전산 확정 ShipmentMaster만 집계',
    (reportSource.match(/ISNULL\(sm\.isFix,0\)=1/g) || []).length >= 2);
  check('전산 호환 재고조회는 요청한 세부차수를 정확히 선택', stockApiSource.includes('WHERE OrderWeek=@week AND OrderYear=@year'));
  check('E/F 최종값은 입력 셀로 노출하지 않음',
    !/key: 'E'[^\n]*editable: true/.test(pageSource) && !/key: 'F'[^\n]*editable: true/.test(pageSource));
  check('표시·입력값은 소수점 없이 천 단위 콤마 적용', pageSource.includes('function NumericInput') && pageSource.includes('Math.round(n).toLocaleString()') && pageSource.includes('Math.round(Number(raw))'));
  check('통관·포워딩 입력 패널은 기본 접힘', pageSource.includes("const [showCustoms, setShowCustoms] = useState(false)") && pageSource.includes("const [showForwarding, setShowForwarding] = useState(false)"));
  check('수기 보정은 기본 접힘·누락 환율만 자동 입력 노출', pageSource.includes("const [showOverrides, setShowOverrides] = useState(false)") && pageSource.includes("showOverrides || (cd.key === 'R' && needsRateInput(row))"));
  check('비고사항은 별도 저장 버튼으로 저장', pageSource.includes("const [noteDirty, setNoteDirty] = useState(false)") && pageSource.includes("action: 'saveNote'") && pageSource.includes('비고 저장'));
  check('비고사항 변경은 전체 저장·엑셀 다운로드 전에 반영', pageSource.includes('const dirty = Object.keys(edits).length > 0 || noteDirty') && (pageSource.includes('if (dirty) await save()') || pageSource.includes('if (dirty && !(await save())) return')));
  check('비고사항은 WebProfitReport TextValue로 연도·차수별 저장', reportSource.includes("if (note != null) await upsert('_note', 'note', null, note)") && reportApiSource.includes("req.body?.action === 'saveNote'") && reportApiSource.includes('slice(0, 2000)'));
  check('관세·선율 분할 입력칸은 금액 전체가 보이도록 가로 폭 확보', customsPanelSource.includes('minWidth: 235') && customsPanelSource.includes('minWidth: 1500') && customsPanelSource.includes('splitInput: { width: 68'));
  check('통관비 숫자 입력은 엔터로 다음 입력칸 이동', customsPanelSource.includes('focusNextCustomsInput') && customsPanelSource.includes("onKeyDown={focusNextCustomsInput}"));
  check('월드운송료는 부가세 제외값을 화면에 표시', customsPanelSource.includes('vatInclusiveToNet') && customsPanelSource.includes('vatNetToInclusive'));
  check('기타 미분류 품목은 자동 비고·엑셀에 포함', reportSource.includes('unclassifiedDetailsByCategory') && reportApiSource.includes('composeProfitReportNote') && pageSource.includes('data.autoNote'));

  const autoUnclassifiedNote = formatUnclassifiedNote([
    { source: '입고', country: '미상', flower: '미상', product: '테스트 품목', quantity: 12, amount: 3456 },
    { source: '입고', country: '미상', flower: '미상', product: '테스트 품목', quantity: 3, amount: 444 },
  ]);
  check('미분류 비고에 원천·국가·품종·품명·합계가 표시', autoUnclassifiedNote.includes('입고: 미상 / 미상 / 테스트 품목') && autoUnclassifiedNote.includes('수량 15') && autoUnclassifiedNote.includes('금액 3,900'));
  check('사용자 비고와 자동 미분류 비고가 함께 보존', composeProfitReportNote('사용자 메모', autoUnclassifiedNote).includes('사용자 메모') && composeProfitReportNote('사용자 메모', autoUnclassifiedNote).includes('[자동 미분류 내역]'));

  const audited = buildProfitReportAudit([{
    category: '태국', currency: 'USD',
    auto: { N: 100, Q: 10, S: 2, R: 1550 }, manual: {},
    stock: { endQty: 3, missingPriceCount: 1 },
    source: { E: 'verified_product_stock_price', H: 'missing', F: 'missing_price_evidence', R: 'saved_official_week' },
  }, {
    category: '기타(미분류)', auto: { N: 50 }, manual: {}, stock: {}, source: {},
  }]);
  check('자동 환율이 있으면 환율 입력 경고를 만들지 않음', !audited.issues.some((x) => x.code === 'INVOICE_RATE_REQUIRED' || x.code === 'INVOICE_RATE_MISSING'));
  check('누락 H·재고단가 근거·미분류만 검출', audited.issues.length === 3, JSON.stringify(audited.issues));
  check('확정 불가 상태 표시', audited.status === 'needs_input');

  const missingRate = buildProfitReportAudit([{
    category: '태국', currency: 'USD',
    auto: { N: 100, Q: 10, S: 2, R: null }, manual: {},
    stock: {}, source: { H: 'gw_auto', R: 'missing' },
  }]);
  check('자동 환율도 없을 때만 환율 누락을 검출', missingRate.issues.some((x) => x.code === 'TAXABLE_RATE_MISSING'));

  const beforeCountryInput = buildProfitReportAudit([{
    category: '호주', currency: 'AUD', auto: { Q: 100, S: 0, R: null, H: 0 }, manual: {}, stock: {},
    source: { H: 'missing', R: 'missing' },
  }, {
    category: '베트남', currency: 'USD', auto: { Q: 0, S: 0, R: 1550, H: 0 }, manual: {}, stock: {},
    source: { H: 'missing', R: 'currency_master_fallback' },
  }], { major: 27 });
  check('호주 28차 전에는 H 입력은 미적용이지만 구매가 있으면 AUD R은 필수',
    beforeCountryInput.issues.length === 1
      && beforeCountryInput.issues[0].category === '호주'
      && beforeCountryInput.issues[0].code === 'TAXABLE_RATE_MISSING',
    JSON.stringify(beforeCountryInput.issues));

  const afterAustraliaInput = buildProfitReportAudit([{
    category: '호주', currency: 'AUD', auto: { Q: 100, S: 0, R: null, H: 0 }, manual: {}, stock: {},
    source: { H: 'missing', R: 'missing' },
  }], { major: 28 });
  check('호주 28차부터는 H/R 원천 누락을 다시 검출', afterAustraliaInput.issues.some((x) => x.code === 'CUSTOMS_INCOMPLETE') && afterAustraliaInput.issues.some((x) => x.code === 'TAXABLE_RATE_MISSING'));

  const afterVietnamInput = buildProfitReportAudit([{
    category: '베트남', currency: 'USD', auto: { Q: 100, S: 0, R: null, H: 0 }, manual: {}, stock: {},
    source: { H: 'missing', R: 'missing' },
  }], { major: 29 });
  check('베트남 29차부터는 H/R 원천 누락을 검출', afterVietnamInput.issues.some((x) => x.code === 'CUSTOMS_INCOMPLETE') && afterVietnamInput.issues.some((x) => x.code === 'TAXABLE_RATE_MISSING'));

  const negativeStock = buildProfitReportAudit([{
    category: '콜롬비아 장미', currency: 'USD',
    auto: {}, manual: {}, stock: { endQty: -40 }, source: { E: 'verified_product_stock_price', F: 'verified_product_stock_price' },
  }]);
  check('음수 기말재고를 오류로 검출', negativeStock.issues.some((x) => x.code === 'NEGATIVE_STOCK'));

  const rose27StockRows = [2, 4, 5, 6, 10, 10, 10, 10, 10, 10, 15, 16, 16, 18, 20, 27, 40, 50];
  const rose27EndQty = rose27StockRows.reduce((sum, qty) => sum + qty, 0);
  check('27-02 EXE 장미 재고현황 마지막 잔량 합계 = 279단', rose27EndQty === 279);
  const rose27AutoF = computeAutoEndingStock(
    { endQty: rose27EndQty, snapshotConfirmed: true, priceEvidenceStatus: 'VERIFIED', evidenceValue: 2129244.3664138042 },
  );
  check('F는 확정 재고현황 279단과 동일시점 VERIFIED 단가 근거만 반영', near(rose27AutoF, 2129244.3664138042, 0.01));
  check('단가 근거가 없으면 최근원가·도착원가로 폴백하지 않음', computeAutoEndingStock({ endQty: rose27EndQty, snapshotConfirmed: true, priceEvidenceStatus: 'INPUT_REQUIRED', recentCost: 999999 }) == null);

  console.log(`\n총 ${failed ? '실패' : '성공'} — 실패 ${failed}건`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
