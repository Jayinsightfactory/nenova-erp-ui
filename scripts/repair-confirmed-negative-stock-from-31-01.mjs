import { sql, withTransaction } from '../lib/db.js';

const year = '2026';
const week = '31-01';
const userId = 'nenovaSS3';
const marker = '[확정음수복구 2026-08-13]';

const result = await withTransaction(async (tQuery) => {
  const beforeShipment = (await tQuery(
    `SELECT COUNT(*) detailCount, CAST(ISNULL(SUM(sd.OutQuantity),0) AS DECIMAL(18,4)) outQty,
            SUM(CASE WHEN ISNULL(sd.isFix,0)=1 THEN 1 ELSE 0 END) fixedCount
       FROM ShipmentMaster sm JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
      WHERE sm.OrderYear=@yr AND sm.OrderWeek>=@wk AND ISNULL(sm.isDeleted,0)=0`,
    { yr:{type:sql.NVarChar,value:year}, wk:{type:sql.NVarChar,value:week} }
  )).recordset[0];

  const negatives = (await tQuery(
    `SELECT ps.ProdKey,p.ProdName,CAST(-ps.Stock AS DECIMAL(18,2)) shortage
       FROM StockMaster sm JOIN ProductStock ps ON ps.StockKey=sm.StockKey
       JOIN Product p ON p.ProdKey=ps.ProdKey
      WHERE sm.OrderYear=@yr AND sm.OrderWeek=@wk AND ps.Stock<0
        AND ps.ProdKey IN (389,1204,1239,1300)
        AND NOT EXISTS (SELECT 1 FROM StockHistory sh WHERE sh.OrderYear=@yr AND sh.OrderWeek=@wk
                         AND sh.ProdKey=ps.ProdKey AND sh.Descr LIKE @markerLike)`,
    { yr:{type:sql.NVarChar,value:year}, wk:{type:sql.NVarChar,value:week}, markerLike:{type:sql.NVarChar,value:`${marker}%`} }
  )).recordset;

  for (const row of negatives) {
    const live = (await tQuery(`SELECT ISNULL(Stock,0) Stock FROM Product WITH (UPDLOCK,HOLDLOCK) WHERE ProdKey=@pk`,
      {pk:{type:sql.Int,value:Number(row.ProdKey)}})).recordset[0];
    const before = Number(live.Stock||0);
    const after = before + Number(row.shortage);
    await tQuery(
      `INSERT INTO StockHistory(ChangeDtm,OrderYear,OrderWeek,ChangeID,ChangeType,ColumName,BeforeValue,AfterValue,Descr,ProdKey)
       VALUES(GETDATE(),@yr,@wk,@uid,N'재고조정',N'재고수량',@before,@after,@descr,@pk)`,
      {yr:{type:sql.NVarChar,value:year},wk:{type:sql.NVarChar,value:week},uid:{type:sql.NVarChar,value:userId},
       before:{type:sql.Float,value:before},after:{type:sql.Float,value:after},
       descr:{type:sql.NVarChar,value:`${marker} ${row.ProdName} 부족 ${row.shortage}`},pk:{type:sql.Int,value:Number(row.ProdKey)}}
    );
    const calc = await tQuery(
      `DECLARE @r INT,@m NVARCHAR(MAX); EXEC dbo.usp_StockCalculation @OrderYear=@yr,@OrderWeek=@wk,@ProdKey=@pk,@iUserID=@uid,@oResult=@r OUTPUT,@oMessage=@m OUTPUT; SELECT ISNULL(@r,0) result,@m message;`,
      {yr:{type:sql.NVarChar,value:year},wk:{type:sql.NVarChar,value:week},uid:{type:sql.NVarChar,value:userId},pk:{type:sql.Int,value:Number(row.ProdKey)}}
    );
    if (Number(calc.recordset.at(-1)?.result)!==0) throw new Error(`CALC FAILED ${row.ProdKey}`);
  }

  const remaining = (await tQuery(
    `SELECT sm.OrderWeek,ps.ProdKey,p.ProdName,ps.Stock FROM StockMaster sm
     JOIN ProductStock ps ON ps.StockKey=sm.StockKey JOIN Product p ON p.ProdKey=ps.ProdKey
     WHERE sm.OrderYear=@yr AND sm.OrderWeek>=@wk AND ps.Stock<0 AND ps.ProdKey IN (389,1204,1239,1300)`,
    {yr:{type:sql.NVarChar,value:year},wk:{type:sql.NVarChar,value:week}}
  )).recordset;
  if (remaining.length) throw new Error(`NEGATIVE REMAINS ${JSON.stringify(remaining)}`);

  const afterShipment = (await tQuery(
    `SELECT COUNT(*) detailCount, CAST(ISNULL(SUM(sd.OutQuantity),0) AS DECIMAL(18,4)) outQty,
            SUM(CASE WHEN ISNULL(sd.isFix,0)=1 THEN 1 ELSE 0 END) fixedCount
       FROM ShipmentMaster sm JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
      WHERE sm.OrderYear=@yr AND sm.OrderWeek>=@wk AND ISNULL(sm.isDeleted,0)=0`,
    {yr:{type:sql.NVarChar,value:year},wk:{type:sql.NVarChar,value:week}}
  )).recordset[0];
  if (JSON.stringify(beforeShipment)!==JSON.stringify(afterShipment)) throw new Error('SHIPMENT CHANGED');
  return {adjustments:negatives,beforeShipment,afterShipment,remaining};
});

console.log(JSON.stringify(result,null,2));
