const sql=require('mssql'),assert=require('node:assert/strict');
(async()=>{const p=await sql.connect({server:process.env.DB_SERVER,port:Number(process.env.DB_PORT||1433),database:process.env.DB_NAME,user:process.env.DB_USER,password:process.env.DB_PASSWORD,options:{encrypt:false,trustServerCertificate:true},requestTimeout:15000});const tx=new sql.Transaction(p);let open=false;try{
const state=(await p.request().query(`SELECT Mode,Action,PendingCalc,OwnerSessionID FROM NenovaStockWeekGate;
SELECT OrderYear,OrderWeek,InvoiceNo,COUNT(*) detailRows FROM ViewWarehouse WHERE WarehouseKey=7213 GROUP BY OrderYear,OrderWeek,InvoiceNo;
SELECT p.ProdKey,p.ProdName,ps.Stock FROM ProductStock ps JOIN StockMaster sm ON sm.StockKey=ps.StockKey JOIN Product p ON p.ProdKey=ps.ProdKey WHERE sm.OrderYear='2026' AND sm.OrderWeek='37-01' AND ps.ProdKey IN(2565,2829,3353,3354,3355,3356,3357) ORDER BY p.ProdKey;
SELECT COUNT(*) sourceRows FROM StockMaster WHERE OrderYear='2026' AND OrderWeek='07-09';`)).recordsets;
assert(state[0][0].Mode===null&&!state[0][0].PendingCalc);assert.equal(state[1][0].detailRows,11);assert.equal(state[3][0].sourceRows,0);
await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);open=true;
const test=await new sql.Request(tx).query(`SET LOCK_TIMEOUT 1000;
DECLARE @r int,@m nvarchar(200),@owner uniqueidentifier,@leave int;
EXEC dbo.usp_NenovaStockWeekGateEnter @Action=N'FIX',@OrderYear=N'2026',@OrderWeek=N'36-01',@oResult=@r OUTPUT,@oMessage=@m OUTPUT,@ProtocolVersion=2,@OwnerToken=@owner OUTPUT,@CalcProdKey=NULL;
IF @r=0 EXEC dbo.usp_NenovaStockWeekGateLeave @Action=N'FIX',@Success=0,@ProtocolVersion=2,@OwnerToken=@owner,@oResult=@leave OUTPUT;
SELECT @r enterResult,@leave leaveResult,Mode,PendingCalc FROM NenovaStockWeekGate;`);
const t=test.recordset[0];assert(t.enterResult===0&&t.leaveResult===0&&t.Mode===null&&!t.PendingCalc);
await tx.rollback();open=false;console.log(JSON.stringify({verified:true,state,gateOnlyProbe:t,probeRolledBack:true,noShipmentFixExecuted:true}));
}finally{if(open)await tx.rollback().catch(()=>{});await p.close()}})().catch(e=>{console.error(e.code||e.name,e.message);process.exitCode=1});
