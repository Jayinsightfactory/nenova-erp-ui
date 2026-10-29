import {getPool,sql} from './db.js';
import {buildProfitReportCategorySql} from './profitReportCountryResolver.js';
import {loadProfitCategoryOverrides,buildProfitOverrideCaseSqlFromMap} from './profitReportCategoryOverrides.js';
import {allowedProfitClassificationTargets} from './profitReportClassificationInput.js';
import {isNonValueWeightItem,isNonStockableItem} from './profitReportClassification.js';
import {isForwardingValueItem} from './customsForwarding.js';
import {reconcileProfitReportSources} from './profitReportSourceReconciliation.mjs';
export {reconcileProfitReportSources};
export async function loadProfitReportSourceReconciliation({year,major,report,signal}) {
  if(!/^\d{4}$/.test(String(year))||!/^\d{1,2}$/.test(String(major))||Number(major)<1||Number(major)>53)throw new Error('INVALID_REPORT_SCOPE');
  const category=buildProfitOverrideCaseSqlFromMap(buildProfitReportCategorySql('p'),'p',allowedProfitClassificationTargets(major),loadProfitCategoryOverrides(true));
  if(signal?.aborted)throw new Error('SOURCE_RECONCILIATION_ABORTED');
  const pool=await getPool();
  if(signal?.aborted)throw new Error('SOURCE_RECONCILIATION_ABORTED');
  const request=pool.request();
  request.timeout=45000;
  request.input('yr',sql.NVarChar,String(year));
  request.input('pfx',sql.NVarChar,`${Number(major)}-%`);
  request.input('padded',sql.NVarChar,`${String(Number(major)).padStart(2,'0')}-%`);
  const cancel=()=>request.cancel();
  signal?.addEventListener('abort',cancel,{once:true});
  let result;
  try {
    result=await request.query(`SELECT wm.OrderYear,wm.OrderWeek,wm.WarehouseKey,wd.WdetailKey,wd.ProdKey,wd.TPrice,wd.OutQuantity,wd.BunchQuantity,p.OutUnit,p.BunchOf1Box,p.ProdName,${category} AS Category
    FROM WarehouseMaster wm JOIN WarehouseDetail wd ON wd.WarehouseKey=wm.WarehouseKey
    LEFT JOIN Product p ON p.ProdKey=wd.ProdKey
    WHERE wm.OrderYear=@yr AND (wm.OrderWeek LIKE @pfx OR wm.OrderWeek LIKE @padded) AND ISNULL(wm.isDeleted,0)=0;
    SELECT sh.OrderYear,sh.OrderWeek,sh.ProdKey,sh.AfterValue-sh.BeforeValue AS Quantity,${category} AS Category
    FROM StockHistory sh LEFT JOIN Product p ON p.ProdKey=sh.ProdKey
    WHERE sh.OrderYear=@yr AND (sh.OrderWeek LIKE @pfx OR sh.OrderWeek LIKE @padded)
      AND sh.AfterValue>sh.BeforeValue
      AND EXISTS(SELECT 1 FROM CodeInfo ci WHERE ci.Category=N'StockType' AND ci.Descr=sh.ChangeType)`);
  } finally { signal?.removeEventListener('abort',cancel); }
  if(!Array.isArray(result.recordsets?.[0])||!Array.isArray(result.recordsets?.[1]))throw new Error('SOURCE_RESULT_INCOMPLETE');
  return reconcileProfitReportSources({year,major,report,adjustmentRows:result.recordsets[1],receiptRows:result.recordsets[0].map(r=>({...r,IsWeight:isNonValueWeightItem(r.ProdName),IsFreight:isForwardingValueItem(r.ProdName),IsStockable:!isNonStockableItem(r.ProdName)}))});
}
