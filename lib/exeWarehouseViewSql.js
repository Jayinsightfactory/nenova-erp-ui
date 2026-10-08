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
       wm.OrderNo AS AWB,
       wm.GrossWeight,
       wm.ChargeableWeight,
       wm.FreightRateUSD,
       wm.DocFeeUSD,
       wd.BoxQuantity AS totalBox,
       wd.BunchQuantity AS totalBunch,
       wd.SteamQuantity AS totalSteam
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
       p.OutUnit AS 단위,
       wd.OrderCode,
       wd.OrderCode AS 주문코드,
       wd.SteamOf1Bunch AS 단송이,
       wd.SteamOf1Box AS 박스송이,
       wd.UPrice AS 단가,
       wd.TPrice AS 총액,
       wd.BoxQuantity,
       wd.BunchQuantity,
       wd.SteamQuantity,
       wd.OutQuantity
  FROM WarehouseDetail wd
  JOIN Product p ON wd.ProdKey = p.ProdKey
 WHERE wd.WarehouseKey = @warehouseKey
 ORDER BY p.CounName, p.FlowerName, p.ProdName`;
}
