/**
 * nenova.exe FormShipmentView — GetData / GetDetail
 */
export function sqlShipmentViewGetData({ custKey, custArea, manager } = {}) {
  let extra = '';
  if (custKey) extra += ' AND sm.CustKey = @custKey';
  if (custArea) extra += ` AND ISNULL(NULLIF(c.CustArea, N''), N'미지정') = @custArea`;
  if (manager) extra += ' AND om.Manager = @manager';
  return `
SELECT sm.ShipmentKey,
       sm.OrderYear,
       sm.OrderWeek,
       sm.CustKey,
       c.CustName,
       c.CustArea,
       om.Manager,
       sd.OutQuantity,
       sm.isFix,
       0 AS isSelect
  FROM ShipmentMaster sm
  JOIN (
    SELECT ShipmentKey, SUM(OutQuantity) AS OutQuantity
      FROM ShipmentDetail
     WHERE isFix = 1
     GROUP BY ShipmentKey
  ) sd ON sm.ShipmentKey = sd.ShipmentKey
  JOIN Customer c ON sm.CustKey = c.CustKey
  JOIN OrderMaster om
    ON sm.OrderYear = om.OrderYear
   AND sm.OrderWeek = om.OrderWeek
   AND sm.CustKey = om.CustKey
   AND om.isDeleted = 0
 WHERE sm.OrderYear = @orderYear
   AND sm.OrderWeek = @orderWeek
   ${extra}
   AND sm.isDeleted = 0
 ORDER BY sm.OrderWeek, sm.CustKey, sm.isFix`;
}

export function sqlShipmentViewGetDetail() {
  return `
WITH BaseShipmentData AS (
  SELECT vs.ProdKey,
         p.CounName,
         p.FlowerName,
         p.ProdName,
         p.OutUnit,
         sdd.ShipmentDtm,
         sdd.ShipmentQuantity AS OutQuantity,
         vs.Descr
    FROM ViewShipment vs
    JOIN ViewOrder vo
      ON vs.OrderYearWeek2 = vo.OrderYearWeek2
     AND vs.CustKey = vo.CustKey
     AND vs.ProdKey = vo.ProdKey
    JOIN Product p ON vs.ProdKey = p.ProdKey
    JOIN ShipmentDate sdd ON vs.SdetailKey = sdd.SdetailKey
   WHERE vs.ShipmentKey = @shipmentKey
     AND vs.DetailFix = 1
)
SELECT CounName,
       FlowerName,
       ProdName,
       OutUnit,
       ShipmentDtm,
       OutQuantity,
       Descr,
       ProdKey
  FROM BaseShipmentData
 ORDER BY CounName, FlowerName, ProdName, ShipmentDtm`;
}
