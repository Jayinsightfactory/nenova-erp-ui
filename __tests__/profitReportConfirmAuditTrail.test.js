// 보고서 기준 확정 — revision/취소/이력/ERP 원장 쓰기금지 감사 추적 검증.
// docs/contracts/weekly-profit-report.json REPORT_CONFIRM_CANCEL/REPORT_CONFIRM_HISTORY_VIEW/
// erpLedgerWriteProhibition 참조. DB 접속 없이 소스 텍스트로 검증 가능한 계약만 다룬다
// (guardCoverage에 명시된 대로 scripts/check-erp-write-contracts.mjs는 OrderMaster 등 4개
// Master 테이블만 검사하고 OrderDetail/ShipmentDetail/Estimate/ProductStock/StockHistory는
// 검사 대상이 아니므로, 이 전용 테스트가 그 금지 목록을 직접 정적 검사한다).
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

const FORBIDDEN_TABLES = [
  'OrderMaster', 'OrderDetail', 'ShipmentMaster', 'ShipmentDetail',
  'ShipmentDate', 'ShipmentFarm', 'Estimate', 'ProductStock', 'StockHistory',
];

/** 소스의 줄 주석(//)과 블록 주석을 제거해 "INSERT/UPDATE/DELETE" 같은 단어가 한글 설명문에
 * 섞여 있어 오탐(false positive)나지 않게 한다 — 이 파일의 헤더 주석 자체가
 * "IsActive=0 + CancelledBy/CancelledAt UPDATE. 재확정은... Order/Shipment/Estimate/..." 처럼
 * 실제 SQL이 아닌 설명 문장에 UPDATE와 테이블 이름이 같이 등장해 그대로 두면 오탐이 난다. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** source 안에서 INSERT/UPDATE/DELETE 키워드 뒤 최대 120자 이내에 table 이름이 등장하는지 검사.
 * SELECT(읽기)는 대상이 아니다 — 쓰기 문형만 잡는다. 주석은 미리 제거한 뒤 검사한다. */
function hasForbiddenWrite(source, table) {
  const code = stripComments(source);
  const writeRe = new RegExp(`(INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)[^;]{0,120}\\b${table}\\b`, 'i');
  return writeRe.test(code);
}

