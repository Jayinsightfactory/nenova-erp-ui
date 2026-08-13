import { query, sql } from '../lib/db.js';

const yr={type:sql.NVarChar,value:'2026'};
const result=await query(`
WITH repair AS (
 SELECT sh.ProdKey,
        SUM(CASE WHEN sh.OrderWeek=N'30-02' AND (sh.Descr LIKE N'재고관리 일괄수정%' OR sh.Descr=N'30-02 승인 보정') THEN sh.AfterValue-sh.BeforeValue ELSE 0 END) initialDelta,
        SUM(CASE WHEN sh.Descr=N'30-02 후속차수 원복' THEN sh.AfterValue-sh.BeforeValue ELSE 0 END) restoreDelta,
        MIN(CASE WHEN sh.Descr LIKE N'재고관리 일괄수정%' OR sh.Descr=N'30-02 승인 보정' THEN sh.ChangeDtm END) firstRepairDtm,
        MAX(CASE WHEN sh.Descr=N'30-02 후속차수 원복' THEN sh.ChangeDtm END) restoreDtm
 FROM StockHistory sh WHERE sh.OrderYear=@yr AND sh.OrderWeek IN(N'30-02',N'31-01')
   AND sh.ProdKey IN(878,879,3208,1239,1204,1300,389,518,447,470,504) GROUP BY sh.ProdKey
), snap AS (
 SELECT ps.ProdKey,
   MAX(CASE WHEN sm.OrderWeek=N'30-02' THEN ps.Stock END) s3002,
   MAX(CASE WHEN sm.OrderWeek=N'31-01' THEN ps.Stock END) s3101,
   MAX(CASE WHEN sm.OrderWeek=N'32-02' THEN ps.Stock END) s3202,
   MAX(CASE WHEN sm.OrderWeek=N'33-01' THEN ps.Stock END) s3301
 FROM ProductStock ps JOIN StockMaster sm ON sm.StockKey=ps.StockKey
 WHERE sm.OrderYear=@yr AND sm.OrderWeek IN(N'30-02',N'31-01',N'32-02',N'33-01') GROUP BY ps.ProdKey
)
SELECT p.ProdKey,p.ProdName,p.Stock liveStock,s.s3002,s.s3101,s.s3202,s.s3301,
 r.initialDelta,r.restoreDelta,r.firstRepairDtm,r.restoreDtm,
 CASE WHEN ABS(ISNULL(r.initialDelta,0)+ISNULL(r.restoreDelta,0))<0.001 THEN 1 ELSE 0 END repairNetZero
FROM repair r JOIN Product p ON p.ProdKey=r.ProdKey LEFT JOIN snap s ON s.ProdKey=r.ProdKey
WHERE ABS(ISNULL(r.initialDelta,0))>0 OR ABS(ISNULL(r.restoreDelta,0))>0
ORDER BY p.ProdName`,{yr});

const recent=await query(`SELECT TOP 100 sh.ChangeDtm,sh.OrderWeek,p.ProdName,sh.BeforeValue,sh.AfterValue,
 sh.AfterValue-sh.BeforeValue delta,sh.ChangeType,sh.Descr,sh.ChangeID
 FROM StockHistory sh JOIN Product p ON p.ProdKey=sh.ProdKey
 WHERE sh.OrderYear=@yr AND sh.ChangeDtm>=DATEADD(day,-3,GETDATE())
 ORDER BY sh.ChangeDtm DESC`,{yr});
const adjustments3101=await query(`SELECT sh.ProdKey,p.ProdName,sh.ChangeType,sh.Descr,sh.ChangeID,
  CAST(SUM(sh.AfterValue-sh.BeforeValue) AS DECIMAL(18,4)) delta,COUNT(*) rows,
  MIN(sh.ChangeDtm) firstDtm,MAX(sh.ChangeDtm) lastDtm,
  MAX(CASE WHEN ci.Descr IS NOT NULL THEN 1 ELSE 0 END) includedByExe
 FROM StockHistory sh JOIN Product p ON p.ProdKey=sh.ProdKey
 LEFT JOIN CodeInfo ci ON ci.Category=N'StockType' AND ci.Descr=sh.ChangeType
 WHERE sh.OrderYear=@yr AND sh.OrderWeek=N'31-01'
 GROUP BY sh.ProdKey,p.ProdName,sh.ChangeType,sh.Descr,sh.ChangeID
 ORDER BY ABS(SUM(sh.AfterValue-sh.BeforeValue)) DESC,p.ProdName`,{yr});
const sums3101=await query(`SELECT sh.ProdKey,p.ProdName,
  CAST(SUM(CASE WHEN ci.Descr IS NOT NULL THEN sh.AfterValue-sh.BeforeValue ELSE 0 END) AS DECIMAL(18,4)) exeAdjust,
  CAST(SUM(sh.AfterValue-sh.BeforeValue) AS DECIMAL(18,4)) allAdjust,
  CAST(SUM(CASE WHEN sh.Descr=N'30-02 후속차수 원복' THEN sh.AfterValue-sh.BeforeValue ELSE 0 END) AS DECIMAL(18,4)) restoreAdjust
 FROM StockHistory sh JOIN Product p ON p.ProdKey=sh.ProdKey
 LEFT JOIN CodeInfo ci ON ci.Category=N'StockType' AND ci.Descr=sh.ChangeType
 WHERE sh.OrderYear=@yr AND sh.OrderWeek=N'31-01'
 GROUP BY sh.ProdKey,p.ProdName
 HAVING ABS(SUM(sh.AfterValue-sh.BeforeValue))>.0001
 ORDER BY ABS(SUM(sh.AfterValue-sh.BeforeValue)) DESC`,{yr});
console.log(JSON.stringify({repairProducts:result.recordset,recentHistory:recent.recordset,adjustmentRows3101:adjustments3101.recordset,adjustmentSums3101:sums3101.recordset},null,2));
