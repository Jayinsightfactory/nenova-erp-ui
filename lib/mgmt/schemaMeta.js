// web_mgmt 스키마 메타(DB 의존 없음). 테스트·계약 검사용.
import fs from 'node:fs';
import path from 'node:path';

export const MGMT_SCHEMA = 'web_mgmt';

export const MGMT_TABLES = [
  'CreditLimitHistory',
  'PriceChangeHistory',
  'ClaimReasonCode',
  'ClaimReasonLink',
  'CustomerTarget',
  'WeekCloseCheck',
  'ApprovalRequest',
  'ApprovalAudit',
  'ReceiptMatch',
];

export function mgmtMigrationPath() {
  return path.join(process.cwd(), 'docs', 'migrations', '2026-10-21_web_mgmt_controls.sql');
}

export function loadMgmtDdl() {
  return fs.readFileSync(mgmtMigrationPath(), 'utf8');
}

export function qualified(table) {
  if (!MGMT_TABLES.includes(table)) throw new Error(`web_mgmt 외 테이블 접근 금지: ${table}`);
  return `${MGMT_SCHEMA}.${table}`;
}
