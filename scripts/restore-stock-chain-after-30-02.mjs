import { query, withTransaction, sql } from '../lib/db.js';

const year='2026', sourceWeek='30-02', boundaryWeek='31-01', uid='nenovaSS3';
const targets=[{pk:878,target:0},{pk:879,target:5},{pk:3208,target:0},{pk:1239,target:0},{pk:1204,target:0},{pk:1300,target:0},{pk:389,target:0},{pk:518,target:2},{pk:447,target:0},{pk:470,target:1},{pk:504,target:0}];
const common={yr:{type:sql.NVarChar,value:year},src:{type:sql.NVarChar,value:sourceWeek},boundary:{type:sql.NVarChar,value:boundaryWeek}};

async function shipmentFingerprint(q=query){
  const r=await q(`SELECT COUNT(*) detailCount,
      CAST(ISNULL(SUM(ISNULL(sd.OutQuantity,0)),0) AS DECIMAL(18,4)) outQty,
      SUM(CASE WHEN ISNULL(sd.isFix,0)=1 THEN 1 ELSE 0 END) fixedCount,
      COUNT(sf.SfarmKey) farmCount,
      CAST(ISNULL(SUM(ISNULL(sf.ShipmentQuantity,0)),0) AS DECIMAL(18,4)) farmQty
    FROM ShipmentMaster sm JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
    LEFT JOIN ShipmentFarm sf ON sf.SdetailKey=sd.SdetailKey
    WHERE sm.OrderYear=@yr AND sm.OrderWeek>=@src AND ISNULL(sm.isDeleted,0)=0`,common);
  return r.recordset[0];
}

const shipmentBefore=await shipmentFingerprint();
const restored=await withTransaction(async q=>{
  const prior=await q(`SELECT COUNT(*) cnt FROM StockHistory WHERE OrderYear=@yr AND OrderWeek=@boundary
    AND Descr=N'30-02 후속차수 원복' AND ProdKey IN (${targets.map((_,i)=>`@p${i}`).join(',')})`,{
    ...common,...Object.fromEntries(targets.map((t,i)=>[`p${i}`,{type:sql.Int,value:t.pk}]))});
  if(Number(prior.recordset[0].cnt)!==0) throw new Error('ABORT: restoration already exists');
  const rows=[];
  for(const item of targets){
    const state=await q(`SELECT p.Stock liveStock,ps.Stock sourceStock,
      (SELECT ISNULL(SUM(sh.AfterValue-sh.BeforeValue),0) FROM StockHistory sh
        WHERE sh.OrderYear=@yr AND sh.OrderWeek=@src AND sh.ProdKey=@pk
          AND (sh.Descr LIKE N'재고관리 일괄수정%' OR sh.Descr=N'30-02 승인 보정')) incidentDelta
      FROM Product p WITH(UPDLOCK,HOLDLOCK)
      JOIN ProductStock ps ON ps.ProdKey=p.ProdKey
      JOIN StockMaster sm ON sm.StockKey=ps.StockKey AND sm.OrderYear=@yr AND sm.OrderWeek=@src
      WHERE p.ProdKey=@pk`,{...common,pk:{type:sql.Int,value:item.pk}});
    const s=state.recordset[0];
    if(!s) throw new Error(`ABORT missing pk=${item.pk}`);
    if(Math.abs(Number(s.sourceStock)-item.target)>.001) throw new Error(`ABORT source pk=${item.pk} expected=${item.target} actual=${s.sourceStock}`);
    const inverse=-Number(s.incidentDelta), before=Number(s.liveStock), after=before+inverse;
    await q(`INSERT INTO StockHistory(ChangeDtm,OrderYear,OrderWeek,ChangeID,ChangeType,ColumName,BeforeValue,AfterValue,Descr,ProdKey)
      VALUES(GETDATE(),@yr,@boundary,@uid,N'재고조정',N'재고수량',@before,@after,N'30-02 후속차수 원복',@pk)`,{
      ...common,uid:{type:sql.NVarChar,value:uid},pk:{type:sql.Int,value:item.pk},before:{type:sql.Float,value:before},after:{type:sql.Float,value:after}});
    await q(`UPDATE Product SET Stock=ROUND(@after,2) WHERE ProdKey=@pk`,{after:{type:sql.Float,value:after},pk:{type:sql.Int,value:item.pk}});
    await q(`DECLARE @r INT,@m NVARCHAR(MAX);EXEC dbo.usp_StockCalculation @OrderYear=@yr,@OrderWeek=@boundary,@ProdKey=@pk,@iUserID=@uid,@oResult=@r OUTPUT,@oMessage=@m OUTPUT;
      IF ISNULL(@r,0)<>0 THROW 51000,@m,1;`,{...common,uid:{type:sql.NVarChar,value:uid},pk:{type:sql.Int,value:item.pk}});
    rows.push({prodKey:item.pk,incidentDelta:Number(s.incidentDelta),inverse,before,after});
  }
  return rows;
});
const shipmentAfter=await shipmentFingerprint();
if(JSON.stringify(shipmentBefore)!==JSON.stringify(shipmentAfter)) throw new Error(`SHIPMENT CHANGED before=${JSON.stringify(shipmentBefore)} after=${JSON.stringify(shipmentAfter)}`);
const verify=await query(`SELECT sm.OrderWeek,p.ProdKey,p.ProdName,CAST(ps.Stock AS DECIMAL(18,2)) Stock
  FROM StockMaster sm JOIN ProductStock ps ON ps.StockKey=sm.StockKey JOIN Product p ON p.ProdKey=ps.ProdKey
  WHERE sm.OrderYear=@yr AND sm.OrderWeek>=@boundary AND ps.Stock<0 AND p.ProdKey IN (${targets.map((_,i)=>`@p${i}`).join(',')}) ORDER BY sm.OrderWeek,p.ProdKey`,{
  ...common,...Object.fromEntries(targets.map((t,i)=>[`p${i}`,{type:sql.Int,value:t.pk}]))});
if(verify.recordset.length) throw new Error(`NEGATIVE TARGET CHAIN: ${JSON.stringify(verify.recordset)}`);
console.log(JSON.stringify({restored,shipmentBefore,shipmentAfter,negativeTargetChain:verify.recordset},null,2));
