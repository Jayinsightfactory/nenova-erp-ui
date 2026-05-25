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
              CONVERT(NVARCHAR(10), sd.ShipmentDtm, 120) AS ShipmentDtm
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

    return res.status(200).json({
      success: true,
      week,
      summary: {
        duplicateMasters: duplicateMasters.recordset.length,
        missingCustKey: missingCustKey.recordset.length,
        shipmentDateMismatch: shipmentDateMismatch.recordset.length,
        estMismatch: estMismatch.recordset.length,
      },
      duplicateMasters: duplicateMasters.recordset,
      missingCustKey: missingCustKey.recordset,
      shipmentDateMismatch: shipmentDateMismatch.recordset,
      estMismatch: estMismatch.recordset,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

export default withAuth(handler);