async function main() {
  const confirmLibSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'profitReportConfirm.js'), 'utf8');
  const confirmApiSource = fs.readFileSync(path.join(__dirname, '..', 'pages', 'api', 'sales', 'profit-report-confirm.js'), 'utf8');
  const migrationSql = fs.readFileSync(path.join(__dirname, '..', 'docs', 'migrations', '2026-08-11_web_profit_report_confirm.sql'), 'utf8');

  console.log('=== erpLedgerWriteProhibition — 9개 금지 테이블에 INSERT/UPDATE/DELETE 없음 ===');
  for (const table of FORBIDDEN_TABLES) {
    check(`lib/profitReportConfirm.js가 ${table}에 쓰기 SQL을 만들지 않음`, !hasForbiddenWrite(confirmLibSource, table));
    check(`pages/api/sales/profit-report-confirm.js가 ${table}에 쓰기 SQL을 만들지 않음`, !hasForbiddenWrite(confirmApiSource, table));
    check(`마이그레이션 파일이 ${table}에 쓰기 SQL을 만들지 않음(Web 전용 신규 테이블만 생성)`, !hasForbiddenWrite(migrationSql, table));
  }
  check('확정 모듈이 쓰는 테이블은 WebProfitReportConfirm(Detail)뿐임(다른 dbo. 테이블 INSERT 없음)',
    (confirmLibSource.match(/INSERT INTO dbo\.(\w+)/g) || []).every((m) => /WebProfitReportConfirm/.test(m)));

  console.log('\n=== REPORT_CONFIRM_CANCEL — DELETE 금지, IsActive=0 + Cancelled* UPDATE만 ===');
  check('cancelConfirm이 WebProfitReportConfirm을 DELETE하지 않음', !/DELETE\s+FROM\s+dbo\.WebProfitReportConfirm\b/i.test(confirmLibSource));
  check('cancelConfirm이 IsActive=0으로 UPDATE', /UPDATE dbo\.WebProfitReportConfirm[\s\S]{0,120}SET IsActive=0/.test(confirmLibSource));
  check('cancelConfirm이 CancelledBy/CancelledByName/CancelledAt을 함께 기록', /CancelledBy=@actor, CancelledByName=@actorName, CancelledAt=GETDATE\(\)/.test(confirmLibSource));
  check('cancelConfirm이 활성 행을 UPDLOCK/HOLDLOCK으로 잠근 뒤 처리(동시 취소 경쟁 방지)',
    /SELECT ConfirmKey, RevisionNo FROM dbo\.WebProfitReportConfirm WITH \(UPDLOCK, HOLDLOCK\)/.test(confirmLibSource));

  console.log('\n=== 재확정 시 RevisionNo 증가(기존 값 덮어쓰지 않음) + 활성 중복 방지 ===');
  check('confirmSnapshot이 활성 행이 있으면 새로 만들지 않고 예외(ACTIVE_CONFIRM_EXISTS)',
    /ACTIVE_CONFIRM_EXISTS/.test(confirmLibSource));
  check('RevisionNo는 MAX(RevisionNo)+1로 채번(같은 주차의 과거 취소 revision까지 포함해 계산)',
    /SELECT ISNULL\(MAX\(RevisionNo\),0\)\+1 AS RevisionNo FROM dbo\.WebProfitReportConfirm WITH \(UPDLOCK, HOLDLOCK\)\s*\n\s*WHERE OrderYear=@yr AND MajorWeek=@mw`?/.test(confirmLibSource));
  check('활성 확정 존재 확인과 채번 모두 WITH (UPDLOCK, HOLDLOCK)로 잠가 동시 확정 경쟁을 막음',
    (confirmLibSource.match(/WITH \(UPDLOCK, HOLDLOCK\)/g) || []).length >= 2);
  check('확정/취소 모두 withTransaction으로 감쌈(원자적 커밋)',
    /return withTransaction\(async \(tQuery\) => \{[\s\S]*ACTIVE_CONFIRM_EXISTS/.test(confirmLibSource)
    && /return withTransaction\(async \(tQuery\) => \{[\s\S]*NO_ACTIVE_CONFIRM/.test(confirmLibSource));

  console.log('\n=== GET(조회/이력)은 스키마를 만들지 않음 — ensureConfirmTables는 쓰기 경로에서만 호출 ===');
  const listHistorySrc = confirmLibSource.slice(
    confirmLibSource.indexOf('export async function listConfirmHistory'),
    confirmLibSource.indexOf('export { SOURCE_COLS'),
  );
  check('listConfirmHistory 함수 블록 파싱', listHistorySrc.length > 50);
  // stripComments: 주석에서 "ensureConfirmTables 호출 없음"처럼 이 사실 자체를 설명하는 문장이
  // 오탐을 만들 수 있으므로 실제 호출 코드만(주석 제거 후) 검사한다.
  check('listConfirmHistory가 ensureConfirmTables를 호출하지 않음', !/ensureConfirmTables/.test(stripComments(listHistorySrc)));
  const getActiveSrc = confirmLibSource.slice(
    confirmLibSource.indexOf('export async function getActiveConfirm'),
    confirmLibSource.indexOf('export async function listConfirmHistory'),
  );
  check('getActiveConfirm이 ensureConfirmTables를 호출하지 않음', !/ensureConfirmTables/.test(stripComments(getActiveSrc)));
  check('confirmSnapshot/cancelConfirm만 ensureConfirmTables 또는 status 체크로 스키마를 다룸',
    /await ensureConfirmTables\(\);/.test(confirmLibSource.slice(confirmLibSource.indexOf('export async function confirmSnapshot'))));
  check('API GET 핸들러가 스키마 미초기화 시 initialized:false와 안내 메시지를 반환(초기 설정 필요)',
    /initialized: false,[\s\S]{0,300}message: '보고서 기준 확정 기능이 아직 초기 설정되지 않았습니다/.test(confirmApiSource));
  check('API GET 핸들러는 confirmSchemaStatus만 부르고 ensureConfirmTables는 부르지 않음(GET에서 DDL 금지)',
    /confirmSchemaStatus\(\)/.test(confirmApiSource) && !/ensureConfirmTables/.test(confirmApiSource));

  console.log('\n=== 강제 확정 감사 로그 — 사용자·사유·무시된 audit 이슈를 스냅샷 레코드에 기록 ===');
  check('IsForced/ForceReason 컬럼이 INSERT에 포함됨', /IsForced, ForceReason,/.test(confirmLibSource));
  check('AuditIssuesJson에 확정 시점 audit.issues 전체를 JSON으로 저장(무시된 이슈 포함)',
    /auditJson: \{ type: sql\.NVarChar, value: JSON\.stringify\(audit\?\.issues \|\| \[\]\) \}/.test(confirmLibSource));
  check('강제 확정은 관리자 판정(authority/deptName)을 API 레이어에서 계산해 confirmSnapshot에 전달',
    /isAdmin: isAdminUser\(req\.user\)/.test(confirmApiSource));

  console.log('\n=== package.json test:erp-contract에 확정 관련 테스트가 연결됨 ===');
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  const erpContractCmd = pkg.scripts['test:erp-contract'];
  for (const testFile of [
    'profitReportConfirmSnapshotImmutability.test.js',
    'profitReportConfirmAuditTrail.test.js',
    'profitReportAustraliaUnitFallback.test.js',
    'profitReportCountryClassificationParity.test.js',
    'profitReportRecentCostCutoff.test.js',
  ]) {
    check(`test:erp-contract가 ${testFile}를 실행함`, erpContractCmd.includes(testFile));
  }

  console.log(`\n총 ${failed ? '실패' : '성공'} — 실패 ${failed}건`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
