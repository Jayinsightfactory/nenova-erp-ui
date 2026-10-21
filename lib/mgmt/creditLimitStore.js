// web_mgmt.CreditLimitHistory 접근(추가 전용). 덮어쓰기·삭제 없음.
import { query, sql } from '../db.js';
import { assertMgmtSqlReadOnlyOutsideSchema } from './boundary.js';
import { ensureMgmtSchema } from './schema.js';
import { qualified } from './schemaMeta.js';

const T = qualified('CreditLimitHistory');

async function run(q, params) {
  assertMgmtSqlReadOnlyOutsideSchema(q);
  return query(q, params);
}

export async function listLimitHistory({ custKey, limit = 200 } = {}) {
  await ensureMgmtSchema();
  const params = { top: { type: sql.Int, value: Math.min(Math.max(Number(limit) || 200, 1), 1000) } };
  let where = '';
  if (custKey) { where = 'WHERE CustKey = @custKey'; params.custKey = { type: sql.Int, value: Number(custKey) }; }
  const r = await run(`SELECT TOP (@top) HistoryKey, CustKey, LimitKRW, Reason, CreatedBy, CreatedAt FROM ${T} ${where} ORDER BY HistoryKey DESC`, params);
  return r?.recordset || [];
}

export async function listAllLimitRows() {
  await ensureMgmtSchema();
  const r = await run(`SELECT HistoryKey, CustKey, LimitKRW, CreatedAt FROM ${T}`);
  return r?.recordset || [];
}

export async function appendLimit({ custKey, limitKRW, reason, actorId }) {
  await ensureMgmtSchema();
  const r = await run(
    `INSERT INTO ${T} (CustKey, LimitKRW, Reason, CreatedBy) OUTPUT INSERTED.HistoryKey VALUES (@custKey, @limit, @reason, @by)`,
    {
      custKey: { type: sql.Int, value: custKey },
      limit: { type: sql.Decimal(18, 0), value: limitKRW },
      reason: { type: sql.NVarChar(400), value: reason },
      by: { type: sql.NVarChar(100), value: actorId || '' },
    },
  );
  return r?.recordset?.[0]?.HistoryKey;
}
