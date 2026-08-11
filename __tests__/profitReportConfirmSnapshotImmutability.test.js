// 보고서 기준 확정(REPORT_CONFIRM_SNAPSHOT) 불변성 검증.
// docs/contracts/weekly-profit-report.json REPORT_CONFIRM_SNAPSHOT/erpLedgerWriteProhibition 참조.
// DB 접속 없이(이 환경에는 .env.local이 없음) 검증 가능한 범위만 다룬다:
//  1) 순수 함수(buildConfirmDetailRows/buildSourceHash)가 SOURCE/CALC/SOURCE_TAG를 계약대로 만드는지
//  2) confirmSnapshot()의 감사(audit) 차단 검증이 DB에 닿기 전에 동기적으로 거부하는지
//  3) 저장 스키마가 FLOAT가 아니라 DECIMAL(38,10)인지(마이그레이션 파일 + ensureConfirmTables 소스 둘 다)
//  4) 화면/엑셀이 확정 스냅샷을 재계산하지 않고 그대로 쓰는지(소스 텍스트 검증)
const fs = require('fs');
const path = require('path');

let failed = 0;
const check = (label, condition, detail = '') => {
  if (condition) console.log(`  ✓ ${label}`);
  else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
    failed += 1;
  }
};

async function main() {
  const confirmLib = await import('../lib/profitReportConfirm.js');
  const { buildConfirmDetailRows, buildSourceHash, confirmSnapshot, ProfitReportConfirmError } = confirmLib;

  console.log('=== buildConfirmDetailRows — SOURCE(N/L/O/Q/R/S/H/E/F) + CALC(C~U) + SOURCE_TAG(R/H/S) ===');
  const sampleRows = [
    {
      category: '호주',
      calc: { N: 100, L: 0, O: 0, Q: 10, R: 1000, S: 5, H: 200, E: 300, F: 400, C: 100, P: 10000, T: 5000, G: 15000, I: 15100, J: -15000, K: -150, M: 0, D: 0.5, U: 0.5 },
      source: { R: 'freight_cost_snapshot', H: 'manual', S: 'legacy_auto' },
    },
  ];
  const sampleTotals = { C: 100, D: 1, E: 300, F: 400, G: 15000, H: 200, I: 15100, J: -15000, K: -150, L: 0, M: 0, N: 100, O: 0, P: 10000, Q: 10, S: 5, T: 5000, U: 1 };
  const details = buildConfirmDetailRows(sampleRows, sampleTotals);

  const sourceCols = ['N', 'L', 'O', 'Q', 'R', 'S', 'H', 'E', 'F'];
  const calcCols = ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U'];
  check('카테고리 행 SOURCE 9개 모두 생성', sourceCols.every((c) => details.some((d) => d.category === '호주' && d.colType === 'SOURCE' && d.colKey === c)));
  check('카테고리 행 CALC 19개(C~U) 모두 생성', calcCols.every((c) => details.some((d) => d.category === '호주' && d.colType === 'CALC' && d.colKey === c)));
  check('카테고리 행 SOURCE_TAG(R/H/S) 3개 모두 생성', ['R', 'H', 'S'].every((c) => details.some((d) => d.category === '호주' && d.colType === 'SOURCE_TAG' && d.colKey === c)));
  check('SOURCE_TAG는 TextValue에 태그 문자열 저장(Value는 null)',
    details.find((d) => d.category === '호주' && d.colType === 'SOURCE_TAG' && d.colKey === 'R').textValue === 'freight_cost_snapshot'
    && details.find((d) => d.category === '호주' && d.colType === 'SOURCE_TAG' && d.colKey === 'R').value === null);
  check('합계행(_total)은 CALC만 생성(SOURCE/SOURCE_TAG 없음)',
    details.some((d) => d.category === '_total' && d.colType === 'CALC' && d.colKey === 'J' && d.value === -15000)
    && !details.some((d) => d.category === '_total' && (d.colType === 'SOURCE' || d.colType === 'SOURCE_TAG')));
  check('SOURCE의 값이 계산에 실제 반영된 최종값과 같음(예: R=1000)',
    details.find((d) => d.category === '호주' && d.colType === 'SOURCE' && d.colKey === 'R').value === 1000);

  console.log('\n=== buildSourceHash — 결정론적 해시 ===');
  const h1 = buildSourceHash({ rows: sampleRows, stockWeeks: { begin: '26-03', end: '27-02' } });
  const h2 = buildSourceHash({ rows: sampleRows, stockWeeks: { begin: '26-03', end: '27-02' } });
  const h3 = buildSourceHash({ rows: sampleRows, stockWeeks: { begin: '26-03', end: '27-03' } });
  check('같은 입력 → 같은 해시(재현 가능)', h1 === h2);
  check('다른 입력 → 다른 해시', h1 !== h3);
  check('해시는 64자 hex(sha256)', /^[0-9a-f]{64}$/.test(h1));

  console.log('\n=== confirmSnapshot() — audit 차단이 DB 접근 전에 동기적으로 거부(감사 오류 → 일반 확정 거부) ===');
  try {
    await confirmSnapshot({
      orderYear: '2026', major: '27', rows: sampleRows, totals: sampleTotals, stockWeeks: {},
      audit: { errorCount: 2, status: 'needs_input', issues: [] },
      actor: 'tester', actorName: '테스터', force: false,
    });
    check('오류가 있으면 강제 아닌 확정은 예외를 던짐', false, '예외가 발생하지 않음');
  } catch (e) {
    check('오류가 있으면 강제 아닌 확정은 예외를 던짐', e instanceof ProfitReportConfirmError && e.code === 'AUDIT_BLOCKED');
  }

  console.log('\n=== confirmSnapshot() — 강제 확정은 관리자+사유 둘 다 필요 ===');
  try {
    await confirmSnapshot({
      orderYear: '2026', major: '27', rows: sampleRows, totals: sampleTotals, stockWeeks: {},
      audit: { errorCount: 2, status: 'needs_input', issues: [] },
      actor: 'tester', actorName: '테스터', force: true, isAdmin: false, forceReason: '사유있음',
    });
    check('관리자가 아니면 강제 확정 거부', false, '예외가 발생하지 않음');
  } catch (e) {
    check('관리자가 아니면 강제 확정 거부', e instanceof ProfitReportConfirmError && e.code === 'FORCE_REQUIRES_ADMIN');
  }
  try {
    await confirmSnapshot({
      orderYear: '2026', major: '27', rows: sampleRows, totals: sampleTotals, stockWeeks: {},
      audit: { errorCount: 2, status: 'needs_input', issues: [] },
      actor: 'tester', actorName: '테스터', force: true, isAdmin: true, forceReason: '   ',
    });
    check('사유가 비어있으면(공백만) 강제 확정 거부', false, '예외가 발생하지 않음');
  } catch (e) {
    check('사유가 비어있으면(공백만) 강제 확정 거부', e instanceof ProfitReportConfirmError && e.code === 'FORCE_REASON_REQUIRED');
  }

  console.log('\n=== 스냅샷 정밀도 — FLOAT 금지, DECIMAL(38,10) ===');
  const migrationSql = fs.readFileSync(path.join(__dirname, '..', 'docs', 'migrations', '2026-08-11_web_profit_report_confirm.sql'), 'utf8');
  check('마이그레이션 WebProfitReportConfirmDetail.Value가 DECIMAL(38,10)', /Value\s+DECIMAL\(38,\s*10\)\s+NULL/.test(migrationSql));
  check('마이그레이션에 Value FLOAT가 남아있지 않음(WebProfitReportConfirmDetail 범위)',
    !/WebProfitReportConfirmDetail[\s\S]{0,400}Value\s+FLOAT/.test(migrationSql));
  const confirmLibSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'profitReportConfirm.js'), 'utf8');
  check('lib/profitReportConfirm.js의 ensureConfirmTables DDL도 DECIMAL(38,10)', /Value\s+DECIMAL\(38,10\)\s+NULL/.test(confirmLibSource));
  check('lib/profitReportConfirm.js INSERT 파라미터 타입도 sql.Decimal(38, 10)', /sql\.Decimal\(38, 10\)/.test(confirmLibSource));

  console.log('\n=== 화면/엑셀이 확정 스냅샷 calc를 재계산하지 않고 그대로 사용 ===');
  const pageSource = fs.readFileSync(path.join(__dirname, '..', 'pages', 'sales', 'profit-report.js'), 'utf8');
  const excelSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'profitReportExcel.js'), 'utf8');
  const apiSource = fs.readFileSync(path.join(__dirname, '..', 'pages', 'api', 'sales', 'profit-report.js'), 'utf8');
  check('화면 rowsCalc가 data.confirmed일 때 computeProfitRow 재계산을 건너뜀',
    /if \(data\?\.confirmed\) \{[\s\S]{0,200}calc: r\.calc \|\| \{\}/.test(pageSource));
  check('엑셀 생성이 row.confirmed면 저장된 calc를 그대로 씀(computeProfitRow 재호출 안 함)',
    /r\.confirmed && r\.calc \? r\.calc : computeProfitRow\(r\)/.test(excelSource));
  check('엑셀 합계도 confirmedTotals가 있으면 그것을 사용(재계산 안 함)', /confirmedTotals \|\| computeProfitTotals\(bodyRows\)/.test(excelSource));
  check('API가 활성 확정본이 있으면 buildConfirmedPayload로 서빙(라이브 재계산 skip)',
    /if \(activeConfirm\.initialized && activeConfirm\.confirm\)/.test(apiSource));
  check('월별 보기도 확정 주차는 확정 totals를 그대로 재사용(중복 계산 없음)',
    /data\.confirmed \? data\.confirmedTotals : computeProfitTotals/.test(apiSource));

  console.log('\n=== 결함수정 5: 확정 스냅샷의 D(매출비율)/U(구매비율)도 저장값 그대로 사용(재계산 금지) ===');
  // 2026-08-11 이전에는 row.calc 전체는 확정 스냅샷을 쓰면서도 D/U만 calcRevenueRatio/calcPurchaseRatio로
  // 매번 다시 계산했다 — 오늘은 같은 입력이라 값이 같지만, 비율 공식이 나중에 바뀌면 과거 확정본의
  // D/U가 저장값과 달라지는 잠재 결함이었다. 화면(메인표+세부표)과 엑셀(원본시트+선택컬럼시트) 4곳 모두
  // row.confirmed일 때는 계산 함수를 호출하지 않고 저장된 c.D/c.U를 그대로 써야 한다.
  const pageConfirmedDGuards = pageSource.match(/row\.confirmed \? c\.D : calcRevenueRatio/g) || [];
  const pageConfirmedUGuards = pageSource.match(/row\.confirmed \? c\.U : calcPurchaseRatio/g) || [];
  check('화면(메인표+세부표) 2곳 모두 confirmed면 저장된 D를 그대로 씀', pageConfirmedDGuards.length === 2, `실제=${pageConfirmedDGuards.length}`);
  check('화면(메인표+세부표) 2곳 모두 confirmed면 저장된 U를 그대로 씀', pageConfirmedUGuards.length === 2, `실제=${pageConfirmedUGuards.length}`);
  const excelConfirmedDGuards = excelSource.match(/row\.confirmed \? c\.D : calcRevenueRatio/g) || [];
  const excelConfirmedUGuards = excelSource.match(/row\.confirmed \? c\.U : calcPurchaseRatio/g) || [];
  check('엑셀(원본시트+선택컬럼시트) 2곳 모두 confirmed면 저장된 D를 그대로 씀', excelConfirmedDGuards.length === 2, `실제=${excelConfirmedDGuards.length}`);
  check('엑셀(원본시트+선택컬럼시트) 2곳 모두 confirmed면 저장된 U를 그대로 씀', excelConfirmedUGuards.length === 2, `실제=${excelConfirmedUGuards.length}`);

  console.log(`\n총 ${failed ? '실패' : '성공'} — 실패 ${failed}건`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
