// pages/api/shipment/[id].js — exe FormShipmentView.GetDetail
import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';
import { useExeParityFlag } from '../../../lib/exeParity/common.js';
import { sqlShipmentViewGetDetail } from '../../../lib/exeShipmentViewSql.js';

export default withAuth(async function handler(req, res) {
  const { id, exeParity } = req.query;
  const useExe = useExeParityFlag(exeParity);
  try {
    if (useExe) {
      const result = await query(sqlShipmentViewGetDetail(), {
        shipmentKey: { type: sql.Int, value: parseInt(id, 10) },
      });
      return res.status(200).json({ success: true, source: 'real_db_exe_parity', items: result.recordset });
    }
    const result = await query(
      `SELECT
        sd.SdetailKey, sd.ShipmentKey, sd.ProdKey,
        CONVERT(NVARCHAR(10), sd.ShipmentDtm, 120) AS ShipmentDtm,
        p.ProdName, p.FlowerName, p.CounName,
        sd.BoxQuantity, sd.BunchQuantity, sd.SteamQuantity,
        sd.OutQuantity, sd.Cost, sd.Amount, sd.Vat, sd.Descr,
        p.OutUnit AS unit
       FROM ShipmentDetail sd
       JOIN Product p ON sd.ProdKey = p.ProdKey
       WHERE sd.ShipmentKey = @id
       ORDER BY p.CounName, p.FlowerName, p.ProdName`,
      { id: { type: sql.Int, value: parseInt(id, 10) } }
    );
    return res.status(200).json({ success: true, source: 'real_db', items: result.recordset });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
