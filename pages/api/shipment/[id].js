// pages/api/shipment/[id].js — 출고 상세 조회
import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';

export default withAuth(async function handler(req, res) {
  const { id } = req.query;
  try {
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
      { id: { type: sql.Int, value: parseInt(id) } }
    );
    return res.status(200).json({ success: true, source: 'real_db', items: result.recordset });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
