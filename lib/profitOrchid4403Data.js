import { query, sql } from './db.js';
import { purchaseByCategory } from './profitReport.js';
import { applyOrchid4403View, orchid4403Scope } from './profitOrchid4403.js';

export async function orchid4403ReportView(payload,major,orderYear) {
  if(!orchid4403Scope(orderYear,major)||payload?.orchid4403View)return payload;
  try {
    const result=await query(`SELECT wm.OrderYear,wm.OrderWeek,wm.WarehouseKey,wm.OrderNo,wm.FarmName,
      wd.WdetailKey,wd.ProdKey,wd.OutQuantity,wd.SteamQuantity,wd.UPrice,wd.TPrice,p.OutUnit,p.CounName
      FROM WarehouseMaster wm JOIN WarehouseDetail wd ON wd.WarehouseKey=wm.WarehouseKey
      JOIN Product p ON p.ProdKey=wd.ProdKey
      WHERE wm.OrderYear=@year AND wm.OrderWeek=@week AND wm.WarehouseKey=@warehouse
        AND wd.WdetailKey=@detail AND wd.ProdKey=@product AND ISNULL(wm.isDeleted,0)=0`,{
      year:{type:sql.NVarChar,value:'2026'},week:{type:sql.NVarChar,value:'44-03'},
      warehouse:{type:sql.Int,value:7870},detail:{type:sql.Int,value:47389},product:{type:sql.Int,value:3529},
    });
    const purchase=await purchaseByCategory('44','2026');
    return applyOrchid4403View(payload,{line:result.recordset[0],count:result.recordset.length,purchaseTotal:purchase['중국']},{orderYear,major});
  }catch{return applyOrchid4403View(payload,null,{orderYear,major});}
}
