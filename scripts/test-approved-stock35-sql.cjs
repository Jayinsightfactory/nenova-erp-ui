// LocalDB only: no .env or remote overrides. Drops only its own exact random fixture.
const assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
for(const key of ['DB_SERVER','DB_NAME','DB_USER','DB_PASSWORD'])assert(!process.env[key],'Operating credentials forbidden');
const sql=require('mssql/msnodesqlv8'),{fixture,scope}=require('../__tests__/approvedStock35Repair.test.cjs');
const name='NenovaApproved35Fixture_'+crypto.randomBytes(8).toString('hex');
const config=db=>({connectionString:`Driver={ODBC Driver 18 for SQL Server};Server=(localdb)\\NenovaErpFixture;Database=${db};Trusted_Connection=Yes;TrustServerCertificate=Yes;`,pool:{min:0,max:1},requestTimeout:60000});
(async()=>{
 const h=await import('../lib/approvedStock35Repair.mjs'),{runOrderStockCalculationBatch}=await import('../lib/orderStockCalculation.js');
 const master=await new sql.ConnectionPool(config('master')).connect();let pool,created=false;
 try{
  await master.request().query(`CREATE DATABASE [${name}];ALTER DATABASE [${name}] SET COMPATIBILITY_LEVEL=130;`);created=true;
  pool=await new sql.ConnectionPool(config(name)).connect();
  await pool.request().batch(`
   CREATE TABLE Product(ProdKey int PRIMARY KEY,ProdName nvarchar(100),OutUnit nvarchar(20),BunchOf1Box float,isDeleted bit,Stock float);
   CREATE TABLE StockMaster(StockKey int PRIMARY KEY,OrderYear nvarchar(20),OrderWeek nvarchar(20),OrderYearWeek nvarchar(20),Descr nvarchar(100),CreateID nvarchar(20),CreateDtm datetime,LastUpdateID nvarchar(20),LastUpdateDtm datetime);
   CREATE TABLE ProductStock(StockKey int,ProdKey int,Stock float,PRIMARY KEY(StockKey,ProdKey));
   CREATE TABLE StockHistory(StockHistoryKey int IDENTITY PRIMARY KEY,ChangeDtm datetime,OrderYear nvarchar(20),OrderWeek nvarchar(20),ChangeID nvarchar(20),ChangeType nvarchar(30),ColumName nvarchar(30),BeforeValue float,AfterValue float,Descr nvarchar(1000),ProdKey int);
   CREATE TABLE CodeInfo(Category nvarchar(30),Descr nvarchar(30));INSERT CodeInfo VALUES(N'StockType',N'재고조정');
   CREATE TABLE WarehouseInput(OrderYear nvarchar(20),OrderWeek nvarchar(20),ProdKey int,OutQuantity float);
   CREATE TABLE ShipmentInput(OrderYear nvarchar(20),OrderWeek nvarchar(20),ProdKey int,OutQuantity float,DetailFix bit);
   CREATE TABLE NenovaStockWeekGate(GateKey nvarchar(1) PRIMARY KEY,ProtocolVersion int,Mode nvarchar(20),LockedAt datetime,Action nvarchar(20),OrderYear nvarchar(20),OrderWeek nvarchar(20),OwnerSessionID int,OwnerToken uniqueidentifier,PendingCalc bit,CalcProdKey int);
   INSERT NenovaStockWeekGate(GateKey,ProtocolVersion,PendingCalc) VALUES(N'1',2,0);
   CREATE TABLE MoneySentinel(Amount int);INSERT MoneySentinel VALUES(123456);`);
  await pool.request().batch('CREATE VIEW ViewWarehouse AS SELECT * FROM WarehouseInput');
  await pool.request().batch('CREATE VIEW ViewShipment AS SELECT * FROM ShipmentInput');
  const data=fixture();
  for(const p of data.products)await pool.request().input('pk',p.ProdKey).input('name',p.ProdName).input('stock',p.Stock).query("INSERT Product VALUES(@pk,@name,N'박스',30,0,@stock)");
  for(const m of data.masters)await pool.request().input('key',m.StockKey).input('yr',m.OrderYear).input('wk',m.OrderWeek).input('ywk',m.OrderYearWeek).query('INSERT StockMaster(StockKey,OrderYear,OrderWeek,OrderYearWeek) VALUES(@key,@yr,@wk,@ywk)');
  for(const s of data.stocks)await pool.request().input('sk',s.StockKey).input('pk',s.ProdKey).input('stock',s.Stock).query('INSERT ProductStock VALUES(@sk,@pk,@stock)');
  for(const r of data.incoming)await pool.request().input('yr',r.OrderYear).input('wk',r.OrderWeek).input('pk',r.ProdKey).input('qty',r.OutQuantity).query('INSERT WarehouseInput VALUES(@yr,@wk,@pk,@qty)');
  for(const r of data.adjustments)await pool.request().input('yr',r.OrderYear).input('wk',r.OrderWeek).input('pk',r.ProdKey).input('b',r.BeforeValue).input('a',r.AfterValue).query("INSERT StockHistory(ChangeDtm,OrderYear,OrderWeek,ChangeID,ChangeType,ColumName,BeforeValue,AfterValue,Descr,ProdKey) VALUES(GETDATE(),@yr,@wk,N'old',N'재고조정',N'수량',@b,@a,N'',@pk)");
  const native=fs.readFileSync('__tests__/fixtures/orderStockCalculationNative.sql','utf8').replace('SELECT OrderYear, OrderWeek FROM #CalculationList;','SELECT OrderYear, OrderWeek FROM #CalculationList ORDER BY OrderYear,OrderWeek;');
  for(const batch of native.split(/^GO\s*$/mi).filter(s=>s.trim()))await pool.request().batch(batch);
  // Same isolated readiness stub used by the existing native SQL fixture suite.
  await pool.request().batch('CREATE PROCEDURE dbo.usp_NenovaStockWeekGateCapability AS SELECT 2 ProtocolVersion,CAST(1 AS bit) IsReady;');
  const q=(tx)=>(text,params={})=>{const r=tx?new sql.Request(tx):pool.request();for(const[k,v]of Object.entries(params))r.input(k,v.type,v.value);return r.query(text);};
  const readState=async query=>{
   const get=async text=>(await query(text)).recordset;
   return {masters:await get('SELECT StockKey,OrderYear,OrderWeek,OrderYearWeek FROM StockMaster ORDER BY StockKey'),stocks:await get('SELECT * FROM ProductStock ORDER BY StockKey,ProdKey'),products:await get('SELECT * FROM Product ORDER BY ProdKey'),incoming:await get('SELECT * FROM ViewWarehouse ORDER BY ProdKey,OrderWeek'),outgoing:await get('SELECT OrderYear,OrderWeek,ProdKey,OutQuantity FROM ViewShipment'),adjustments:await get("SELECT sh.*,(SELECT COUNT(*) FROM CodeInfo ci WHERE ci.Category=N'StockType' AND ci.Descr=sh.ChangeType) TypeMatches FROM StockHistory sh ORDER BY StockHistoryKey"),protected:{money:await get('SELECT * FROM MoneySentinel')},procedureHash:crypto.createHash('sha256').update((await get("SELECT OBJECT_DEFINITION(OBJECT_ID(N'dbo.usp_StockCalculation')) Definition"))[0].Definition).digest('hex')};
  };
  const before=await readState(q()),hash=h.stockRepairDigest(before);
  for(const action of ['native-failure','rollback','commit']){
   const tx=new sql.Transaction(pool);let rolled=false;tx.on('rollback',()=>{rolled=true;});await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
   try{
    const result=await h.executeApprovedStock35Repair({tQuery:q(tx),types:sql,scope,expectedHash:hash,actor:'fixture',readState,
     runNative:async({tQuery})=>{await runOrderStockCalculationBatch({withTransactionFn:fn=>fn(tQuery),types:sql,orderYear:'2026',orderWeek:'35-02',uid:'fixture',prodKeys:scope.prodKeys});if(action==='native-failure')throw Error('injected after-native failure');}});
    if(action==='commit'){await tx.commit();assert.deepEqual(result.verification.live.map(r=>r.stock),[1,5,1]);}
    else await tx.rollback();
   }catch(error){if(!rolled)await tx.rollback();if(action!=='native-failure')throw error;assert.match(error.message,/injected/);}
   const after=await readState(q());
   if(action!=='commit')assert.equal(h.stockRepairDigest(after),hash,'complete rollback readback');
   else{assert.throws(()=>h.planApprovedStock35Repair(after,scope),/ALREADY/);assert(after.stocks.filter(r=>r.StockKey===3).every(r=>r.Stock===0));}
  }
  console.log('PASS isolated SQL130: actual gate/native calculator, rollback after partial native, rehearsal readback, exact3 audit/live+1, 2025 immutable/2027+1, protected money, idempotency');
 }finally{
  if(pool)await pool.close();if(created){assert.match(name,/^NenovaApproved35Fixture_[a-f0-9]{16}$/);await master.request().query(`ALTER DATABASE [${name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;DROP DATABASE [${name}]`);}await master.close();
 }
})().catch(e=>{console.error(e.code||e.name,e.message);process.exitCode=1;});
