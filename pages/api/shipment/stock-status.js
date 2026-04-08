// pages/api/shipment/stock-status.js
// GET?week=X&view=products  → 품목별 입고/출고/재고/주문 현황
// GET?week=X&view=customers → 업체별 품목 출고 현황
// GET?week=X&view=pivot     → 모아보기용 피벗 데이터

import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';

export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  const { week, view } = req.query;
  if (!week) return res.status(400).json({ success: false, error: 'week 파라미터 필요' });

  try {
    if (view === 'products' || !view) {
      // ── 품목별: 입고/출고/주문/재고
      const result = await query(
        `SELECT
          p.ProdKey, p.ProdName, p.FlowerName, p.CounName, p.CountryFlower,
          p.OutUnit, p.BunchOf1Box, p.SteamOf1Box,
          ISNULL(ps.Stock, 0) AS prevStock,
          ISNULL((
            SELECT SUM(wd.OutQuantity) FROM WarehouseDetail wd
            JOIN WarehouseMaster wm ON wd.WarehouseKey = wm.WarehouseKey
            WHERE wd.ProdKey = p.ProdKey AND wm.OrderWeek = @week AND wm.isDeleted = 0
          ), 0) AS inQty,
          ISNULL((
            SELECT SUM(sd.OutQuantity) FROM ShipmentDetail sd
            JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
            WHERE sd.ProdKey = p.ProdKey AND sm.OrderWeek = @week AND sm.isDeleted = 0
          ), 0) AS outQty,
          ISNULL((
            SELECT SUM(od.OutQuantity) FROM OrderDetail od
            JOIN OrderMaster om ON od.OrderMasterKey = om.OrderMasterKey
            WHERE od.ProdKey = p.ProdKey AND om.OrderWeek = @week AND om.isDeleted = 0
          ), 0) AS orderQty
         FROM Product p
         LEFT JOIN StockMaster sm2 ON sm2.OrderWeek = @week
         LEFT JOIN ProductStock ps ON p.ProdKey = ps.ProdKey AND ps.StockKey = sm2.StockKey
         WHERE p.isDeleted = 0
           AND EXISTS (
             SELECT 1 FROM OrderDetail od2
             JOIN OrderMaster om2 ON od2.OrderMasterKey = om2.OrderMasterKey
             WHERE od2.ProdKey = p.ProdKey AND om2.OrderWeek = @week
               AND om2.isDeleted = 0 AND od2.isDeleted = 0
           )
         ORDER BY p.CounName, p.FlowerName, p.ProdName`,
        { week: { type: sql.NVarChar, value: week } }
      );
      return res.status(200).json({ success: true, products: result.recordset });
    }

    if (view === 'customers') {
      // ── 업체별: 각 업체의 품목별 주문/출고
      const result = await query(
        `SELECT
          c.CustKey, c.CustName, c.CustArea,
          p.ProdKey, p.ProdName, p.FlowerName, p.CounName, p.CountryFlower, p.OutUnit,
          ISNULL(od.OutQuantity, 0) AS orderQty,
          ISNULL(od.BoxQuantity,  0) AS orderBox,
          ISNULL(od.BunchQuantity,0) AS orderBunch,
          ISNULL(od.SteamQuantity,0) AS orderSteam,
          ISNULL(sd.OutQuantity,  0) AS outQty,
          ISNULL(sd.BoxQuantity,  0) AS outBox,
          ISNULL(sd.BunchQuantity,0) AS outBunch,
          ISNULL(sd.SteamQuantity,0) AS outSteam,
          ISNULL(od.OutQuantity, 0) - ISNULL(sd.OutQuantity, 0) AS remain
         FROM OrderMaster om
         JOIN Customer c     ON om.CustKey = c.CustKey
         JOIN OrderDetail od ON om.OrderMasterKey = od.OrderMasterKey AND od.isDeleted = 0
         JOIN Product p      ON od.ProdKey = p.ProdKey
         LEFT JOIN ShipmentMaster sm ON sm.CustKey = om.CustKey AND sm.OrderWeek = @week AND sm.isDeleted = 0
         LEFT JOIN ShipmentDetail sd ON sd.ShipmentKey = sm.ShipmentKey AND sd.ProdKey = p.ProdKey
         WHERE om.OrderWeek = @week AND om.isDeleted = 0
         ORDER BY c.CustArea, c.CustName, p.CounName, p.FlowerName, p.ProdName`,
        { week: { type: sql.NVarChar, value: week } }
      );
      return res.status(200).json({ success: true, rows: result.recordset });
    }

    if (view === 'pivot') {
      // ── 모아보기 피벗용: 출고수량 > 0 인 데이터만
      const result = await query(
        `SELECT
          c.CustKey, c.CustName, c.CustArea,
          p.ProdKey, p.ProdName, p.FlowerName, p.CounName, p.CountryFlower,
          ISNULL(sd.OutQuantity, 0) AS outQty,
          ISNULL(od.OutQuantity, 0) AS orderQty
         FROM OrderMaster om
         JOIN Customer c     ON om.CustKey = c.CustKey
         JOIN OrderDetail od ON om.OrderMasterKey = od.OrderMasterKey AND od.isDeleted = 0
         JOIN Product p      ON od.ProdKey = p.ProdKey
         LEFT JOIN ShipmentMaster sm ON sm.CustKey = om.CustKey AND sm.OrderWeek = @week AND sm.isDeleted = 0
         LEFT JOIN ShipmentDetail sd ON sd.ShipmentKey = sm.ShipmentKey AND sd.ProdKey = p.ProdKey
         WHERE om.OrderWeek = @week AND om.isDeleted = 0
           AND ISNULL(sd.OutQuantity, 0) > 0
         ORDER BY c.CustArea, c.CustName, p.CounName, p.FlowerName`,
        { week: { type: sql.NVarChar, value: week } }
      );
      return res.status(200).json({ success: true, rows: result.recordset });
    }

    // ── 주문있는 차수 목록
    if (view === 'weeks') {
      const result = await query(
        `SELECT DISTINCT om.OrderWeek, om.OrderYear
         FROM OrderMaster om
         WHERE om.isDeleted = 0
         ORDER BY om.OrderYear DESC, om.OrderWeek DESC`,
        {}
      );
      return res.status(200).json({ success: true, weeks: result.recordset });
    }

    return res.status(400).json({ success: false, error: 'view 파라미터 필요 (products|customers|pivot|weeks)' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
