import { WAREHOUSE_WEIGHT_ROW_SQL } from './warehouseWeightRows.js';

// Web-only read columns: native packing uploads keep GW/CW/운송료 as Product
// detail rows (3100/3101/2182) and leave the web-added header columns NULL.
// Web invoice receipts keep non-USD 운송·부대비 in the committed document.
// These expressions never change the native header/detail values.
export const WAREHOUSE_DETAIL_COST_COLUMNS_SQL = `
            CASE WHEN SUM(CASE WHEN wd.ProdKey = 3100 THEN 1 ELSE 0 END) = 1
                 THEN MAX(CASE WHEN wd.ProdKey = 3100 THEN wd.SteamQuantity END) END AS DetailGrossWeight,
            CASE WHEN SUM(CASE WHEN wd.ProdKey = 3101 THEN 1 ELSE 0 END) = 1
                 THEN MAX(CASE WHEN wd.ProdKey = 3101 THEN wd.SteamQuantity END) END AS DetailChargeableWeight,
            SUM(CASE WHEN wd.ProdKey = 2182 THEN wd.TPrice END) AS DetailFreightAmount`;

export const WAREHOUSE_DOCUMENT_FREIGHT_APPLY_SQL = `
  OUTER APPLY (
    SELECT TOP (1)
           COALESCE(TRY_CONVERT(float, JSON_VALUE(doc.ReviewedMetadataJson, '$.costInputs.freight.amount')),
                    TRY_CONVERT(float, JSON_VALUE(doc.ReviewedMetadataJson, '$.unclassifiedAdditionalCharges.amount'))) AS DocFreightAmount,
           CASE WHEN TRY_CONVERT(float, JSON_VALUE(doc.ReviewedMetadataJson, '$.costInputs.freight.amount')) IS NOT NULL
                THEN JSON_VALUE(doc.ReviewedMetadataJson, '$.costInputs.freight.currency')
                ELSE JSON_VALUE(doc.ReviewedMetadataJson, '$.unclassifiedAdditionalCharges.currency') END AS DocFreightCurrency
      FROM dbo.WebInvoiceOperation op
      JOIN dbo.WebInvoiceDocument doc ON doc.DocumentId = op.DocumentId
     WHERE op.WarehouseKey = wm.WarehouseKey
       AND op.Status = N'COMMITTED'
       AND doc.ReceiptStatus = N'COMMITTED'
       AND op.DocumentRevision = doc.Revision
       AND doc.OrderYear = wm.OrderYear AND doc.OrderWeek = wm.OrderWeek
       AND ISJSON(doc.ReviewedMetadataJson) = 1
     ORDER BY op.DocumentRevision DESC
  ) invoiceDoc`;

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
       wd.DetailGrossWeight,
       wd.DetailChargeableWeight,
       wd.DetailFreightAmount,
       invoiceDoc.DocFreightAmount,
       invoiceDoc.DocFreightCurrency,
       wd.BoxQuantity AS totalBox,
       wd.BunchQuantity AS totalBunch,
       wd.SteamQuantity AS totalSteam
  FROM WarehouseMaster wm
  JOIN (
    SELECT WarehouseKey,
           ${sum('BoxQuantity')} AS BoxQuantity,
           ${sum('BunchQuantity')} AS BunchQuantity,
           ${sum('SteamQuantity')} AS SteamQuantity,${WAREHOUSE_DETAIL_COST_COLUMNS_SQL}
      FROM ${goodsTotals
        ? `(SELECT wd.*, CONVERT(bit, CASE WHEN ${WAREHOUSE_WEIGHT_ROW_SQL} THEN 1 ELSE 0 END) AS IsWeightRow FROM WarehouseDetail wd)`
        : 'WarehouseDetail'} wd
     GROUP BY WarehouseKey
  ) wd ON wm.WarehouseKey = wd.WarehouseKey${WAREHOUSE_DOCUMENT_FREIGHT_APPLY_SQL}
 WHERE wm.isDeleted = 0
   AND CONVERT(DATE, wm.UploadDtm) BETWEEN @startDate AND @endDate
 ORDER BY wm.WarehouseKey DESC`;
}

export function sqlWarehouseViewGetDetail({ goodsTotals = false, boxEvidence = false } = {}) {
  return `
SELECT wd.WdetailKey,
       wd.ProdKey,
       ${goodsTotals ? `CONVERT(bit, CASE WHEN ${WAREHOUSE_WEIGHT_ROW_SQL} THEN 1 ELSE 0 END) AS IsWeightRow,` : ''}
       ${goodsTotals && boxEvidence ? 'receiptGoods.GoodsLines AS ReceiptGoodsLines,' : ''}
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
  ${goodsTotals && boxEvidence ? `CROSS JOIN (
    SELECT COUNT(*) AS GoodsLines FROM WarehouseDetail wd
    WHERE wd.WarehouseKey=@warehouseKey AND CASE WHEN ${WAREHOUSE_WEIGHT_ROW_SQL} THEN 1 ELSE 0 END=0
  ) receiptGoods` : ''}
 WHERE wd.WarehouseKey = @warehouseKey
 ORDER BY p.CounName, p.FlowerName, p.ProdName`;
}
