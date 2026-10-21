// 경영관리(mgmt) 웹 전용 스키마 web_mgmt ensure. dbo ERP 원장·ecount_work는 절대 쓰지 않는다.
// DDL 원문은 docs/migrations/2026-10-21_web_mgmt_controls.sql (SSMS 제안본)과 동일하게 유지한다.
import { query } from '../db.js';
import { loadMgmtDdl } from './schemaMeta.js';

export { MGMT_SCHEMA, MGMT_TABLES, mgmtMigrationPath, loadMgmtDdl, qualified } from './schemaMeta.js';

let ensurePromise = null;

// 멱등 DDL. 실패 시 다음 호출에서 재시도.
export async function ensureMgmtSchema() {
  if (ensurePromise) return ensurePromise;
  ensurePromise = query(loadMgmtDdl()).catch((err) => {
    ensurePromise = null;
    throw err;
  });
  return ensurePromise;
}
