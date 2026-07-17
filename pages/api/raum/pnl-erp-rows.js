// pages/api/raum/pnl-erp-rows.js — 라움 손익 "전산 일괄수정"용 분배 행 조회 (읽기 전용)
// 호텔 차수 규칙(사장님 재확정 2026-07-17 v2): 호텔 N차 = 전산 N-01 + N-02.
// (N+1)-01 에 입력된 라움 분배는 잘못 들어간 것 — 이동 후보(moveWeek)로 함께 반환한다.
// 재고 쌍보정 계산용으로 N-02 차수잔량(ProductStock)과 Product.Stock(live)도 품목별로 반환.
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
          AND ((sm.OrderWeek IN (@w1, @w2) AND ISNULL(sm.OrderYearWeek, '') LIKE @yw1)
            OR (sm.OrderWeek = @mv AND ISNULL(sm.OrderYearWeek, '') LIKE @yw2))
        ORDER BY sm.OrderWeek, p.ProdName, sd.SdetailKey`,
      {
        w1: { type: sql.NVarChar, value: `${mj}-01` },
        w2: { type: sql.NVarChar, value: `${mj}-02` },
        mv: { type: sql.NVarChar, value: `${nextMj}-01` },
        yw1: { type: sql.NVarChar, value: `${orderYear}${mj}%` },
        yw2: { type: sql.NVarChar, value: `${orderYear}${nextMj}%` },
      }
    );
    const rows = r.recordset || [];

    // 이동 시 재고 쌍보정 계산용 — N-02 차수잔량 스냅샷 + live(Product.Stock)
    const prodKeys = [...new Set(rows.map(x => Number(x.ProdKey)))];
    let stockAtW2 = {};
    let liveStock = {};
    if (prodKeys.length) {
      const params = Object.fromEntries(prodKeys.map((k, i) => [`p${i}`, { type: sql.Int, value: k }]));
      const inList = prodKeys.map((_, i) => `@p${i}`).join(',');
      const s = await query(
        `SELECT ps.ProdKey, ISNULL(ps.Stock, 0) AS Stock
           FROM ProductStock ps
           JOIN StockMaster smk ON ps.StockKey = smk.StockKey
          WHERE smk.OrderYear = @yr AND smk.OrderWeek = @wk AND ps.ProdKey IN (${inList})`,
        { ...params, yr: { type: sql.NVarChar, value: orderYear }, wk: { type: sql.NVarChar, value: `${mj}-02` } }
      );
      stockAtW2 = Object.fromEntries((s.recordset || []).map(x => [Number(x.ProdKey), Number(x.Stock)]));
      const lv = await query(
        `SELECT ProdKey, ISNULL(Stock, 0) AS Stock FROM Product WHERE ProdKey IN (${inList})`,
        params
      );
      liveStock = Object.fromEntries((lv.recordset || []).map(x => [Number(x.ProdKey), Number(x.Stock)]));
    }

    const cust = await query(
      `SELECT TOP 1 CustKey FROM Customer
        WHERE isDeleted = 0 AND (CustName LIKE N'%트라움%' OR CustName LIKE N'%라움%')
        ORDER BY CustKey`,
      {}
    );
    return res.status(200).json({
      success: true,
      weeks: [`${mj}-01`, `${mj}-02`],   // 호텔 창 (대조·수정 기준)
      moveWeek: `${nextMj}-01`,          // 잘못 입력된 분배의 이동 원천
      moveTarget: `${mj}-02`,            // 이동 목적지
      custKey: cust.recordset[0]?.CustKey ?? null,
      stockAtW2,                          // N-02 차수잔량 (이동 후 음수 예측용)
      liveStock,                          // Product.Stock (쌍보정 AfterValue≥0 가드용)
      rows,
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});
