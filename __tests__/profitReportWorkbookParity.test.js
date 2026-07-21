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
  const stockApiSource = fs.readFileSync(path.join(__dirname, '..', 'pages', 'api', 'stock', 'index.js'), 'utf8');
  const stockSection = reportSource.slice(reportSource.indexOf('export async function stockSnapshotByCategory'), reportSource.indexOf('/** 카테고리별 구매 통화'));
  check('재고수량은 EXE 재고현황 마지막 Stock 열을 직접 사용', stockSection.includes('SUM(ps.Stock * (${STOCK_TO_EST_UNIT_EXPR})) AS q'));
  check('기말 스냅샷은 마지막 ProductStock 세부차수를 선택',
    reportSource.includes('export async function latestStockSnapshotWeek')
      && reportSource.includes('EXISTS (SELECT 1 FROM ProductStock ps WHERE ps.StockKey=sm.StockKey)')
      && reportSource.includes('OrderWeek LIKE @pfx')
      && reportSource.includes('TRY_CONVERT(INT, SUBSTRING(sm.OrderWeek, CHARINDEX(\'-\', sm.OrderWeek)+1, 10)) DESC')
      && !reportSource.slice(reportSource.indexOf('export async function latestStockSnapshotWeek'), reportSource.indexOf('/** 재고단가표 편집용')).includes('ISNULL(sm.isFix,0)=1'));
  check('단가표도 동일한 마지막 ProductStock 스냅샷을 사용', reportSource.includes('latestStockSnapshotWeek(major, orderYear)') && reportSource.includes('latestStockSnapshotWeek(prevMajor, prevOrderYear)'));
  check('중복 StockMaster는 선택된 StockKey 하나만 집계', stockSection.includes('smk.StockKey=@stockKey') && reportSource.includes('smk.StockKey = @beginStockKey'));
  check('01차 기초재고는 전년도 전차수 스냅샷을 사용', reportApiSource.includes("currentMajor <= 1 ? String(Number(orderYear) - 1) : String(orderYear)") && reportApiSource.includes("currentMajor <= 1 ? '52'"));
  check('27차 기초재고는 같은 연도의 26차 스냅샷을 사용', reportApiSource.includes('currentMajor <= 1 ? String(Number(orderYear) - 1) : String(orderYear)') && reportApiSource.includes("currentMajor - 1).padStart(2, '0')"));
  check('시작재고·입출고를 보고서에서 임의 재계산하지 않음', !stockSection.includes('FlowDelta') && !stockSection.includes('EffectiveStock'));
  check('박스→단/송이와 단→송이 환산을 구분', reportSource.includes("p.OutUnit,N'') = N'박스'") && reportSource.includes("p.EstUnit,N'') = N'단'") && reportSource.includes("p.OutUnit,N'') = N'단'") && reportSource.includes("p.EstUnit,N'') = N'송이'"));
  check('음수 재고도 감사 대상으로 조회', stockSection.includes('ISNULL(ps.Stock,0) <> 0'));
  check('호주는 AUD', reportSource.includes("'호주': 'AUD'"));
  check('차수별 인보이스 환율 스냅샷을 현재 환율보다 우선', reportSource.includes('export async function invoiceRatesByCategory') && reportSource.includes('FreightCost fc') && reportSource.includes('fc.ExchangeRate'));
  check('Q와 매입수량에서 포워딩 행 이중계상 차단', (reportSource.match(/ProdName,N''\) LIKE N'%운송료%'/g) || []).length >= 2);
  check('매출·불량·그외매출은 전산 확정 ShipmentMaster만 집계',
    (reportSource.match(/ISNULL\(sm\.isFix,0\)=1/g) || []).length >= 2);
  check('전산 호환 재고조회는 요청한 세부차수를 정확히 선택', stockApiSource.includes('WHERE OrderWeek=@week AND OrderYear=@year'));
  check('F 자동 계산값을 입력 셀 실값으로 표시', pageSource.includes("autoValue={cd.key === 'F' ? c.F : undefined}"));
  check('표시·입력값은 소수점 없이 천 단위 콤마 적용', pageSource.includes('function NumericInput') && pageSource.includes('Math.round(n).toLocaleString()') && pageSource.includes('Math.round(Number(raw))'));
  check('통관·포워딩 입력 패널은 기본 접힘', pageSource.includes("const [showCustoms, setShowCustoms] = useState(false)") && pageSource.includes("const [showForwarding, setShowForwarding] = useState(false)"));
  check('수기 보정은 기본 접힘', pageSource.includes("const [showOverrides, setShowOverrides] = useState(false)") && pageSource.includes('showOverrides && cd.editable'));
  check('비고사항은 별도 저장 버튼으로 저장', pageSource.includes("const [noteDirty, setNoteDirty] = useState(false)") && pageSource.includes("action: 'saveNote'") && pageSource.includes('비고 저장'));
  check('비고사항 변경은 전체 저장·엑셀 다운로드 전에 반영', pageSource.includes('const dirty = Object.keys(edits).length > 0 || noteDirty') && pageSource.includes('if (dirty) await save()'));
  check('비고사항은 WebProfitReport TextValue로 연도·차수별 저장', reportSource.includes("if (note != null) await upsert('_note', 'note', null, note)") && reportApiSource.includes("req.body?.action === 'saveNote'") && reportApiSource.includes('slice(0, 2000)'));

  const audited = buildProfitReportAudit([{
    category: '태국', currency: 'USD',
    auto: { N: 100, Q: 10, S: 2, R: 1550 }, manual: {},
    stock: { endQty: 3 },
    source: { E: 'auto_exe_stock_view', H: 'missing', F: 'auto_unverified_snapshot', R: 'currency_master_fallback' },
  }, {
    category: '기타(미분류)', auto: { N: 50 }, manual: {}, stock: {}, source: {},
  }]);
  check('자동 환율이 있으면 환율 입력 경고를 만들지 않음', !audited.issues.some((x) => x.code === 'INVOICE_RATE_REQUIRED' || x.code === 'INVOICE_RATE_MISSING'));
  check('누락 H·미실사재고·미분류만 검출', audited.issues.length === 3, JSON.stringify(audited.issues));
  check('확정 불가 상태 표시', audited.status === 'needs_input');

  const missingRate = buildProfitReportAudit([{
    category: '태국', currency: 'USD',
    auto: { N: 100, Q: 10, S: 2, R: null }, manual: {},
    stock: {}, source: { H: 'gw_auto', R: 'missing' },
  }]);
  check('자동 환율도 없을 때만 환율 누락을 검출', missingRate.issues.some((x) => x.code === 'INVOICE_RATE_MISSING'));

  const beforeCountryInput = buildProfitReportAudit([{
    category: '호주', currency: 'AUD', auto: { Q: 100, S: 0, R: null, H: 0 }, manual: {}, stock: {},
    source: { H: 'missing', R: 'missing' },
  }, {
    category: '베트남', currency: 'USD', auto: { Q: 0, S: 0, R: 1550, H: 0 }, manual: {}, stock: {},
    source: { H: 'missing', R: 'currency_master_fallback' },
  }], { major: 27 });
  check('호주 28차 전·베트남 29차 전 원천 미입력은 정상 미적용 처리', beforeCountryInput.issues.length === 0, JSON.stringify(beforeCountryInput.issues));

  const afterAustraliaInput = buildProfitReportAudit([{
    category: '호주', currency: 'AUD', auto: { Q: 100, S: 0, R: null, H: 0 }, manual: {}, stock: {},
    source: { H: 'missing', R: 'missing' },
  }], { major: 28 });
  check('호주 28차부터는 H/R 원천 누락을 다시 검출', afterAustraliaInput.issues.some((x) => x.code === 'CUSTOMS_INCOMPLETE') && afterAustraliaInput.issues.some((x) => x.code === 'INVOICE_RATE_MISSING'));

  const afterVietnamInput = buildProfitReportAudit([{
    category: '베트남', currency: 'USD', auto: { Q: 100, S: 0, R: null, H: 0 }, manual: {}, stock: {},
    source: { H: 'missing', R: 'missing' },
  }], { major: 29 });
  check('베트남 29차부터는 H/R 원천 누락을 검출', afterVietnamInput.issues.some((x) => x.code === 'CUSTOMS_INCOMPLETE') && afterVietnamInput.issues.some((x) => x.code === 'INVOICE_RATE_MISSING'));

  const negativeStock = buildProfitReportAudit([{
    category: '콜롬비아 장미', currency: 'USD',
    auto: {}, manual: {}, stock: { endQty: -40 }, source: { E: 'auto_exe_stock_view', F: 'auto_unverified_snapshot' },
  }]);
  check('음수 기말재고를 오류로 검출', negativeStock.issues.some((x) => x.code === 'NEGATIVE_STOCK'));

  const rose27StockRows = [2, 4, 5, 6, 10, 10, 10, 10, 10, 10, 15, 16, 16, 18, 20, 27, 40, 50];
  const rose27EndQty = rose27StockRows.reduce((sum, qty) => sum + qty, 0);
  check('27-02 EXE 장미 재고현황 마지막 잔량 합계 = 279단', rose27EndQty === 279);
  const rose27AutoF = computeAutoEndingStock(
    { purchQty: 2810, endQty: rose27EndQty },
    { Q: 11022, S: 2813.5339799347653, H: 0, R: 1550 },
  );
  check('F는 재고현황 279단을 수식에 직접 반영', near(rose27AutoF, 2129244.3664138042, 0.01));

  console.log(`\n총 ${failed ? '실패' : '성공'} — 실패 ${failed}건`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
