// pages/api/raum/pnl-erp-rows.js — 라움 손익 "전산 일괄수정"용 분배 행 조회 (읽기 전용)
// 호텔 차수 규칙: 호텔 N차 = 전산 N-02 + (N+1)-01. 행 단위(SdetailKey)로 반환해
// 클라이언트가 update-cost/update-quantity(견적서 관리와 동일 API)로 정확 타겟 수정한다.
import { withAuth } from '../../../lib/auth';
import { query, sql } from '../../../lib/db';

export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' });
  try {
    const major = String(req.query.major || '').replace(/[^0-9]/g, '');
    const orderYear = String(req.query.year || '').replace(/[^0-9]/g, '');
    if (!major || !orderYear) return res.status(400).json({ success: false, error: 'major, year 필요' });
    const mj = major.padStart(2, '0');
    const nextMj = String(Number(major) + 1).padStart(2, '0');
    const r = await query(
      `SELECT sd.SdetailKey, sd.ShipmentKey, sm.OrderWeek, sd.ProdKey, p.ProdName,
              ISNULL(sd.BoxQuantity, 0) AS BoxQuantity,
              ISNULL(sd.BunchQuantity, 0) AS BunchQuantity,
              ISNULL(sd.SteamQuantity, 0) AS SteamQuantity,
              ISNULL(sd.OutQuantity, 0) AS OutQuantity,
              ISNULL(sd.EstQuantity, 0) AS EstQuantity,
              ISNULL(sd.Amount, 0) AS Amount,
              ISNULL(sd.Vat, 0) AS Vat,
              ISNULL(sd.Cost, 0) AS Cost,
              ISNULL(sd.isFix, 0) AS DetailIsFix,
              ISNULL(NULLIF(LTRIM(RTRIM(ISNULL(p.CountryFlower, N''))), N''),
                ISNULL(NULLIF(LTRIM(RTRIM(ISNULL(p.CounName, N''))), N''),
                  ISNULL(NULLIF(LTRIM(RTRIM(ISNULL(p.FlowerName, N''))), N''), N'(분류없음)'))) AS CategoryLabel
         FROM ShipmentDetail sd
         JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
         JOIN Customer c ON sm.CustKey = c.CustKey
         JOIN Product p ON sd.ProdKey = p.ProdKey
        WHERE ISNULL(sm.isDeleted, 0) = 0
          AND c.isDeleted = 0 AND (c.CustName LIKE N'%라움%' OR c.CustName LIKE N'%트라움%')
          AND ((sm.OrderWeek = @w1 AND ISNULL(sm.OrderYearWeek, '') LIKE @yw1)
            OR (sm.OrderWeek = @w2 AND ISNULL(sm.OrderYearWeek, '') LIKE @yw2))
        ORDER BY sm.OrderWeek, p.ProdName, sd.SdetailKey`,
      {
        w1: { type: sql.NVarChar, value: `${mj}-02` },
        w2: { type: sql.NVarChar, value: `${nextMj}-01` },
        yw1: { type: sql.NVarChar, value: `${orderYear}${mj}%` },
        yw2: { type: sql.NVarChar, value: `${orderYear}${nextMj}%` },
      }
    );
    // 신규 분배 추가(ADD)용 라움 CustKey
    const cust = await query(
      `SELECT TOP 1 CustKey FROM Customer
        WHERE isDeleted = 0 AND (CustName LIKE N'%트라움%' OR CustName LIKE N'%라움%')
        ORDER BY CustKey`,
      {}
    );
    return res.status(200).json({
      success: true,
      weeks: [`${mj}-02`, `${nextMj}-01`],
      custKey: cust.recordset[0]?.CustKey ?? null,
      rows: r.recordset || [],
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});
