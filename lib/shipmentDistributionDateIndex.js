// Classification only: physical stored date facts, never a quantity/price writer.
export const DISTRIBUTION_DATE_INDEX_SQL=`SELECT DISTINCT om.CustKey,od.ProdKey,
 CONVERT(nvarchar(10),d.ShipmentDtm,120) AS ShipmentDate
 FROM OrderMaster om
 JOIN Customer c ON c.CustKey=om.CustKey AND c.isDeleted=0
 JOIN OrderDetail od ON od.OrderMasterKey=om.OrderMasterKey AND od.isDeleted=0
 JOIN Product p ON p.ProdKey=od.ProdKey AND p.isDeleted=0
 LEFT JOIN ShipmentMaster sm ON sm.OrderYear=om.OrderYear AND sm.OrderWeek=om.OrderWeek AND sm.CustKey=om.CustKey AND sm.isDeleted=0
 LEFT JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey AND sd.ProdKey=od.ProdKey
 LEFT JOIN ShipmentDate d ON d.SdetailKey=sd.SdetailKey AND d.ShipmentQuantity>0
 WHERE om.OrderYear=@year AND om.OrderWeek=@week AND om.isDeleted=0
 ORDER BY om.CustKey,od.ProdKey,ShipmentDate`;
