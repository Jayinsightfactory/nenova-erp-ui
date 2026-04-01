// pages/api/stats/dashboard.js
// 대시보드 KPI — 실제 DB 집계

import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';

export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  try {
    // 현재 차수 자동 감지
    const weekResult = await query(
      `SELECT TOP 1 OrderWeek, OrderYear FROM ShipmentMaster
       WHERE isDeleted = 0 ORDER BY CreateDtm DESC`
    );
    const currentWeek = weekResult.recordset[0]?.OrderWeek || '';
    const currentYear = weekResult.recordset[0]?.OrderYear || '';

    // 이번 차수 매출
    const salesResult = await query(
      `SELECT
        SUM(sd.Amount) AS totalSales,
        SUM(sd.Amount + sd.Vat) AS totalWithVat,
        COUNT(DISTINCT sd.CustKey) AS custCount,
        SUM(sd.OutQuantity) AS totalQty
       FROM ShipmentDetail sd
       JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
       WHERE sm.OrderWeek = @week AND sm.isDeleted = 0`,
      { week: { type: sql.NVarChar, value: currentWeek } }
    );

    // 이번 차수 주문 건수
    const orderResult = await query(
      `SELECT COUNT(*) AS orderCount FROM OrderMaster
       WHERE OrderWeek = @week AND isDeleted = 0`,
      { week: { type: sql.NVarChar, value: currentWeek } }
    );

    // 재고 부족 품목 (재고 10 미만, 입고는 있는)
    const stockResult = await query(
      `SELECT COUNT(*) AS lowCount FROM Product
       WHERE isDeleted = 0 AND Stock > 0 AND Stock < 10`
    );

    // 미확정 출고
    const unfixedResult = await query(
      `SELECT COUNT(*) AS unfixedCount FROM ShipmentMaster
       WHERE OrderWeek = @week AND isFix = 0 AND isDeleted = 0`,
      { week: { type: sql.NVarChar, value: currentWeek } }
    );

    // 지역별 매출 (현재 차수)
    const areaResult = await query(
      `SELECT
        c.CustArea AS area,
        SUM(sd.Amount) AS curSales
       FROM ShipmentDetail sd
       JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
       JOIN Customer c ON sd.CustKey = c.CustKey
       WHERE sm.OrderWeek = @week AND sm.isDeleted = 0
         AND c.CustArea IS NOT NULL AND c.CustArea != ''
       GROUP BY c.CustArea
       ORDER BY curSales DESC`,
      { week: { type: sql.NVarChar, value: currentWeek } }
    );

    // TOP 5 거래처
    const topCustResult = await query(
      `SELECT TOP 5
        c.CustName, c.CustArea,
        SUM(sd.Amount) AS sales
       FROM ShipmentDetail sd
       JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
       JOIN Customer c ON sd.CustKey = c.CustKey
       WHERE sm.OrderWeek = @week AND sm.isDeleted = 0
       GROUP BY c.CustName, c.CustArea
       ORDER BY sales DESC`,
      { week: { type: sql.NVarChar, value: currentWeek } }
    );

    return res.status(200).json({
      success: true,
      source: 'real_db',
      week: currentWeek,
      year: currentYear,
      kpi: {
        totalSales: salesResult.recordset[0]?.totalSales || 0,
        totalWithVat: salesResult.recordset[0]?.totalWithVat || 0,
        custCount: salesResult.recordset[0]?.custCount || 0,
        totalQty: salesResult.recordset[0]?.totalQty || 0,
        orderCount: orderResult.recordset[0]?.orderCount || 0,
        lowStockCount: stockResult.recordset[0]?.lowCount || 0,
        unfixedCount: unfixedResult.recordset[0]?.unfixedCount || 0,
      },
      salesByArea: areaResult.recordset,
      topCustomers: topCustResult.recordset,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
