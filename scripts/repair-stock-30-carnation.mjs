import { query, withTransaction, sql } from '../lib/db.js';

const year='2026', week='30-02', uid='nenovaSS3', cf='콜롬비아카네이션';
const targets=[
  {pk:389,name:'CARNATION Doncel',expected:-3,target:0},
  {pk:518,name:'CARNATION Giogia',expected:-3.21,target:2},
  {pk:447,name:'CARNATION Moon Light',expected:-26.01,target:0},
  {pk:470,name:'CARNATION Prado Mint',expected:-6.4,target:1},
  {pk:504,name:'CARNATION Zurigo',expected:-4,target:0},
];
const fixed=await query(`SELECT COUNT(*) cnt FROM ShipmentDetail sd JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey WHERE sm.OrderYear=@yr AND sm.OrderWeek=@wk AND ISNULL(sm.isDeleted,0)=0 AND ISNULL(sd.isFix,0)=1 AND sd.ProdKey IN (${targets.map((_,i)=>`@p${i}`).join(',')})`,{yr:{type:sql.NVarChar,value:year},wk:{type:sql.NVarChar,value:week},...Object.fromEntries(targets.map((t,i)=>[`p${i}`,{type:sql.Int,value:t.pk}]))});
if(Number(fixed.recordset[0].cnt)!==0) throw new Error('ABORT: target shipment details became fixed');

await withTransaction(async q=>{
  for(const t of targets){
    const snap=await q(`SELECT ps.Stock FROM ProductStock ps JOIN StockMaster sm ON sm.StockKey=ps.StockKey WHERE sm.OrderYear=@yr AND sm.OrderWeek=@wk AND ps.ProdKey=@pk`,{yr:{type:sql.NVarChar,value:year},wk:{type:sql.NVarChar,value:week},pk:{type:sql.Int,value:t.pk}});
    const selected=Number(snap.recordset[0]?.Stock);
    if(!Number.isFinite(selected)||Math.abs(selected-t.expected)>0.001) throw new Error(`ABORT ${t.name}: selected=${selected} expected=${t.expected}`);
    const live=await q(`SELECT Stock FROM Product WITH (UPDLOCK,HOLDLOCK) WHERE ProdKey=@pk`,{pk:{type:sql.Int,value:t.pk}});
    const before=Number(live.recordset[0].Stock), after=before+(t.target-selected);
    await q(`INSERT INTO StockHistory(ChangeDtm,OrderYear,OrderWeek,ChangeID,ChangeType,ColumName,BeforeValue,AfterValue,Descr,ProdKey) VALUES(GETDATE(),@yr,@wk,@uid,N'재고조정',N'재고수량',@before,@after,@descr,@pk)`,{yr:{type:sql.NVarChar,value:year},wk:{type:sql.NVarChar,value:week},uid:{type:sql.NVarChar,value:uid},before:{type:sql.Float,value:before},after:{type:sql.Float,value:after},descr:{type:sql.NVarChar,value:'30-02 승인 보정'},pk:{type:sql.Int,value:t.pk}});
    await q(`UPDATE Product SET Stock=ROUND(@after,2) WHERE ProdKey=@pk`,{after:{type:sql.Float,value:after},pk:{type:sql.Int,value:t.pk}});
    await q(`EXEC dbo.usp_StockCalculation @OrderYear=@yr,@OrderWeek=@wk,@ProdKey=@pk,@iUserID=@uid`,{yr:{type:sql.NVarChar,value:year},wk:{type:sql.NVarChar,value:week},pk:{type:sql.Int,value:t.pk},uid:{type:sql.NVarChar,value:uid}});
  }
});

const shape=await query(`SELECT LOWER(name) name FROM sys.parameters WHERE object_id=OBJECT_ID(N'dbo.usp_ShipmentFix')`);
const names=new Set(shape.recordset.map(r=>r.name));
const params={yr:{type:sql.NVarChar,value:year},wk:{type:sql.NVarChar,value:week},uid:{type:sql.NVarChar,value:uid},cf:{type:sql.NVarChar,value:cf}};
if(!names.has('@countryflower')) throw new Error('ABORT: scoped usp_ShipmentFix is unavailable');
const fixSql=names.has('@oresult')||names.has('@omessage')
 ? `DECLARE @r INT,@m NVARCHAR(MAX); EXEC dbo.usp_ShipmentFix @OrderYear=@yr,@OrderWeek=@wk,@CountryFlower=@cf,@iUserID=@uid,@oResult=@r OUTPUT,@oMessage=@m OUTPUT; SELECT @r result,@m message;`
 : `EXEC dbo.usp_ShipmentFix @OrderYear=@yr,@OrderWeek=@wk,@CountryFlower=@cf,@iUserID=@uid; SELECT 0 result,N'' message;`;
const fix=await query(fixSql,params); if(Number(fix.recordset.at(-1)?.result||0)!==0) throw new Error(`FIX FAILED ${JSON.stringify(fix.recordset)}`);
const verify=await query(`SELECT p.ProdName,ps.Stock selectedStock,p.Stock liveStock FROM Product p JOIN ProductStock ps ON ps.ProdKey=p.ProdKey JOIN StockMaster sm ON sm.StockKey=ps.StockKey WHERE sm.OrderYear=@yr AND sm.OrderWeek=@wk AND p.ProdKey IN (${targets.map((_,i)=>`@p${i}`).join(',')}) ORDER BY p.ProdName`,{yr:{type:sql.NVarChar,value:year},wk:{type:sql.NVarChar,value:week},...Object.fromEntries(targets.map((t,i)=>[`p${i}`,{type:sql.Int,value:t.pk}]))});
console.log(JSON.stringify({fix:fix.recordset,verify:verify.recordset},null,2));
