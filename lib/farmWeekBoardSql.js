// Read-only. Same active master/product/customer predicates as pivotStats volume sheets.
export const FARM_WEEK_BOARD_SQL = `
WITH quantities AS (
 SELECT wm.OrderYear orderYear, wm.OrderWeek orderWeek, wd.ProdKey prodKey,
        N'incoming' kind, wm.FarmName farm, ISNULL(wd.OutQuantity,0) quantity
 FROM WarehouseMaster wm JOIN WarehouseDetail wd ON wd.WarehouseKey=wm.WarehouseKey
 WHERE wm.OrderYear=@year AND wm.OrderWeek=@week AND ISNULL(wm.isDeleted,0)=0
 UNION ALL
 SELECT om.OrderYear, om.OrderWeek, od.ProdKey, N'order', NULL, ISNULL(od.OutQuantity,0)
 FROM OrderMaster om JOIN OrderDetail od ON od.OrderMasterKey=om.OrderMasterKey AND ISNULL(od.isDeleted,0)=0
 JOIN Customer c ON c.CustKey=om.CustKey AND ISNULL(c.isDeleted,0)=0
 WHERE om.OrderYear=@year AND om.OrderWeek=@week AND ISNULL(om.isDeleted,0)=0
 UNION ALL
 SELECT sm.OrderYear, sm.OrderWeek, sd.ProdKey, N'distribution', NULL, ISNULL(sd.OutQuantity,0)
 FROM ShipmentMaster sm JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
 JOIN Customer c ON c.CustKey=sm.CustKey AND ISNULL(c.isDeleted,0)=0
 WHERE sm.OrderYear=@year AND sm.OrderWeek=@week AND ISNULL(sm.isDeleted,0)=0
 UNION ALL
 SELECT sh.OrderYear, sh.OrderWeek, sh.ProdKey, N'adjustment', NULL, ISNULL(sh.AfterValue,0)-ISNULL(sh.BeforeValue,0)
 FROM StockHistory sh WHERE sh.OrderYear=@year AND sh.OrderWeek=@week
 AND (sh.ChangeType IS NULL OR sh.ChangeType NOT IN (N'확정',N'확정취소',N'입고',N'출고'))
)
SELECT q.orderYear,q.orderWeek,q.prodKey,q.kind,q.farm,SUM(q.quantity) quantity,
 p.ProdName prodName,p.CounName country,p.FlowerName flower,p.OutUnit unit
FROM quantities q JOIN Product p ON p.ProdKey=q.prodKey AND ISNULL(p.isDeleted,0)=0
GROUP BY q.orderYear,q.orderWeek,q.prodKey,q.kind,q.farm,p.ProdName,p.CounName,p.FlowerName,p.OutUnit`;

export const FARM_WEEK_BOARD_ACTIVE_WEEKS_SQL = `
SELECT w.OrderWeek week,
       MAX(w.hasIncoming) hasIncoming,
       MAX(w.hasOrder) hasOrder,
       MAX(w.hasDistribution) hasDistribution
FROM (
 SELECT wm.OrderWeek, 1 hasIncoming, 0 hasOrder, 0 hasDistribution
 FROM WarehouseMaster wm JOIN WarehouseDetail wd ON wd.WarehouseKey=wm.WarehouseKey
 WHERE wm.OrderYear=@year AND ISNULL(wm.isDeleted,0)=0 AND ISNULL(wd.OutQuantity,0)<>0
 UNION ALL
 SELECT om.OrderWeek, 0, 1, 0
 FROM OrderMaster om JOIN OrderDetail od ON od.OrderMasterKey=om.OrderMasterKey AND ISNULL(od.isDeleted,0)=0
 JOIN Customer c ON c.CustKey=om.CustKey AND ISNULL(c.isDeleted,0)=0
 WHERE om.OrderYear=@year AND ISNULL(om.isDeleted,0)=0 AND ISNULL(od.OutQuantity,0)<>0
 UNION ALL
 SELECT sm.OrderWeek, 0, 0, 1
 FROM ShipmentMaster sm JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
 JOIN Customer c ON c.CustKey=sm.CustKey AND ISNULL(c.isDeleted,0)=0
 WHERE sm.OrderYear=@year AND ISNULL(sm.isDeleted,0)=0 AND ISNULL(sd.OutQuantity,0)<>0
) w
WHERE w.OrderWeek LIKE N'[0-5][0-9]-0[1-4]'
GROUP BY w.OrderWeek
ORDER BY w.OrderWeek DESC`;
