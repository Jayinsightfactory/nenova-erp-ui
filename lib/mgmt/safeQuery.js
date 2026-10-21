// mgmt 전용 쿼리 래퍼: 모든 SQL 은 경계 가드를 거친다(ERP 원장·ecount_work 쓰기 차단).
import { query } from '../db.js';
import { assertMgmtSqlReadOnlyOutsideSchema } from './boundary.js';

export async function mgmtQuery(sqlText, params = {}) {
  assertMgmtSqlReadOnlyOutsideSchema(sqlText);
  return query(sqlText, params);
}
