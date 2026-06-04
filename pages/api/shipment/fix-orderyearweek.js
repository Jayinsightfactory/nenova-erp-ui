// pages/api/shipment/fix-orderyearweek.js
//  웹이 만든 OrderMaster/ShipmentMaster 의 raw OrderYearWeek 가 전산 포맷과 달라 견적서관리에서 누락되는 문제 보정.
//   전산 포맷: OrderYear + 대차수(세부차수 '-NN' 제외)  예) 23-01 → '202623'
//   웹 과거 포맷: OrderYear + 세부차수전체            예) 23-01 → '20262301'
//  견적 GetData/GetDetail 은 raw OrderYearWeek 로 필터하므로, 웹 포맷이면 그 차수 조회 시 누락됨.
//
//  GET  ?week=23-01           → 진단: 포맷 안 맞는 OrderMaster/ShipmentMaster 건수 + 샘플
//  POST { week, action:'fix' }→ 보정: 해당 차수에서 포맷 안 맞는 행을 전산 포맷으로 UPDATE
import { withAuth } from '../../../lib/auth';
import { withTransaction, query, sql } from '../../../lib/db';
import { withActionLog } from '../../../lib/withActionLog';
import { normalizeOrderWeek } from '../../../lib/orderUtils';

// 전산 포맷 식 (OrderWeek 에 '-' 없으면 전체 사용)
const CORRECT = (t) => `${t}.OrderYear + LEFT(${t}.OrderWeek, CHARINDEX('-', ${t}.OrderWeek + '-') - 1)`;

async function colExists(table, column) {
  const r = await query(
    `SELECT CASE WHEN COL_LENGTH(@t, @c) IS NULL THEN 0 ELSE 1 END AS h`,
    { t: { type: sql.NVarChar, value: `dbo.${table}` }, c: { type: sql.NVarChar, value: column } }
  );
  return Number(r.recordset[0]?.h || 0) === 1;
}

async function handler(req, res) {
  const week = normalizeOrderWeek(req.query?.week || req.body?.week || '');
  if (!week) return res.status(400).json({ success: false, error: 'week 필요' });
  const uid = req.user?.userId || 'system';
  // OrderMaster 에는 OrderYearWeek 컬럼이 없을 수 있음(환경별). ShipmentMaster 만 견적에 쓰임.
  const omHasCol = await colExists('OrderMaster', 'OrderYearWeek');

  try {
    if (req.method === 'GET') {
      const sm = await query(
        `SELECT TOP 100 sm.ShipmentKey, sm.OrderYear, sm.OrderWeek, sm.OrderYearWeek AS Cur,
                ${CORRECT('sm')} AS Correct, c.CustName
           FROM ShipmentMaster sm LEFT JOIN Customer c ON c.CustKey=sm.CustKey
          WHERE sm.OrderWeek=@wk AND ISNULL(sm.isDeleted,0)=0 AND sm.OrderYearWeek <> ${CORRECT('sm')}
          ORDER BY c.CustName`,
        { wk: { type: sql.NVarChar, value: week } }
      );
      let orderMismatch = 0;
      if (omHasCol) {
        const om = await query(
          `SELECT COUNT(*) AS cnt FROM OrderMaster om
            WHERE om.OrderWeek=@wk AND ISNULL(om.isDeleted,0)=0 AND ISNULL(om.OrderYearWeek,'') <> ${CORRECT('om')}`,
          { wk: { type: sql.NVarChar, value: week } }
        );
        orderMismatch = Number(om.recordset[0]?.cnt || 0);
      }
      return res.status(200).json({
        success: true, week, omHasCol,
        shipmentMismatch: sm.recordset.length,
        orderMismatch,
        sample: sm.recordset.slice(0, 30),
      });
    }

    if (req.method === 'POST') {
      if (String(req.body?.action) !== 'fix') return res.status(400).json({ success: false, error: 'action=fix 필요' });
      const result = await withTransaction(async (tQ) => {
        const smU = await tQ(
          `UPDATE sm SET sm.OrderYearWeek = ${CORRECT('sm')}, sm.CreateDtm = sm.CreateDtm
             FROM ShipmentMaster sm
            WHERE sm.OrderWeek=@wk AND ISNULL(sm.isDeleted,0)=0 AND sm.OrderYearWeek <> ${CORRECT('sm')}`,
          { wk: { type: sql.NVarChar, value: week } }
        );
        let orderUpdated = 0;
        if (omHasCol) {
          const omU = await tQ(
            `UPDATE om SET om.OrderYearWeek = ${CORRECT('om')}, om.LastUpdateID=@uid, om.LastUpdateDtm=GETDATE()
               FROM OrderMaster om
              WHERE om.OrderWeek=@wk AND ISNULL(om.isDeleted,0)=0 AND ISNULL(om.OrderYearWeek,'') <> ${CORRECT('om')}`,
            { wk: { type: sql.NVarChar, value: week }, uid: { type: sql.NVarChar, value: uid } }
          );
          orderUpdated = omU.rowsAffected?.[0] || 0;
        }
        return {
          shipmentUpdated: smU.rowsAffected?.[0] || 0,
          orderUpdated,
        };
      });
      return res.status(200).json({
        success: true, week, ...result,
        message: `OrderYearWeek 전산 포맷 보정 완료 — 출고마스터 ${result.shipmentUpdated} / 주문마스터 ${result.orderUpdated}건. 이제 견적서관리에 표시됩니다.`,
      });
    }

    return res.status(405).json({ success: false, error: 'GET/POST only' });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
}

export default withAuth(withActionLog(handler, { actionType: 'FIX_ORDERYEARWEEK', affectedTable: 'OrderMaster/ShipmentMaster', riskLevel: 'MEDIUM' }));
