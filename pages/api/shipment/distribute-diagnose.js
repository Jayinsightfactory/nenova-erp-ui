// pages/api/shipment/distribute-diagnose.js - compatibility checks for Nenova.exe distribute buttons
import { withAuth } from '../../../lib/auth';
import { query, sql } from '../../../lib/db';
import { normalizeOrderWeek } from '../../../lib/orderUtils';

async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const week = normalizeOrderWeek(req.query.week || '');
  if (!week) return res.status(400).json({ success: false, error: 'week is required' });

  try {
    const duplicateMasters = await query(
      `SELECT CustKey, OrderWeek, COUNT(*) AS masterCount,
              MIN(ShipmentKey) AS minShipmentKey,
              MAX(ShipmentKey) AS maxShipmentKey
         FROM ShipmentMaster
        WHERE OrderWeek=@wk AND ISNULL(isDeleted,0)=0
        GROUP BY CustKey, OrderWeek
       HAVING COUNT(*) > 1
        ORDER BY CustKey`,
      { wk: { type: sql.NVarChar, value: week } }
    );

    const missingCustKey = await query(
      `SELECT TOP 200 sm.ShipmentKey, sd.SdetailKey, sm.CustKey AS MasterCustKey,
              sd.CustKey AS DetailCustKey, sd.ProdKey, p.ProdName, sd.OutQuantity
         FROM ShipmentMaster sm
         JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
         LEFT JOIN Product p ON p.ProdKey=sd.ProdKey
        WHERE sm.OrderWeek=@wk AND ISNULL(sm.isDeleted,0)=0
          AND ISNULL(sd.OutQuantity,0) <> 0
          AND (sd.CustKey IS NULL OR sd.CustKey=0 OR sd.CustKey<>sm.CustKey)
        ORDER BY sm.CustKey, sd.ProdKey`,
      { wk: { type: sql.NVarChar, value: week } }
    );

    const shipmentDateMismatch = await query(
      `SELECT TOP 200 sm.ShipmentKey, sd.SdetailKey, sm.CustKey, sd.ProdKey, p.ProdName,
              sd.OutQuantity,
              ISNULL(SUM(sdt.ShipmentQuantity),0) AS ShipmentDateQty,
              CONVERT(NVARCHAR(10), sd.ShipmentDtm, 120) AS ShipmentDtm,
              MIN(CONVERT(NVARCHAR(10), sdt.ShipmentDtm, 120)) AS ShipmentDateDtm,
              SUM(CASE WHEN sdt.ShipmentDtm IS NULL
                         OR sd.ShipmentDtm IS NULL
                         OR CONVERT(date, sdt.ShipmentDtm) <> CONVERT(date, sd.ShipmentDtm)
                       THEN 1 ELSE 0 END) AS DateMismatchCount
         FROM ShipmentMaster sm
         JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
         LEFT JOIN ShipmentDate sdt ON sdt.SdetailKey=sd.SdetailKey
         LEFT JOIN Product p ON p.ProdKey=sd.ProdKey
        WHERE sm.OrderWeek=@wk AND ISNULL(sm.isDeleted,0)=0
          AND ISNULL(sd.OutQuantity,0) <> 0
        GROUP BY sm.ShipmentKey, sd.SdetailKey, sm.CustKey, sd.ProdKey, p.ProdName,
                 sd.OutQuantity, sd.ShipmentDtm
       HAVING ISNULL(SUM(sdt.ShipmentQuantity),0) <> ISNULL(sd.OutQuantity,0)
           OR sd.ShipmentDtm IS NULL
           OR SUM(CASE WHEN sdt.ShipmentDtm IS NULL
                         OR sd.ShipmentDtm IS NULL
                         OR CONVERT(date, sdt.ShipmentDtm) <> CONVERT(date, sd.ShipmentDtm)
                       THEN 1 ELSE 0 END) > 0
        ORDER BY sm.CustKey, sd.ProdKey`,
      { wk: { type: sql.NVarChar, value: week } }
    );

    const estMismatch = await query(
      `SELECT TOP 200 sm.ShipmentKey, sd.SdetailKey, sm.CustKey, sd.ProdKey, p.ProdName,
              sd.OutQuantity, sd.EstQuantity
         FROM ShipmentMaster sm
         JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
         LEFT JOIN Product p ON p.ProdKey=sd.ProdKey
        WHERE sm.OrderWeek=@wk AND ISNULL(sm.isDeleted,0)=0
          AND ISNULL(sd.OutQuantity,0) <> ISNULL(sd.EstQuantity,0)
        ORDER BY sm.CustKey, sd.ProdKey`,
      { wk: { type: sql.NVarChar, value: week } }
    );

    const keyNumbering = await query(
      `SELECT v.Category,
              ISNULL(kn.LastKeyNo,0) AS LastKeyNo,
              v.ActualMaxKey,
              CASE WHEN ISNULL(kn.LastKeyNo,0) < v.ActualMaxKey THEN 1 ELSE 0 END AS NeedsSync,
              CASE WHEN ISNULL(kn.LastKeyNo,0) < v.ActualMaxKey
                   THEN v.ActualMaxKey - ISNULL(kn.LastKeyNo,0)
                   ELSE 0 END AS Gap
         FROM (
           SELECT N'ShipmentMasterKey' AS Category, ISNULL(MAX(ShipmentKey),0) AS ActualMaxKey FROM ShipmentMaster
           UNION ALL
           SELECT N'ShipmentDetailKey' AS Category, ISNULL(MAX(SdetailKey),0) AS ActualMaxKey FROM ShipmentDetail
           UNION ALL
           SELECT N'OrderMasterKey' AS Category, ISNULL(MAX(OrderMasterKey),0) AS ActualMaxKey FROM OrderMaster
           UNION ALL
           SELECT N'OrderDetailKey' AS Category, ISNULL(MAX(OrderDetailKey),0) AS ActualMaxKey FROM OrderDetail
         ) v
         LEFT JOIN KeyNumbering kn ON kn.Category = v.Category
        ORDER BY v.Category`
    );

    const procedures = await query(
      `SELECT v.ProcedureName,
              CASE WHEN OBJECT_ID(N'dbo.' + v.ProcedureName, N'P') IS NULL THEN 0 ELSE 1 END AS ExistsInDb
         FROM (VALUES
           (N'usp_DistributeTotal'),
           (N'usp_DistributeOne'),
           (N'usp_DistributeClear'),
           (N'usp_ShipmentFix'),
           (N'usp_ShipmentFixCancel'),
           (N'usp_StockCalculation')
         ) v(ProcedureName)
        ORDER BY v.ProcedureName`
    );

    const keyNeedsSync = keyNumbering.recordset.filter(r => Number(r.NeedsSync) === 1);

    return res.status(200).json({
      success: true,
      week,
      summary: {
        duplicateMasters: duplicateMasters.recordset.length,
        missingCustKey: missingCustKey.recordset.length,
        shipmentDateMismatch: shipmentDateMismatch.recordset.length,
        estMismatch: estMismatch.recordset.length,
        keyNumberingNeedsSync: keyNeedsSync.length,
        missingProcedures: procedures.recordset.filter(r => Number(r.ExistsInDb) !== 1).length,
      },
      duplicateMasters: duplicateMasters.recordset,
      missingCustKey: missingCustKey.recordset,
      shipmentDateMismatch: shipmentDateMismatch.recordset,
      estMismatch: estMismatch.recordset,
      keyNumbering: keyNumbering.recordset,
      procedures: procedures.recordset,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

export default withAuth(handler);
