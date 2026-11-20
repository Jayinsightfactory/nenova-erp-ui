import { WAREHOUSE_WEIGHT_ROW_SQL } from './warehouseWeightRows.js';

/**
 * nenova.exe FormWarehouseView — GetData / GetDetail
 */
export function sqlWarehouseViewGetData({ goodsTotals = false } = {}) {
  const sum = field => goodsTotals
    ? `SUM(CASE WHEN wd.IsWeightRow=0 THEN wd.${field} END)`
    : `SUM(wd.${field})`;
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
           ${sum('BoxQuantity')} AS BoxQuantity,
           ${sum('BunchQuantity')} AS BunchQuantity,
           ${sum('SteamQuantity')} AS SteamQuantity
      FROM ${goodsTotals
        ? `(SELECT wd.*, CONVERT(bit, CASE WHEN ${WAREHOUSE_WEIGHT_ROW_SQL} THEN 1 ELSE 0 END) AS IsWeightRow FROM WarehouseDetail wd)`
        : 'WarehouseDetail'} wd
     GROUP BY WarehouseKey
  ) wd ON wm.WarehouseKey = wd.WarehouseKey
 WHERE wm.isDeleted = 0
   AND CONVERT(DATE, wm.UploadDtm) BETWEEN @startDate AND @endDate
 ORDER BY wm.WarehouseKey DESC`;
}

export function sqlWarehouseViewGetDetail({ goodsTotals = false } = {}) {
  return `
SELECT wd.WdetailKey,
       wd.ProdKey,
       ${goodsTotals ? `CONVERT(bit, CASE WHEN ${WAREHOUSE_WEIGHT_ROW_SQL} THEN 1 ELSE 0 END) AS IsWeightRow,` : ''}
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
