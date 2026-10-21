// mgmt ↔ ECOUNT 이관 작업 경계 선언. __tests__/mgmtBoundary.test.js 가 git diff 로 검사한다.
// 설계: docs/mgmt/MGMT_CONTROLS_DESIGN.md §2, §4

// mgmt PR이 한 줄도 수정하면 안 되는 경로(ECOUNT 이관 소유)
export const ECOUNT_OWNED_PATTERNS = [
  /^lib\/ecount[^/]*$/,
  /^pages\/ecount\//,
  /^pages\/api\/ecount\//,
  /^components\/ecount\//,
  /^components\/Ecount[^/]*\.js$/,
  /^data\/ecount-workbench\//,
  /^docs\/ecount-migration\//,
  /^docs\/ECOUNT_[^/]*\.md$/,
  /^scripts\/check-ecount-parity\.cjs$/,
  /^scripts\/ecount-[^/]*$/,
  /^__tests__\/ecount[^/]*$/,
];

// mgmt 소유 경로
export const MGMT_OWNED_PATTERNS = [
  /^lib\/mgmt\//,
  /^pages\/mgmt\//,
  /^pages\/api\/mgmt\//,
  /^components\/mgmt\//,
  /^__tests__\/mgmt[^/]*$/,
  /^docs\/mgmt\//,
  /^docs\/contracts\/management-controls\.json$/,
  /^docs\/migrations\/2026-10-21_web_mgmt_controls\.sql$/,
];

// 공유 핫스팟: 허용되지만 최소 삽입만(설계 §4)
export const SHARED_HOTSPOTS = [
  'components/Layout.js',
  'package.json',
  '__tests__/erpContractManifest.test.js',
];

// ecount_work 스키마는 읽기 전용. SQL 문자열에 쓰기 동사가 붙으면 차단.
const ECOUNT_WORK_WRITE_RE = /\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM|MERGE\s+INTO|ALTER\s+TABLE|DROP\s+TABLE|TRUNCATE\s+TABLE)\s+(\[?ecount_work\]?\s*\.)/i;
const ERP_WRITE_RE = /\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM|MERGE\s+INTO|TRUNCATE\s+TABLE)\s+(\[?dbo\]?\s*\.\s*)?\[?(Customer|OrderMaster|OrderDetail|ShipmentMaster|ShipmentDetail|ShipmentDate|ShipmentFarm|Estimate|ProductStock|StockHistory|StockMaster|Product|WarehouseMaster|WarehouseDetail)\]?\b/i;

export function isEcountOwned(file) {
  const f = String(file || '').replace(/\\/g, '/');
  return ECOUNT_OWNED_PATTERNS.some((re) => re.test(f));
}

export function isMgmtOwned(file) {
  const f = String(file || '').replace(/\\/g, '/');
  return MGMT_OWNED_PATTERNS.some((re) => re.test(f));
}

export function violatesEcountBoundary(changedFiles) {
  return (changedFiles || []).filter((f) => isEcountOwned(f));
}

// mgmt SQL 가드: web_mgmt 외 쓰기 금지
export function assertMgmtSqlReadOnlyOutsideSchema(sqlText) {
  const text = String(sqlText || '');
  if (ECOUNT_WORK_WRITE_RE.test(text)) throw new Error('mgmt SQL이 ecount_work 에 쓰려 합니다(읽기 전용).');
  if (ERP_WRITE_RE.test(text)) throw new Error('mgmt SQL이 ERP 원장에 쓰려 합니다(preserve 계약 위반).');
  return true;
}
