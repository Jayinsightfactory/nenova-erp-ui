import { sql } from './db.js';

export const DISTRIBUTION_EDIT_ACTION = 'SHIPMENT_DISTRIBUTION_EDIT';

// Persist only the verified business changes. This snapshot is written in the
// caller's ERP transaction, so a log failure must abort the distribution too.
export function distributionEditSnapshot({ orderYear, orderWeek, entries }) {
  if (!/^\d{4}$/.test(String(orderYear)) || !/^\d{1,2}-\d{1,2}$/.test(String(orderWeek))) {
    throw new Error('분배 감사 연도/차수가 올바르지 않습니다.');
  }
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > 1000) {
    throw new Error('분배 감사 대상 수가 올바르지 않습니다.');
  }
  const rows = entries.map(row => {
    const custKey = Number(row.custKey), prodKey = Number(row.prodKey);
    const before = Number(row.outQtyBefore), after = Number(row.outQtyAfter);
    if (!Number.isInteger(custKey) || custKey <= 0 || !Number.isInteger(prodKey) || prodKey <= 0 ||
        !Number.isFinite(before) || before < 0 || !Number.isFinite(after) || after < 0 || before === after) {
      throw new Error('분배 감사 수량 또는 업무키가 올바르지 않습니다.');
    }
    return {
      type: 'DISTRIBUTE', custKey, prodKey,
      outQtyBefore: before, outQtyAfter: after,
      unit: String(row.unit || '').slice(0, 20),
      custName: String(row.custName || '').slice(0, 100),
      prodName: String(row.prodName || '').slice(0, 100),
    };
  });
  return {
    year: String(orderYear), week: `${orderYear}-${orderWeek}`,
    committedCount: rows.length, verified: true, entries: rows,
  };
}

export async function insertDistributionEditAudit(tQuery, { orderYear, orderWeek, actor, entries }) {
  if (!entries.length) return;
  const payload = JSON.stringify(distributionEditSnapshot({ orderYear, orderWeek, entries }));
  await tQuery(
    `INSERT INTO SystemActionLog
       (Actor, SessionId, ActionType, Method, Endpoint, AffectedTable, AffectedCount,
        Payload, Result, ResultDesc, RiskLevel, IpAddress, UserAgent)
     VALUES (@actor, @session, @action, N'POST', N'/api/shipment/distribute',
             N'ShipmentMaster/Detail/Date', @count, @payload, N'SUCCESS', @description,
             N'HIGH', N'', N'')`,
    {
      actor: { type: sql.NVarChar, value: String(actor || 'unknown').slice(0, 100) },
      session: { type: sql.NVarChar, value: String(actor || 'unknown').slice(0, 200) },
      action: { type: sql.NVarChar, value: DISTRIBUTION_EDIT_ACTION },
      count: { type: sql.Int, value: entries.length },
      payload: { type: sql.NVarChar(sql.MAX), value: payload },
      description: { type: sql.NVarChar, value: `committed=${entries.length}; verified=true` },
    },
  );
}
