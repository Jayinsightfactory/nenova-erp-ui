import { withAuth } from '../../../lib/auth';
import { query, sql } from '../../../lib/db';

function todayText() {
  const now = new Date();
  return `${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}`;
}

export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method Not Allowed' });

  const marker = req.query.marker || todayText();
  const useMarker = marker && marker !== 'all';
  const limit = Math.min(parseInt(req.query.limit, 10) || 200, 500);
  const params = {
    marker: { type: sql.NVarChar, value: `%${marker}%` },
    limit: { type: sql.Int, value: limit },
  };
  const markerSql = useMarker ? `AND sh.Descr LIKE @marker` : '';
  const sdMarkerSql = useMarker ? `AND sd.Descr LIKE @marker` : '';
  const estMarkerSql = useMarker ? `AND e.Descr LIKE @marker` : '';

  const quantityHistory = await query(
    `SELECT TOP (@limit)
       sh.SdetailKey,
       CONVERT(NVARCHAR(19), sh.ChangeDtm, 120) AS ChangeDtm,
       sh.BeforeValue,
       sh.AfterValue,
       sh.Descr,
       sd.ShipmentKey,
       sm.OrderWeek,
       sm.CustKey,
       c.CustName,
       sd.ProdKey,
       p.ProdName,
       ISNULL(sm.isFix,0) AS MasterFix,
       ISNULL(sd.isFix,0) AS DetailFix,
       ISNULL(sd.OutQuantity,0) AS OutQuantity,
       ISNULL(sd.EstQuantity,0) AS EstQuantity,
       ISNULL(sd.BoxQuantity,0) AS BoxQuantity,
       ISNULL(sd.BunchQuantity,0) AS BunchQuantity,
       ISNULL(sd.SteamQuantity,0) AS SteamQuantity,
       ISNULL(sd.Cost,0) AS Cost,
       ISNULL(sd.Amount,0) AS Amount,
       ISNULL(sd.Vat,0) AS Vat,
       CONVERT(NVARCHAR(10), sd.ShipmentDtm, 120) AS ShipmentDtm,
       ISNULL(sdt.DateCount,0) AS ShipmentDateCount,
       ISNULL(sdt.DateQty,0) AS ShipmentDateQty,
       CASE WHEN ISNULL(sd.OutQuantity,0) > 0 AND sd.ShipmentDtm IS NULL THEN 1 ELSE 0 END AS MissingShipmentDtm,
       CASE WHEN ABS(ISNULL(sdt.DateQty,0) - ISNULL(sd.OutQuantity,0)) > 0.001 THEN 1 ELSE 0 END AS ShipmentDateMismatch
     FROM ShipmentHistory sh
     JOIN ShipmentDetail sd ON sd.SdetailKey = sh.SdetailKey
     JOIN ShipmentMaster sm ON sm.ShipmentKey = sd.ShipmentKey
     LEFT JOIN Product p ON p.ProdKey = sd.ProdKey
     LEFT JOIN Customer c ON c.CustKey = sm.CustKey
     OUTER APPLY (
       SELECT COUNT(*) AS DateCount, SUM(ISNULL(ShipmentQuantity,0)) AS DateQty
       FROM ShipmentDate
       WHERE SdetailKey = sd.SdetailKey
     ) sdt
     WHERE (sh.Descr LIKE N'%견적서관리%' OR sh.Descr LIKE N'%수량%')
       ${markerSql}
     ORDER BY sh.ChangeDtm DESC`,
    params
  );

  const shipmentCostRows = await query(
    `SELECT TOP (@limit)
       sd.SdetailKey,
       sd.ShipmentKey,
       sm.OrderWeek,
       sm.CustKey,
       c.CustName,
       sd.ProdKey,
       p.ProdName,
       ISNULL(sm.isFix,0) AS MasterFix,
       ISNULL(sd.isFix,0) AS DetailFix,
       ISNULL(sd.OutQuantity,0) AS OutQuantity,
       ISNULL(sd.EstQuantity,0) AS EstQuantity,
       ISNULL(sd.BoxQuantity,0) AS BoxQuantity,
       ISNULL(sd.BunchQuantity,0) AS BunchQuantity,
       ISNULL(sd.SteamQuantity,0) AS SteamQuantity,
       ISNULL(sd.Cost,0) AS Cost,
       ISNULL(sd.Amount,0) AS Amount,
       ISNULL(sd.Vat,0) AS Vat,
       CONVERT(NVARCHAR(10), sd.ShipmentDtm, 120) AS ShipmentDtm,
       ISNULL(sd.Descr,'') AS Descr,
       ISNULL(sdt.DateCount,0) AS ShipmentDateCount,
       ISNULL(sdt.DateQty,0) AS ShipmentDateQty,
       CASE WHEN ISNULL(sd.OutQuantity,0) > 0 AND sd.ShipmentDtm IS NULL THEN 1 ELSE 0 END AS MissingShipmentDtm,
       CASE WHEN ABS(ISNULL(sdt.DateQty,0) - ISNULL(sd.OutQuantity,0)) > 0.001 THEN 1 ELSE 0 END AS ShipmentDateMismatch
     FROM ShipmentDetail sd
     JOIN ShipmentMaster sm ON sm.ShipmentKey = sd.ShipmentKey
     LEFT JOIN Product p ON p.ProdKey = sd.ProdKey
     LEFT JOIN Customer c ON c.CustKey = sm.CustKey
     OUTER APPLY (
       SELECT COUNT(*) AS DateCount, SUM(ISNULL(ShipmentQuantity,0)) AS DateQty
       FROM ShipmentDate
       WHERE SdetailKey = sd.SdetailKey
     ) sdt
     WHERE sd.Descr LIKE N'%단가%'
       ${sdMarkerSql}
     ORDER BY sd.SdetailKey DESC`,
    params
  );

  const estimateRows = await query(
    `SELECT TOP (@limit)
       e.EstimateKey,
       e.ShipmentKey,
       sm.OrderWeek,
       sm.CustKey,
       c.CustName,
       e.ProdKey,
       p.ProdName,
       e.EstimateType,
       e.Unit,
       ISNULL(e.Quantity,0) AS Quantity,
       ISNULL(e.Cost,0) AS Cost,
       ISNULL(e.Amount,0) AS Amount,
       ISNULL(e.Vat,0) AS Vat,
       ISNULL(e.Descr,'') AS Descr,
       CASE WHEN ISNULL(e.Quantity,0) > 0 AND ISNULL(e.Amount,0) > 0 THEN 1 ELSE 0 END AS PositiveDeductionRisk,
       CASE WHEN ABS(ROUND(ISNULL(e.Quantity,0) * ISNULL(e.Cost,0) / 1.1, 0) - ISNULL(e.Amount,0)) > 1 THEN 1 ELSE 0 END AS AmountMismatch,
       CASE WHEN ABS(ROUND(ISNULL(e.Quantity,0) * ISNULL(e.Cost,0) / 11, 0) - ISNULL(e.Vat,0)) > 1 THEN 1 ELSE 0 END AS VatMismatch
     FROM Estimate e
     JOIN ShipmentMaster sm ON sm.ShipmentKey = e.ShipmentKey
     LEFT JOIN Product p ON p.ProdKey = e.ProdKey
     LEFT JOIN Customer c ON c.CustKey = sm.CustKey
     WHERE (e.Descr LIKE N'%차감단가%' OR e.Descr LIKE N'%차감수량%')
       ${estMarkerSql}
     ORDER BY e.EstimateKey DESC`,
    params
  );

  const normalRows = [...quantityHistory.recordset, ...shipmentCostRows.recordset];
  const estimate = estimateRows.recordset;
  const risks = [
    ...normalRows.filter(r => r.MissingShipmentDtm).map(r => ({ type: 'MISSING_SHIPMENT_DTM', key: r.SdetailKey, orderWeek: r.OrderWeek, prodName: r.ProdName })),
    ...normalRows.filter(r => r.ShipmentDateMismatch).map(r => ({ type: 'SHIPMENT_DATE_MISMATCH', key: r.SdetailKey, orderWeek: r.OrderWeek, prodName: r.ProdName, outQuantity: r.OutQuantity, dateQty: r.ShipmentDateQty })),
    ...estimate.filter(r => r.PositiveDeductionRisk).map(r => ({ type: 'POSITIVE_DEDUCTION', key: r.EstimateKey, orderWeek: r.OrderWeek, prodName: r.ProdName, quantity: r.Quantity })),
    ...estimate.filter(r => r.AmountMismatch || r.VatMismatch).map(r => ({ type: 'ESTIMATE_AMOUNT_MISMATCH', key: r.EstimateKey, orderWeek: r.OrderWeek, prodName: r.ProdName, amountMismatch: r.AmountMismatch, vatMismatch: r.VatMismatch })),
  ];

  return res.status(200).json({
    success: true,
    marker,
    summary: {
      shipmentQuantityEdits: quantityHistory.recordset.length,
      shipmentCostEdits: shipmentCostRows.recordset.length,
      estimateDeductionEdits: estimate.length,
      riskCount: risks.length,
    },
    risks,
    shipmentQuantityEdits: quantityHistory.recordset,
    shipmentCostEdits: shipmentCostRows.recordset,
    estimateDeductionEdits: estimate,
  });
});
