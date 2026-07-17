// pages/api/raum/pnl-erp-rows.js — 라움 손익 "전산 일괄수정"용 분배 행 조회 (읽기 전용)
// 호텔 차수 규칙(사장님 최종 확정 2026-07-17): 기준 창 = 전산 N-02 + (N+1)-01.
// 창에 분배가 없는 품목(쌓아두는 선입고 품목)만 N-01 행을 폴백으로 사용 — 행에 OrderWeek 로 구분됨.
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
          AND ((sm.OrderWeek IN (@wPrev, @w1) AND ISNULL(sm.OrderYearWeek, '') LIKE @yw1)
            OR (sm.OrderWeek = @w2 AND ISNULL(sm.OrderYearWeek, '') LIKE @yw2))
        ORDER BY sm.OrderWeek, p.ProdName, sd.SdetailKey`,
      {
        wPrev: { type: sql.NVarChar, value: `${mj}-01` },
        w1: { type: sql.NVarChar, value: `${mj}-02` },
        w2: { type: sql.NVarChar, value: `${nextMj}-01` },
        yw1: { type: sql.NVarChar, value: `${orderYear}${mj}%` },
        yw2: { type: sql.NVarChar, value: `${orderYear}${nextMj}%` },
      }
    );

    const cust = await query(
      `SELECT TOP 1 CustKey FROM Customer
        WHERE isDeleted = 0 AND (CustName LIKE N'%트라움%' OR CustName LIKE N'%라움%')
        ORDER BY CustKey`,
      {}
    );

    // 아이엠 분배 (같은 창) — 라움 잔량이 아이엠으로 가는 구조. 품목·존별 수량+최초/최종수정 시점
    let imRows = [];
    try {
      const im = await query(
        `SELECT sd.ProdKey,
                CASE WHEN sm.OrderWeek = @wPrev THEN 'prev' ELSE 'win' END AS Zone,
                SUM(ISNULL(sd.EstQuantity, 0)) AS EstQty,
                CONVERT(varchar(16), MIN(h.firstDtm), 120) AS FirstDtm,
                CONVERT(varchar(16), MAX(h.lastDtm), 120) AS LastDtm, SUM(ISNULL(h.modCnt, 0)) AS ModCnt
           FROM ShipmentDetail sd
           JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
           JOIN Customer c ON sm.CustKey = c.CustKey
          OUTER APPLY (SELECT MIN(sh.ChangeDtm) AS firstDtm, MAX(sh.ChangeDtm) AS lastDtm,
                              SUM(CASE WHEN sh.ChangeType = N'수정' THEN 1 ELSE 0 END) AS modCnt
                         FROM ShipmentHistory sh WHERE sh.SdetailKey = sd.SdetailKey) h
          WHERE ISNULL(sm.isDeleted, 0) = 0
            AND c.isDeleted = 0 AND c.CustName LIKE N'아이엠%'
            AND ((sm.OrderWeek IN (@wPrev, @w1) AND ISNULL(sm.OrderYearWeek, '') LIKE @yw1)
              OR (sm.OrderWeek = @w2 AND ISNULL(sm.OrderYearWeek, '') LIKE @yw2))
          GROUP BY sd.ProdKey, CASE WHEN sm.OrderWeek = @wPrev THEN 'prev' ELSE 'win' END`,
        {
          wPrev: { type: sql.NVarChar, value: `${mj}-01` },
          w1: { type: sql.NVarChar, value: `${mj}-02` },
          w2: { type: sql.NVarChar, value: `${nextMj}-01` },
          yw1: { type: sql.NVarChar, value: `${orderYear}${mj}%` },
          yw2: { type: sql.NVarChar, value: `${orderYear}${nextMj}%` },
        }
      );
      imRows = im.recordset || [];
    } catch { /* 아이엠 집계 실패는 치명 아님 — 표시만 생략 */ }

    return res.status(200).json({
      success: true,
      weeks: [`${mj}-02`, `${nextMj}-01`],  // 기준 창
      prevWeek: `${mj}-01`,                 // 폴백 (창에 없는 쌓아두는 품목만)
      custKey: cust.recordset[0]?.CustKey ?? null,
      rows: r.recordset || [],
      imRows,
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});
