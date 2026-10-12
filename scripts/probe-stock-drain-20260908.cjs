const sql=require('mssql');
(async()=>{const p=await sql.connect({server:process.env.DB_SERVER,port:Number(process.env.DB_PORT||1433),database:process.env.DB_NAME,user:process.env.DB_USER,password:process.env.DB_PASSWORD,options:{encrypt:false,trustServerCertificate:true},requestTimeout:15000});const tx=new sql.Transaction(p);let open=false;try{
await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);open=true;
const r=await new sql.Request(tx).query(`SET LOCK_TIMEOUT 1000;
SELECT GateKey,Mode,Action,OrderYear,OrderWeek,LockedAt,OwnerSessionID,PendingCalc FROM dbo.NenovaStockWeekGate WITH(UPDLOCK,HOLDLOCK,NOWAIT);
SELECT COUNT_BIG(*) stockMasters FROM dbo.StockMaster WITH(TABLOCKX,HOLDLOCK,NOWAIT);
SELECT COUNT_BIG(*) stockRows FROM dbo.ProductStock WITH(TABLOCKX,HOLDLOCK,NOWAIT);
SELECT COUNT(*) sourceRows FROM dbo.StockMaster WHERE OrderYear='2026' AND OrderWeek='07-09';
SELECT StockKey,OrderYear,OrderWeek,OrderYearWeek FROM StockMaster WHERE OrderYearWeek>='20263602' ORDER BY OrderYearWeek,StockKey;
SELECT sm.OrderYear,sm.OrderWeek,ps.ProdKey,ps.Stock FROM dbo.StockMaster sm JOIN dbo.ProductStock ps ON ps.StockKey=sm.StockKey WHERE sm.OrderYear='2026' AND sm.OrderWeek IN ('36-02','37-01') AND ps.ProdKey IN (3355,2829,2565,3354,3356,3357,3353) ORDER BY sm.OrderWeek,ps.ProdKey;
`);await tx.rollback();open=false;console.log(JSON.stringify({exclusiveLockProbe:true,rolledBack:true,results:r.recordsets}));
}finally{if(open)await tx.rollback().catch(()=>{});await p.close()}})().catch(e=>{console.error(e.code,e.message);process.exitCode=1});
