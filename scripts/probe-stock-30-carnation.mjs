import { query, sql } from '../lib/db.js';

const names = ['CARNATION Doncel','CARNATION Giogia','CARNATION Moon Light','CARNATION Prado Mint','CARNATION Zurigo'];
const result = await query(`
  SELECT p.ProdKey,p.ProdName,p.CountryFlower,p.Stock,
    MAX(CASE WHEN stk.OrderYear=N'2026' AND stk.OrderWeek=N'30-02' THEN ps.Stock END) selectedStock,
    SUM(CASE WHEN sm.OrderYear=N'2026' AND sm.OrderWeek=N'30-02' AND ISNULL(sm.isDeleted,0)=0 AND ISNULL(sd.isFix,0)=1 THEN 1 ELSE 0 END) fixedLines,
    SUM(CASE WHEN sm.OrderYear=N'2026' AND sm.OrderWeek=N'30-02' AND ISNULL(sm.isDeleted,0)=0 AND ISNULL(sd.isFix,0)=0 THEN 1 ELSE 0 END) unfixedLines
  FROM Product p
  LEFT JOIN ShipmentDetail sd ON sd.ProdKey=p.ProdKey
  LEFT JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey
  LEFT JOIN ProductStock ps ON ps.ProdKey=p.ProdKey
  LEFT JOIN StockMaster stk ON stk.StockKey=ps.StockKey
  WHERE p.ProdName IN (${names.map((_,i)=>`@n${i}`).join(',')}) AND ISNULL(p.isDeleted,0)=0
  GROUP BY p.ProdKey,p.ProdName,p.CountryFlower,p.Stock
  ORDER BY p.ProdName`, Object.fromEntries(names.map((n,i)=>[`n${i}`,{type:sql.NVarChar,value:n}])));
console.log(JSON.stringify(result.recordset,null,2));
