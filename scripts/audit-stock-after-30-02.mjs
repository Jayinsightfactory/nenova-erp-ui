import { query, sql } from '../lib/db.js';

const year = '2026';
const afterWeek = '30-02';
const params = {
  yr: { type: sql.NVarChar, value: year },
  after: { type: sql.NVarChar, value: afterWeek },
};

const weeks = await query(
  `WITH week_keys AS (
     SELECT OrderWeek FROM StockMaster WHERE OrderYear=@yr AND OrderWeek>@after
     UNION
     SELECT OrderWeek FROM ShipmentMaster WHERE OrderYear=@yr AND OrderWeek>@after AND ISNULL(isDeleted,0)=0
   ), shipment AS (
     SELECT sm.OrderWeek,
            COUNT(CASE WHEN ISNULL(sd.OutQuantity,0)>0 THEN 1 END) detailCount,
            SUM(CASE WHEN ISNULL(sd.OutQuantity,0)>0 AND ISNULL(sd.isFix,0)=1 THEN 1 ELSE 0 END) fixedCount,
            SUM(CASE WHEN ISNULL(sd.OutQuantity,0)>0 AND ISNULL(sd.isFix,0)=0 THEN 1 ELSE 0 END) unfixedCount,
            SUM(CASE WHEN ISNULL(sd.OutQuantity,0)>0 AND ISNULL(sm.isFix,0)<>ISNULL(sd.isFix,0) THEN 1 ELSE 0 END) mismatchCount
       FROM ShipmentMaster sm
       LEFT JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
      WHERE sm.OrderYear=@yr AND sm.OrderWeek>@after AND ISNULL(sm.isDeleted,0)=0
      GROUP BY sm.OrderWeek
   ), stock AS (
     SELECT sm.OrderWeek,
            COUNT(DISTINCT CASE WHEN ps.Stock<0 THEN ps.ProdKey END) negativeSnapshotCount,
            COUNT(DISTINCT ps.ProdKey) stockProductCount
       FROM StockMaster sm
       LEFT JOIN ProductStock ps ON ps.StockKey=sm.StockKey
      WHERE sm.OrderYear=@yr AND sm.OrderWeek>@after
      GROUP BY sm.OrderWeek
   )
   SELECT wk.OrderWeek,
          ISNULL(sh.detailCount,0) detailCount,
          ISNULL(sh.fixedCount,0) fixedCount,
          ISNULL(sh.unfixedCount,0) unfixedCount,
          ISNULL(sh.mismatchCount,0) mismatchCount,
          ISNULL(st.negativeSnapshotCount,0) negativeSnapshotCount,
          ISNULL(st.stockProductCount,0) stockProductCount
     FROM week_keys wk
     LEFT JOIN shipment sh ON sh.OrderWeek=wk.OrderWeek
     LEFT JOIN stock st ON st.OrderWeek=wk.OrderWeek
    ORDER BY wk.OrderWeek`,
  params,
);

const targetKeys = [878,879,3208,1239,1204,1300,389,518,447,470,504];
const targetParams = {
  ...params,
  ...Object.fromEntries(targetKeys.map((key,index)=>[`p${index}`,{type:sql.Int,value:key}])),
};
const targets = await query(
  `SELECT sm.OrderWeek,p.ProdKey,p.ProdName,CAST(ps.Stock AS DECIMAL(18,2)) snapshotStock
     FROM StockMaster sm
     JOIN ProductStock ps ON ps.StockKey=sm.StockKey
     JOIN Product p ON p.ProdKey=ps.ProdKey
    WHERE sm.OrderYear=@yr AND sm.OrderWeek>@after
      AND p.ProdKey IN (${targetKeys.map((_,index)=>`@p${index}`).join(',')})
    ORDER BY sm.OrderWeek,p.ProdKey`,
  targetParams,
);

const negatives = await query(
  `SELECT sm.OrderWeek,p.ProdKey,p.ProdName,CAST(ps.Stock AS DECIMAL(18,2)) Stock
     FROM StockMaster sm
     JOIN ProductStock ps ON ps.StockKey=sm.StockKey
     JOIN Product p ON p.ProdKey=ps.ProdKey
    WHERE sm.OrderYear=@yr AND sm.OrderWeek>@after AND ps.Stock<0
    ORDER BY sm.OrderWeek,ps.Stock,p.ProdName`,
  params,
);

console.log(JSON.stringify({
  range: { year, afterWeek, lastWeek: weeks.recordset.at(-1)?.OrderWeek || null },
  weeks: weeks.recordset,
  negativeRows: negatives.recordset,
  targetChain: targets.recordset,
}, null, 2));
