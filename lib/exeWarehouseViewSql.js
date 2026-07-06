/**
 * nenova.exe FormWarehouseView — GetData / GetDetail
 */
export function sqlWarehouseViewGetData() {
  return `
SELECT wm.WarehouseKey,
       wm.UploadDtm,
       wm.FileName,
       wm.OrderYear,
       wm.OrderWeek,
       wm.FarmName,
       wm.InvoiceNo,
       wm.InputDate,
       wm.OrderNo,
       wd.BoxQuantity,
       wd.BunchQuantity,
       wd.SteamQuantity
  FROM WarehouseMaster wm
  JOIN (
    SELECT WarehouseKey,
           SUM(wd.BoxQuantity) AS BoxQuantity,
           SUM(wd.BunchQuantity) AS BunchQuantity,
           SUM(wd.SteamQuantity) AS SteamQuantity
      FROM WarehouseDetail wd
     GROUP BY WarehouseKey
  ) wd ON wm.WarehouseKey = wd.WarehouseKey
 WHERE wm.isDeleted = 0
   AND CONVERT(DATE, wm.UploadDtm) BETWEEN @startDate AND @endDate
 ORDER BY wm.WarehouseKey DESC`;
}

export function sqlWarehouseViewGetDetail() {
  return `
SELECT wd.WdetailKey,
       wd.ProdKey,
       p.ProdName,
       p.OutUnit,
       wd.OrderCode,
       wd.BoxQuantity,
       wd.BunchQuantity,
       wd.SteamQuantity,
       wd.OutQuantity
  FROM WarehouseDetail wd
  JOIN Product p ON wd.ProdKey = p.ProdKey
 WHERE wd.WarehouseKey = @warehouseKey
 ORDER BY p.CounName, p.FlowerName, p.ProdName`;
}
