import { withAuth } from '../../../lib/auth';
import { query, sql } from '../../../lib/db';

function toInt(value, fallback = null) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method Not Allowed' });

  try {
    const prodKey = toInt(req.query.prodKey, 3074);
    const weekFrom = String(req.query.weekFrom || '19-01').trim();
    const weekTo = String(req.query.weekTo || '21-02').trim();
    const params = {
      pk: { type: sql.Int, value: prodKey },
      weekFrom: { type: sql.NVarChar, value: weekFrom },
      weekTo: { type: sql.NVarChar, value: weekTo },
    };

  const product = await query(
    `SELECT ProdKey, ProdCode, ProdName, DisplayName, FlowerName, CounName, CountryFlower,
            OutUnit, EstUnit, BunchOf1Box, SteamOf1Bunch, SteamOf1Box,
            ISNULL(Stock,0) AS ProductStockLive
       FROM Product
      WHERE ProdKey=@pk`,
    params
  );

  const productStock = await query(
    `SELECT sm.StockKey, sm.OrderYear, sm.OrderWeek, sm.OrderYearWeek,
            sm.isFix AS StockMasterFix,
            CONVERT(NVARCHAR(19), sm.CreateDtm, 120) AS StockMasterCreateDtm,
            ISNULL(sm.CreateID, '') AS StockMasterCreateID,
            ISNULL(ps.Stock,0) AS ProductStock
       FROM StockMaster sm
       LEFT JOIN ProductStock ps ON ps.StockKey=sm.StockKey AND ps.ProdKey=@pk
      WHERE sm.OrderWeek >= @weekFrom AND sm.OrderWeek <= @weekTo
      ORDER BY sm.OrderYearWeek, sm.OrderWeek, sm.StockKey`,
    params
  );

  const shipmentSummary = await query(
    `SELECT sm.OrderYear, sm.OrderWeek,
            sm.isFix AS MasterFix,
            sd.isFix AS DetailFix,
            COUNT(*) AS RowCount,
            SUM(ISNULL(sd.OutQuantity,0)) AS OutQuantity,
            SUM(ISNULL(sd.BoxQuantity,0)) AS BoxQuantity,
            SUM(ISNULL(sd.BunchQuantity,0)) AS BunchQuantity,
            SUM(ISNULL(sd.SteamQuantity,0)) AS SteamQuantity,
            SUM(ISNULL(sd.EstQuantity,0)) AS EstQuantity
       FROM ShipmentMaster sm
       JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
      WHERE ISNULL(sm.isDeleted,0)=0
        AND sm.OrderWeek >= @weekFrom AND sm.OrderWeek <= @weekTo
        AND sd.ProdKey=@pk
      GROUP BY sm.OrderYear, sm.OrderWeek, sm.isFix, sd.isFix
      ORDER BY sm.OrderYear, sm.OrderWeek, sm.isFix, sd.isFix`,
    params
  );

  const shipmentRows = await query(
    `SELECT sm.OrderYear, sm.OrderWeek, sm.ShipmentKey, sm.CustKey,
            ISNULL(c.CustName,'') AS CustName,
            sm.isFix AS MasterFix,
            sd.SdetailKey,
            sd.isFix AS DetailFix,
            ISNULL(sd.OutQuantity,0) AS OutQuantity,
            ISNULL(sd.BoxQuantity,0) AS BoxQuantity,
            ISNULL(sd.BunchQuantity,0) AS BunchQuantity,
            ISNULL(sd.SteamQuantity,0) AS SteamQuantity,
            ISNULL(sd.EstQuantity,0) AS EstQuantity,
            CONVERT(NVARCHAR(10), sd.ShipmentDtm, 120) AS ShipmentDtm,
            ISNULL(d.DateQty,0) AS ShipmentDateQty,
            ISNULL(sd.Descr,'') AS Descr
       FROM ShipmentMaster sm
       JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
       LEFT JOIN Customer c ON c.CustKey=sm.CustKey
       OUTER APPLY (
         SELECT SUM(ISNULL(ShipmentQuantity,0)) AS DateQty
         FROM ShipmentDate
         WHERE SdetailKey=sd.SdetailKey
       ) d
      WHERE ISNULL(sm.isDeleted,0)=0
        AND sm.OrderWeek >= @weekFrom AND sm.OrderWeek <= @weekTo
        AND sd.ProdKey=@pk
      ORDER BY sm.OrderYear, sm.OrderWeek, c.CustName, sd.SdetailKey`,
    params
  );

  const warehouseSummary = await query(
    `SELECT wm.OrderYear, wm.OrderWeek,
            COUNT(*) AS RowCount,
            SUM(ISNULL(wd.OutQuantity,0)) AS InQuantity,
            SUM(ISNULL(wd.BoxQuantity,0)) AS BoxQuantity,
            SUM(ISNULL(wd.BunchQuantity,0)) AS BunchQuantity,
            SUM(ISNULL(wd.SteamQuantity,0)) AS SteamQuantity
       FROM WarehouseMaster wm
       JOIN WarehouseDetail wd ON wd.WarehouseKey=wm.WarehouseKey
      WHERE ISNULL(wm.isDeleted,0)=0
        AND wm.OrderWeek >= @weekFrom AND wm.OrderWeek <= @weekTo
        AND wd.ProdKey=@pk
      GROUP BY wm.OrderYear, wm.OrderWeek
      ORDER BY wm.OrderYear, wm.OrderWeek`,
    params
  );

  const stockHistory = await query(
    `SELECT TOP 100
            CONVERT(NVARCHAR(19), ChangeDtm, 120) AS ChangeDtm,
            OrderYear, OrderWeek, ChangeID, ChangeType, ColumName,
            BeforeValue, AfterValue,
            ISNULL(AfterValue,0) - ISNULL(BeforeValue,0) AS Delta,
            ISNULL(Descr,'') AS Descr
       FROM StockHistory
      WHERE ProdKey=@pk
        AND OrderWeek >= @weekFrom AND OrderWeek <= @weekTo
      ORDER BY ChangeDtm DESC`,
    params
  );

  let appLogs = [];
  try {
    const logs = await query(
      `SELECT TOP 80
              CONVERT(NVARCHAR(19), CreateDtm, 120) AS CreateDtm,
              Step, Detail, IsError
         FROM AppLog
        WHERE Category=N'shipmentFix'
          AND (Detail LIKE N'%베트남호접난%' OR Detail LIKE N'%Orchid%' OR Detail LIKE N'%20-01%')
        ORDER BY CreateDtm DESC`
    );
    appLogs = logs.recordset || [];
  } catch {}

    return res.status(200).json({
      success: true,
      filter: { prodKey, weekFrom, weekTo },
      product: product.recordset?.[0] || null,
      productStock: productStock.recordset || [],
      shipmentSummary: shipmentSummary.recordset || [],
      shipmentRows: shipmentRows.recordset || [],
      warehouseSummary: warehouseSummary.recordset || [],
      stockHistory: stockHistory.recordset || [],
      appLogs,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message,
      number: err.number || err.originalError?.number || null,
      lineNumber: err.lineNumber || null,
    });
  }
});
