// 변경 감사로그 통합뷰 읽기 계층. 전부 SELECT. 원천별 실패는 해당 원천만 빈 목록 + missing 표기.
// SystemActionLog: pages/api/dev/action-log.js, ShipmentHistory: pages/api/admin/worklog.js 와 같은 읽기 방식.
import { sql } from '../db.js';
import { mgmtQuery } from './safeQuery.js';
import { ensureMgmtSchema } from './schema.js';
import {
  normSystemActionLog, normShipmentHistory, normPriceChange, normCreditLimit, normApprovalAudit, mergeEvents, filterEvents,
} from './auditViewCore.js';

const LIMIT = 2000;

async function tryRead(name, fn, missing) {
  try { return await fn(); } catch { missing.push(name); return []; }
}

export async function loadAuditEvents({ from, to, kind, week, cust }) {
  await ensureMgmtSchema();
  const missing = [];
  const P = { from: { type: sql.NVarChar, value: from }, to: { type: sql.NVarChar, value: to } };
  const range = (col) => `CAST(${col} AS DATE) BETWEEN @from AND @to`;

  const [sys, ship, price, credit, appr] = await Promise.all([
    tryRead('SystemActionLog', async () => (await mgmtQuery(
      `SELECT TOP (${LIMIT}) ActionDtm, Actor, ActionType, Method, Endpoint, AffectedTable, Payload, ResultDesc
         FROM SystemActionLog WHERE ${range('ActionDtm')} AND Method <> 'GET' AND Result = 'SUCCESS' ORDER BY ActionDtm DESC`, P)).recordset.map(normSystemActionLog), missing),
    tryRead('ShipmentHistory', async () => (await mgmtQuery(
      `SELECT TOP (${LIMIT}) sh.ChangeDtm, sh.ChangeID, sh.ChangeType, sh.Descr AS ColumName, sh.BeforeValue, sh.AfterValue, sh.SdetailKey,
              sm.OrderWeek, c.CustName, p.ProdName
         FROM ShipmentHistory sh
         LEFT JOIN ShipmentDetail sd ON sh.SdetailKey = sd.SdetailKey
         LEFT JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
         LEFT JOIN Customer c ON sd.CustKey = c.CustKey
         LEFT JOIN Product p ON sd.ProdKey = p.ProdKey
        WHERE ${range('sh.ChangeDtm')} ORDER BY sh.ChangeDtm DESC`, P)).recordset.map(normShipmentHistory), missing),
    tryRead('PriceChangeHistory', async () => (await mgmtQuery(
      `SELECT TOP (${LIMIT}) h.CustKey, c.CustName, h.ProdKey, p.ProdName, h.BeforeValue, h.AfterValue, h.CreatedBy, h.CreatedAt
         FROM web_mgmt.PriceChangeHistory h LEFT JOIN Product p ON p.ProdKey=h.ProdKey LEFT JOIN Customer c ON c.CustKey=h.CustKey
        WHERE ${range('h.CreatedAt')} ORDER BY h.CreatedAt DESC`, P)).recordset.map(normPriceChange), missing),
    tryRead('CreditLimitHistory', async () => (await mgmtQuery(
      `SELECT TOP (${LIMIT}) h.CustKey, c.CustName, h.LimitKRW, h.CreatedBy, h.CreatedAt,
              LAG(h.LimitKRW) OVER (PARTITION BY h.CustKey ORDER BY h.HistoryKey) AS PrevLimit
         FROM web_mgmt.CreditLimitHistory h LEFT JOIN Customer c ON c.CustKey=h.CustKey
        ORDER BY h.HistoryKey DESC`)).recordset.map(normCreditLimit), missing),
    tryRead('ApprovalAudit', async () => (await mgmtQuery(
      `SELECT TOP (${LIMIT}) a.RequestId, r.TargetKind, a.FromStatus, a.ToStatus, a.ActorId, a.CreatedAt
         FROM web_mgmt.ApprovalAudit a LEFT JOIN web_mgmt.ApprovalRequest r ON r.RequestId=a.RequestId
        WHERE ${range('a.CreatedAt')} ORDER BY a.AuditKey DESC`, P)).recordset.map(normApprovalAudit), missing),
  ]);
  const events = filterEvents(mergeEvents([sys, ship, price, credit, appr]), { kind, week, cust, from, to });
  return { events, missing };
}
