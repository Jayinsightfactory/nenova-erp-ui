// 주차별 매출이익보고서 교차연도·환율 완전성 계약(정적 회귀).
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
let failed = 0;
const check = (label, cond) => {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ ${label}`); failed += 1; }
};

const page = read('pages/sales/profit-report.js');
const api = read('pages/api/sales/profit-report.js');
const confirmApi = read('pages/api/sales/profit-report-confirm.js');
const customsPanel = read('components/CustomsClearancePanel.js');
const forwardingPanel = read('components/ForwardingClearancePanel.js');
const customerSql = read('lib/profitReportCustomerMixSql.js');
const reportLib = read('lib/profitReport.js');
const dateWeights = read('lib/kcsRateDateWeights.js');

console.log('=== 화면의 선택 연도 전달 ===');
check('주차별 화면에 reportYear 상태가 있음', page.includes('const [reportYear, setReportYear]'));
check('본표 GET에 year 전달', /profit-report\?week=.*&year=/.test(page));
check('확정상태 GET에 year 전달', /profit-report-confirm\?week=.*&year=/.test(page));
check('외부증거 저장 POST에 year와 evidence 전달',
  /JSON\.stringify\(\{ week: weekInput\.value, year: data\?\.orderYear \|\| reportYear, values, evidence, note \}\)/.test(page));
check('확정·취소 POST에 year 전달', page.includes("year: reportYear, action: force ? 'force' : 'confirm'") && page.includes("year: reportYear, action: 'cancel'"));
check('엑셀·재고단가 요청에 year 전달', /&year=.*&excel=1/.test(page) && /&year=.*&stockPrices=1/.test(page));
check('그외통관비·포워딩 패널도 year를 받음', customsPanel.includes('({ week, year, onSaved })') && forwardingPanel.includes('({ week, year, onSaved })'));

console.log('\n=== 서버 쓰기 연도 필수 ===');
check('보고서 POST는 requireOrderYear 사용', /req\.method === 'POST'[\s\S]*requireOrderYear/.test(api));
check('확정 POST는 requireOrderYear 사용', /req\.method === 'GET'[\s\S]*requireOrderYear/.test(confirmApi));
check('거래처×품목 분석 SQL은 OrderYear+OrderYearWeek 모두 사용', customerSql.includes("ISNULL(sm.OrderYear,'') = @yr") && customerSql.includes("ISNULL(sm.OrderYearWeek,'') = @yw"));
check('거래처×품목 분석도 master/detail 확정을 모두 사용', customerSql.includes('ISNULL(sm.isFix,0) = 1') && customerSql.includes('ISNULL(sd.isFix,0) = 1'));

console.log('\n=== 환율 완전성·전차수 독립 ===');
check('현재 R에는 전차수 환율을 자동 적용하지 않고 제안으로만 전달',
  /previousWeekRate: prevMan\.R/.test(api) && /rateSuggestions: resolvedRate\.suggestions/.test(api));
check('기초재고 E 재계산은 직전 차수의 정확한 환율 원천만 별도로 조회',
  /invoiceRatesByCategory\(prevMajor, prevOrderYear\)/.test(api)
  && /loadTaxableRates\(prevOrderYear, prevMajor\)/.test(api)
  && /kcsRatesByCategory\(prevMajor, prevOrderYear\)/.test(api));
// 2026-08-26: 원본공식 fallback 확대로 공식 입력이 averageInputs 객체로 분리됨 — 계약 의도는 동일
// (E는 전차수 마지막 ProductStock 수량과 전차수 F 공식·증거로 계산).
check('기초재고 E는 전차수 마지막 ProductStock와 전차수 F 공식·증거로 계산',
  /const autoE = computeAutoEndingStock\(beginStock\)/.test(api)
  && /evidenceValue: resolvedBegin\?\.value/.test(api)
  && /stockQty: Number\(stockBegin\.qtys/.test(api)
  && /computeCategoryAverageInventoryValue\(averageInputs\)/.test(api));
check('FreightCost 스냅샷은 전체/적용 구매금액을 함께 비교', reportLib.includes('TotalWeight') && reportLib.includes('CoveredWeight') && reportLib.includes('Math.abs(total - covered) <= tolerance'));
check('FreightCost 중복행은 최신 FreightKey 1건만 사용', reportLib.includes('SELECT TOP 1 fcx.ExchangeRate') && reportLib.includes('ORDER BY fcx.FreightKey DESC'));
check('KCS 날짜는 InputDate를 우선하고 UploadDtm으로 대체하지 않음', dateWeights.includes("const dateExpr = 'wm.InputDate'") && !dateWeights.includes('declarationDateDiagnostics()'));
check('InputDate 누락 일정 보완은 호주 AUD 승인 규칙 하나로 제한',
  dateWeights.includes("호주: Object.freeze({")
    && dateWeights.includes("currency: 'AUD'")
    && dateWeights.includes('AUSTRALIA_AUD_MAJOR_ISO_WEEK_MONDAY_V1')
    && !dateWeights.includes("중국: Object.freeze({"));
check('실제 InputDate가 있으면 일정 보완보다 우선',
  dateWeights.includes('const scheduled = inputDate ? null : scheduledDeclarationDate'));

console.log(`\n${failed === 0 ? '✅ 전부 통과' : `❌ ${failed}건 실패`}`);
process.exit(failed ? 1 : 0);
