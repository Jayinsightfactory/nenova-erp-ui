// pages/api/sales/status.js — 판매현황 API
import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';

export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const { dateFrom, dateTo, week, custKey, manager } = req.query;

  try {
    const params = {
      dateFrom: { type: sql.Date,    value: dateFrom || null },
      dateTo:   { type: sql.Date,    value: dateTo   || null },
      week:     { type: sql.NVarChar, value: week    || null },
      custKey:  { type: sql.Int,     value: custKey  ? parseInt(custKey) : null },
      manager:  { type: sql.NVarChar, value: manager || null },
    };

    const result = await query(
      `SELECT
        CONVERT(NVARCHAR(10), sd.ShipmentDtm, 120) AS shipDate,
        sm.OrderWeek AS week,
        c.Manager AS manager,
        c.CustKey, c.CustName, c.CustArea,
        p.ProdKey, p.ProdName, p.OutUnit, p.CounName, p.FlowerName,
        sd.OutQuantity AS qty,
        ISNULL(cpc.Cost, ISNULL(p.Cost,0)) AS unitCost,
        ROUND(ISNULL(cpc.Cost, ISNULL(p.Cost,0)) * sd.OutQuantity / 1.1, 0) AS supplyAmt,
        ROUND(ISNULL(cpc.Cost, ISNULL(p.Cost,0)) * sd.OutQuantity / 11, 0) AS vatAmt
      FROM ShipmentMaster sm
      JOIN ShipmentDetail sd ON sm.ShipmentKey = sd.ShipmentKey
      JOIN Customer c ON sm.CustKey = c.CustKey AND c.isDeleted = 0
      JOIN Product p ON sd.ProdKey = p.ProdKey AND p.isDeleted = 0
      LEFT JOIN CustomerProdCost cpc ON cpc.CustKey = c.CustKey AND cpc.ProdKey = p.ProdKey
      WHERE sm.isDeleted = 0 AND sm.isFix = 1
        AND (@dateFrom IS NULL OR CONVERT(DATE, sd.ShipmentDtm) >= @dateFrom)
        AND (@dateTo   IS NULL OR CONVERT(DATE, sd.ShipmentDtm) <= @dateTo)
        AND (@week     IS NULL OR sm.OrderWeek = @week)
        AND (@custKey  IS NULL OR c.CustKey = @custKey)
        AND (@manager  IS NULL OR c.Manager = @manager)
      ORDER BY sd.ShipmentDtm, c.CustName, p.ProdName`,
      params
    );

    const rows = result.recordset;

    // 요약 집계
    const totalQty    = rows.reduce((a, r) => a + (r.qty || 0), 0);
    const totalSupply = rows.reduce((a, r) => a + (r.supplyAmt || 0), 0);
    const totalVat    = rows.reduce((a, r) => a + (r.vatAmt || 0), 0);
    const totalAmt    = totalSupply + totalVat;
    const custKeys    = new Set(rows.map(r => r.CustKey));

    return res.status(200).json({
      success: true,
      rows,
      summary: {
        totalQty,
        totalSupply,
        totalVat,
        totalAmt,
        custCount: custKeys.size,
        rowCount: rows.length,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
