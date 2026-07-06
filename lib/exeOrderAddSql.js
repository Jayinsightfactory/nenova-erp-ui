/**
 * nenova.exe FormOrderAdd — GetDataProduct / Flower / Country
 */
export function sqlOrderAddGetDataProduct() {
  return `
SELECT p.ProdKey, p.ProdName, p.CounName, p.FlowerName, p.CountryFlower,
       p.EstUnit, p.OutUnit,
       NULL AS ChangeBox, NULL AS ChangeBunch, NULL AS ChangeSteam,
       ISNULL(od.BoxQuantity, 0) AS OrderBox,
       ISNULL(od.BunchQuantity, 0) AS OrderBunch,
       ISNULL(od.SteamQuantity, 0) AS OrderSteam,
       ISNULL(od.OutQuantity, 0) AS OrderCnt,
       od.NoneOutQuantity,
       p.Stock,
       c.isSelectFlower,
       od.OrderDetailKey,
       ISNULL(od.ShipmentKey, 0) AS ShipmentKey,
       p.BunchOf1Box, p.SteamOf1Bunch, p.SteamOf1Box
  FROM Product p
  JOIN Country c ON p.CounName = c.CounName
  LEFT JOIN (
    SELECT om.OrderMasterKey, od.OrderDetailKey,
           od.BoxQuantity, od.BunchQuantity, od.SteamQuantity,
           od.OutQuantity, od.NoneOutQuantity, od.ProdKey,
           vs.ShipmentKey
      FROM OrderMaster om
      JOIN OrderDetail od ON om.OrderMasterKey = od.OrderMasterKey
      LEFT JOIN ViewShipment vs
        ON om.OrderYear = vs.OrderYear
       AND om.OrderWeek = vs.OrderWeek
       AND om.CustKey = vs.CustKey
       AND od.ProdKey = vs.ProdKey
     WHERE om.OrderMasterKey = @orderMasterKey
       AND od.isDeleted = 0
  ) od ON p.ProdKey = od.ProdKey
 WHERE p.isDeleted = 0
 ORDER BY ISNULL(od.OutQuantity, 0) DESC, p.ProdName`;
}

export function sqlOrderAddGetDataFlower() {
  return `
SELECT f.FlowerKey, f.FlowerName, p.CounName, ISNULL(p.OutQuantity, 0) AS OrderCnt
  FROM Flower f
  JOIN (
    SELECT p.CounName, p.FlowerName, SUM(od.OutQuantity) AS OutQuantity
      FROM Product p
      LEFT JOIN OrderDetail od ON p.ProdKey = od.ProdKey AND od.isDeleted = 0 AND od.OrderMasterKey = @orderMasterKey
     WHERE p.isDeleted = 0
     GROUP BY p.CounName, p.FlowerName
  ) p ON f.FlowerName = p.FlowerName
 ORDER BY p.CounName, f.FlowerName`;
}

export function sqlOrderAddGetDataCountry() {
  return `
SELECT c.CounKey, p.CountryFlower,
       CASE WHEN c.isSelectFlower = 1 THEN N'' ELSE p.FlowerName END AS FlowerName,
       c.isSelectFlower,
       ISNULL(p.OutQuantity, 0) AS OrderCnt
  FROM Country c
  JOIN (
    SELECT p.CounName, MAX(p.FlowerName) AS FlowerName, p.CountryFlower,
           SUM(od.OutQuantity) AS OutQuantity
      FROM Product p
      LEFT JOIN OrderDetail od ON p.ProdKey = od.ProdKey AND od.OrderMasterKey = @orderMasterKey AND od.isDeleted = 0
     WHERE p.isDeleted = 0
     GROUP BY p.CounName, p.CountryFlower
  ) p ON c.CounName = p.CounName
 ORDER BY ISNULL(p.OutQuantity, 0) DESC, c.CounName`;
}
