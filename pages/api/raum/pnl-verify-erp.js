// pages/api/raum/pnl-verify-erp.js — ⚖ 전산 일괄수정 직후 자동 정합검증 (읽기 전용)
// verify:week 의 V1~V3 를 라움 분배 행(호텔 창 N-01·N-02·(N+1)-01)으로 좁혀 즉시 검사:
//   V1 ShipmentDate.Cost ≠ ShipmentDetail.Cost   → 견적서에 옛 단가 출력
//   V2 ShipmentDate.Amount ≠ ROUND(Cost×Est/1.1) → 견적서 금액공식 위반
//   V3 ΣShipmentDate.ShipmentQuantity ≠ OutQuantity → 총수량 어긋남/견적 누락
import { withAuth } from '../../../lib/auth';
import { query, sql } from '../../../lib/db';

const RAUM_FILTER = `
      ISNULL(sm.isDeleted, 0) = 0
  AND c.isDeleted = 0 AND (c.CustName LIKE N'%라움%' OR c.CustName LIKE N'%트라움%')
  AND ((sm.OrderWeek IN (@wPrev, @w1) AND ISNULL(sm.OrderYearWeek, '') LIKE @yw1)
    OR (sm.OrderWeek = @w2 AND ISNULL(sm.OrderYearWeek, '') LIKE @yw2))`;

export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' });
  try {
    const major = String(req.query.major || '').replace(/[^0-9]/g, '');
    const orderYear = String(req.query.year || '').replace(/[^0-9]/g, '');
    if (!major || !orderYear) return res.status(400).json({ success: false, error: 'major, year 필요' });
    const mj = major.padStart(2, '0');
    const nextMj = String(Number(major) + 1).padStart(2, '0');
    const P = {
      wPrev: { type: sql.NVarChar, value: `${mj}-01` },
      w1: { type: sql.NVarChar, value: `${mj}-02` },
      w2: { type: sql.NVarChar, value: `${nextMj}-01` },
      yw1: { type: sql.NVarChar, value: `${orderYear}${mj}%` },
      yw2: { type: sql.NVarChar, value: `${orderYear}${nextMj}%` },
    };
    const violations = [];

    const v1 = await query(
      `SELECT p.ProdName, sm.OrderWeek, sd.SdetailKey,
              ISNULL(sd.Cost,0) AS detailCost, ISNULL(sdd.Cost,0) AS dateCost
         FROM ShipmentDetail sd
         JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
         JOIN Customer c ON sm.CustKey = c.CustKey
         JOIN Product p ON sd.ProdKey = p.ProdKey
         JOIN ShipmentDate sdd ON sdd.SdetailKey = sd.SdetailKey
        WHERE ${RAUM_FILTER}
          AND ABS(ISNULL(sdd.Cost,0) - ISNULL(sd.Cost,0)) > 0.5`,
      P
    );
    for (const r of v1.recordset) {
      violations.push({ check: 'V1', msg: `[${r.OrderWeek}] ${r.ProdName}: 분배단가 ${r.detailCost} ≠ 견적단가 ${r.dateCost}` });
    }

    const v2 = await query(
      `SELECT p.ProdName, sm.OrderWeek, ISNULL(sdd.Amount,0) AS Amount,
              ROUND(ISNULL(sdd.Cost,0)*ISNULL(sdd.EstQuantity,0)/1.1, 0) AS expected
         FROM ShipmentDetail sd
         JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
         JOIN Customer c ON sm.CustKey = c.CustKey
         JOIN Product p ON sd.ProdKey = p.ProdKey
         JOIN ShipmentDate sdd ON sdd.SdetailKey = sd.SdetailKey
        WHERE ${RAUM_FILTER}
          AND ABS(ISNULL(sdd.Amount,0) - ROUND(ISNULL(sdd.Cost,0)*ISNULL(sdd.EstQuantity,0)/1.1, 0)) > 1`,
      P
    );
    for (const r of v2.recordset) {
      violations.push({ check: 'V2', msg: `[${r.OrderWeek}] ${r.ProdName}: 견적금액 ${r.Amount} ≠ 기대 ${r.expected}` });
    }

    const v3 = await query(
      `SELECT p.ProdName, sm.OrderWeek, sd.SdetailKey, sd.OutQuantity, x.sumQty
         FROM ShipmentDetail sd
         JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
         JOIN Customer c ON sm.CustKey = c.CustKey
         JOIN Product p ON sd.ProdKey = p.ProdKey
        CROSS APPLY (SELECT ROUND(SUM(ISNULL(sdd.ShipmentQuantity,0)),3) AS sumQty
                       FROM ShipmentDate sdd WHERE sdd.SdetailKey = sd.SdetailKey) x
        WHERE ${RAUM_FILTER}
          AND sd.OutQuantity > 0
          AND ABS(ISNULL(x.sumQty,0) - sd.OutQuantity) > 0.01`,
      P
    );
    for (const r of v3.recordset) {
      violations.push({ check: 'V3', msg: `[${r.OrderWeek}] ${r.ProdName}: 출고 ${r.OutQuantity} ≠ 출고일합 ${r.sumQty}` });
    }

    return res.status(200).json({ success: true, violations, checked: ['V1', 'V2', 'V3'] });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});
