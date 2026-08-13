import { query, withTransaction, sql } from '../lib/db.js';

const year='2026',week='31-01';
const keys=[878,879,3208,1239,1204,1300,389,518,447,470,504];
const params={yr:{type:sql.NVarChar,value:year},wk:{type:sql.NVarChar,value:week},...Object.fromEntries(keys.map((key,index)=>[`p${index}`,{type:sql.Int,value:key}]))};
const inList=keys.map((_,index)=>`@p${index}`).join(',');
async function snapshot(q=query){
 const stock=await q(`SELECT sm.OrderWeek,ps.ProdKey,CAST(ps.Stock AS DECIMAL(18,4)) Stock FROM StockMaster sm JOIN ProductStock ps ON ps.StockKey=sm.StockKey WHERE sm.OrderYear=@yr AND sm.OrderWeek>=@wk AND ps.ProdKey IN(${inList}) ORDER BY sm.OrderWeek,ps.ProdKey`,params);
 const shipment=await q(`SELECT COUNT(*) detailCount,CAST(ISNULL(SUM(sd.OutQuantity),0) AS DECIMAL(18,4)) outQty,SUM(CASE WHEN ISNULL(sd.isFix,0)=1 THEN 1 ELSE 0 END) fixedCount FROM ShipmentMaster sm JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey WHERE sm.OrderYear=@yr AND sm.OrderWeek>=@wk AND ISNULL(sm.isDeleted,0)=0`,params);
 return {stock:stock.recordset,shipment:shipment.recordset[0]};
}
const before=await snapshot();
const removed=await withTransaction(async q=>{
 const rows=await q(`SELECT StockHistoryKey,ProdKey,BeforeValue,AfterValue FROM StockHistory WITH(UPDLOCK,HOLDLOCK) WHERE OrderYear=@yr AND OrderWeek=@wk AND Descr=N'30-02 후속차수 원복' AND ChangeID=N'nenovaSS3' AND ProdKey IN(${inList}) ORDER BY ProdKey`,params);
 if(rows.recordset.length!==11) throw new Error(`ABORT expected 11 rows actual=${rows.recordset.length}`);
 await q(`DELETE FROM StockHistory WHERE OrderYear=@yr AND OrderWeek=@wk AND Descr=N'30-02 후속차수 원복' AND ChangeID=N'nenovaSS3' AND ProdKey IN(${inList})`,params);
 const post=await snapshot(q);
 if(JSON.stringify(before)!==JSON.stringify(post)) throw new Error('ABORT snapshot or shipment changed while removing invalid history');
 return rows.recordset;
});
const after=await snapshot();
const remain=await query(`SELECT COUNT(*) cnt FROM StockHistory WHERE OrderYear=@yr AND OrderWeek=@wk AND Descr=N'30-02 후속차수 원복' AND ProdKey IN(${inList})`,params);
if(Number(remain.recordset[0].cnt)!==0) throw new Error('ABORT invalid history remains');
console.log(JSON.stringify({removed,before,after,remaining:0},null,2));
