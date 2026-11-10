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

// Display baseline only. Canonical context remains the final eligibility/snapshot authority.
export const DISTRIBUTION_INLINE_DATES_SQL=`SELECT sm.CustKey,sd.ProdKey,sd.SdetailKey,sd.OutQuantity,p.OutUnit,p.BunchOf1Box,p.SteamOf1Bunch,p.SteamOf1Box,
 d.SdateKey,CONVERT(nvarchar(23),d.ShipmentDtm,121) AS Timestamp,d.ShipmentQuantity
 FROM ShipmentMaster sm JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
 JOIN Customer c ON c.CustKey=sm.CustKey AND c.isDeleted=0
 JOIN Product p ON p.ProdKey=sd.ProdKey AND p.isDeleted=0
 LEFT JOIN ShipmentDate d ON d.SdetailKey=sd.SdetailKey
 WHERE sm.OrderYear=@year AND sm.OrderWeek=@week AND sm.isDeleted=0
 ORDER BY sm.CustKey,sd.ProdKey,d.SdateKey`;

// Read-only comparison across the selected major week. Existing date writer stays detail-week scoped.
export const DISTRIBUTION_MAJOR_INLINE_DATES_SQL=`SELECT sm.OrderYear,sm.OrderWeek,sm.CustKey,sd.ProdKey,sd.SdetailKey,sd.OutQuantity,p.OutUnit,p.BunchOf1Box,p.SteamOf1Bunch,p.SteamOf1Box,
 d.SdateKey,CONVERT(nvarchar(23),d.ShipmentDtm,121) AS Timestamp,d.ShipmentQuantity
 FROM ShipmentMaster sm JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
 JOIN Customer c ON c.CustKey=sm.CustKey AND c.isDeleted=0
 JOIN Product p ON p.ProdKey=sd.ProdKey AND p.isDeleted=0
 LEFT JOIN ShipmentDate d ON d.SdetailKey=sd.SdetailKey
 WHERE sm.OrderYear=@year AND sm.OrderWeek IN(@major+'-01',@major+'-02',@major+'-03',@major+'-04') AND sm.isDeleted=0
 ORDER BY sm.CustKey,sd.ProdKey,sm.OrderWeek,d.SdateKey`;
