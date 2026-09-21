// Disposable localhost SQL only. No production credential or production SQL writes.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const assert=require('node:assert/strict'),sql=require('mssql');
const root=path.resolve(__dirname,'..');
const container='nenova-estimate-sql-test-20260826';
const dbName='NenovaEstimateFixture_freight_'+crypto.randomBytes(6).toString('hex');
const user={userId:'admin'};
const info=JSON.parse(spawnSync('docker',['inspect',container],{encoding:'utf8',windowsHide:true}).stdout)[0];
assert.equal(info.Name,'/'+container);assert.equal(info.State.Running,true);
assert.match(info.Config.Image,/^mcr\.microsoft\.com\/mssql\/server:2022/);
assert.equal(info.Mounts.length,0);
assert(info.HostConfig.PortBindings['1433/tcp'].some(b=>b.HostIp==='127.0.0.1'&&b.HostPort==='14339'));
const password=info.Config.Env.find(v=>v.startsWith('MSSQL_SA_PASSWORD=')).slice('MSSQL_SA_PASSWORD='.length);
const config={server:'127.0.0.1',port:14339,user:'sa',password,requestTimeout:60000,options:{encrypt:false,trustServerCertificate:true}};
function q(pool,statement,params={}) {const r=new sql.Request(pool);for(const [key,p] of Object.entries(params))r.input(key,p.type,p.value);return r.query(statement);}
async function tx(pool,fn) {const t=new sql.Transaction(pool);await t.begin();try{const value=await fn((s,p)=>q(t,s,p));await t.commit();return value;}catch(e){await t.rollback().catch(()=>{});throw e;}}
const base=()=>({year:'2026',parentWeek:'38',custKey:1,rows:[{weekShort:'38-01',prodKey:1,qty:61,cost:3000,shipmentDate:'2026-09-19',combined:true}]});
const tables=['OrderMaster','OrderDetail','ShipmentMaster','ShipmentDetail','ShipmentDate','ShipmentHistory','Product','ProductStock','StockHistory','Estimate','SystemActionLog'];
async function snapshot(pool){const result={};for(const table of tables)result[table]=(await q(pool,`SELECT * FROM dbo.[${table}] ORDER BY 1`)).recordset;return result;}
async function main(){let master,pool;try{
  master=await new sql.ConnectionPool({...config,database:'master'}).connect();
  assert.match(dbName,/^NenovaEstimateFixture_freight_[a-f0-9]{12}$/);
  await q(master,`CREATE DATABASE [${dbName}]`);
  pool=await new sql.ConnectionPool({...config,database:dbName}).connect();
  for(const file of ['__tests__/fixtures/estimateDirectionalSchema.sql','__tests__/fixtures/estimateOverflowSchema.sql']) {
    for(const batch of fs.readFileSync(path.join(root,file),'utf8').split(/^\s*GO\s*;?\s*$/gim).filter(x=>x.trim()))await q(pool,batch);
  }
  const native=fs.readFileSync(path.join(root,'docs/migrations/backup_usp_StockCalculation_2026-08-23_before_stock_week_gate.sql'),'utf8').replace(/CREATE\s+PROCEDURE\s+\[dbo\]\.\[usp_StockCalculation\]/i,'CREATE PROCEDURE dbo.usp_StockCalculation_Reference');
  for(const batch of native.split(/^\s*GO\s*;?\s*$/gim).filter(x=>x.trim()))await q(pool,batch);
  for(const table of [...tables,'WarehouseDetail','WarehouseMaster','OrderHistory','ShipmentFarm','Country','PeriodDay','Customer','UserInfo']) await q(pool,`DELETE FROM dbo.[${table}]`);
  await q(pool,`INSERT UserInfo(UserID,UserName) VALUES(N'admin',N'Fixture');
    INSERT Customer(CustKey,CustName,Manager) VALUES(1,N'Target',N'admin'),(2,N'Other',N'admin');
    INSERT Country(CounName) VALUES(N'국내');
    INSERT Product(ProdKey,ProdName,CountryFlower,CounName,FlowerName,OutUnit,EstUnit,BunchOf1Box,SteamOf1Bunch,SteamOf1Box,Cost,Stock)
      VALUES(1,N'카네이션 운송료',N'국내왁스',N'국내',N'왁스',N'박스',N'박스',0,0,0,3000,59),
      (2,N'루스커스 운송료',N'국내왁스',N'국내',N'왁스',N'박스',N'박스',0,0,0,3000,100);
    INSERT PeriodDay(OrderYearWeek,WeekDay,BaseYmd) VALUES(N'202638',4,'2026-09-17'),(N'202638',6,'2026-09-19');
    INSERT OrderMaster(OrderMasterKey,OrderYear,OrderWeek,OrderYearWeek,CustKey,Manager) VALUES(1,N'2026',N'38-01',N'202638',1,N'admin'),(2,N'2026',N'38-01',N'202638',2,N'admin'),(25,N'2025',N'38-01',N'202538',1,N'admin');
    INSERT OrderDetail(OrderDetailKey,OrderMasterKey,ProdKey,BoxQuantity,OutQuantity,OrderQuantity) VALUES(1,1,1,31,31,31),(2,2,1,10,10,10),(25,25,1,77,77,77);
    INSERT ShipmentMaster(ShipmentKey,OrderYear,OrderWeek,OrderYearWeek,CustKey,isFix) VALUES(1,N'2026',N'38-01',N'202638',1,1),(2,N'2026',N'38-01',N'202638',2,1),(25,N'2025',N'38-01',N'202538',1,1);
    INSERT ShipmentDetail(SdetailKey,ShipmentKey,CustKey,ProdKey,OutQuantity,EstQuantity,BoxQuantity,BunchQuantity,SteamQuantity,Cost,Amount,Vat,ShipmentDtm,isFix)
      VALUES(1,1,1,1,31,31,31,0,0,3000,84545,8455,'2026-09-17',1),(2,2,2,1,10,10,10,0,0,3000,27273,2727,'2026-09-17',1),(25,25,1,1,77,77,77,0,0,3000,210000,21000,'2025-09-17',1);
    INSERT ShipmentDate(SdetailKey,ShipmentDtm,ShipmentQuantity,EstQuantity,Cost,Amount,Vat)
      SELECT SdetailKey,ShipmentDtm,OutQuantity,EstQuantity,Cost,Amount,Vat FROM ShipmentDetail;
    INSERT StockMaster(StockKey,OrderYear,OrderWeek,OrderYearWeek) VALUES(37,N'2026',N'37-02',N'20263702'),(38,N'2026',N'38-01',N'20263801'),(39,N'2026',N'39-01',N'20263901');
    INSERT ProductStock(StockKey,ProdKey,Stock) VALUES(37,1,100),(38,1,59),(39,1,59),(37,2,100),(38,2,100),(39,2,100);
    UPDATE FixtureNativeCalcControl SET FailNext=0,FailureMessage=N'forced failure' WHERE ControlKey=1;`);
  const {executeFreight,readFreightReceipt}=await import('../lib/estimateFreightAtomic.js');
  const run=body=>tx(pool,tQ=>executeFreight(tQ,sql,body,user));
  const before=await snapshot(pool);
  const preview=await run({...base(),mode:'preview'});
  assert.deepEqual(await snapshot(pool),before,'read-only preview must preserve all ledgers');
  assert.equal(preview.rows[0].shipmentDate,'2026-09-17');
  assert.equal(preview.rows[0].oldQty,31);
  const apply={...base(),mode:'apply',confirmed:true,operationId:crypto.randomUUID(),planHash:preview.planHash};
  await q(pool,'UPDATE FixtureNativeCalcControl SET FailNext=1');
  await assert.rejects(()=>run(apply));
  assert.deepEqual(await snapshot(pool),before,'native failure must roll back existing freight and all history');
  await q(pool,'UPDATE FixtureNativeCalcControl SET FailNext=0');
  const saved=await run(apply);assert(saved.verified);
  const after=await snapshot(pool);
  assert.equal(after.ShipmentDetail.find(r=>r.SdetailKey===1).OutQuantity,61);
  assert.equal(after.OrderDetail.find(r=>r.OrderDetailKey===1).OutQuantity,31);
  assert.deepEqual(after.ShipmentDetail.find(r=>r.SdetailKey===2),before.ShipmentDetail.find(r=>r.SdetailKey===2));
  assert.deepEqual(after.ShipmentDetail.find(r=>r.SdetailKey===25),before.ShipmentDetail.find(r=>r.SdetailKey===25));
  assert.equal(after.Product.find(r=>r.ProdKey===1).Stock,29);
  assert.equal((await run(apply)).replayed,true);
  assert.deepEqual(await snapshot(pool),after,'retry does not double count');
  assert((await readFreightReceipt((s,p)=>q(pool,s,p),sql,null,'admin',apply.operationId)).verified);
  assert.equal(await readFreightReceipt((s,p)=>q(pool,s,p),sql,null,'other',apply.operationId),null);
  const mixed=base();mixed.rows=[{...mixed.rows[0],qty:62},{weekShort:'38-01',prodKey:2,qty:5,cost:1500,shipmentDate:'2026-09-17'}];
  const mixedPreview=await run({...mixed,mode:'preview'});
  const mixedApply={...mixed,mode:'apply',confirmed:true,operationId:crypto.randomUUID(),planHash:mixedPreview.planHash};
  await q(pool,`CREATE TRIGGER dbo.FreightFixtureFail ON dbo.ShipmentDetail AFTER INSERT AS IF EXISTS(SELECT 1 FROM inserted WHERE ProdKey=2) THROW 51001,'forced second row failure',1;`);
  await assert.rejects(()=>run(mixedApply));assert.deepEqual(await snapshot(pool),after,'second row failure must undo first row');
  await q(pool,'DROP TRIGGER dbo.FreightFixtureFail');
  assert((await run(mixedApply)).verified);
  const final=await snapshot(pool);
  assert.equal(final.OrderDetail.filter(r=>r.ProdKey===2).length,1);
  assert.equal(final.ShipmentDetail.filter(r=>r.ProdKey===2).length,1);
  assert.equal(final.ShipmentDetail.find(r=>r.ProdKey===2).OutQuantity,5);
  assert.equal(final.ProductStock.find(r=>r.ProdKey===2&&r.StockKey===39).Stock,95);
  await assert.rejects(()=>run({...mixedApply,operationId:crypto.randomUUID()}),/미리보기/);
  const more=base();more.rows[0].qty=63;
  const morePreview=await run({...more,mode:'preview'});
  const moreApply={...more,mode:'apply',confirmed:true,operationId:crypto.randomUUID(),planHash:morePreview.planHash};
  await q(pool,`CREATE TRIGGER dbo.FreightFixtureCorrupt ON dbo.ShipmentDate AFTER UPDATE AS UPDATE d SET Cost=1 FROM dbo.ShipmentDate d JOIN inserted i ON i.SdateKey=d.SdateKey;`);
  await assert.rejects(()=>run(moreApply),/전산 주문/);
  assert.deepEqual(await snapshot(pool),final,'post-write mismatch rolls back all tables');
  await q(pool,'DROP TRIGGER dbo.FreightFixtureCorrupt');
  const tooMuch=base();tooMuch.rows[0].qty=1000;
  await assert.rejects(()=>run({...tooMuch,mode:'preview'}),/부족/);
  assert.deepEqual(await snapshot(pool),final);
  await q(pool,`INSERT ShipmentDate(SdetailKey,ShipmentDtm,ShipmentQuantity,EstQuantity,Cost,Amount,Vat) VALUES(1,'2026-09-19',1,1,3000,0,0)`);
  await assert.rejects(()=>run({...more,mode:'preview'}),/여러 출고행/);
  console.log('PASS freight SQL: existing 31→61, date preserved, order preserved, new positive order/date, native/second-row rollback, UUID replay, other customer/year preserved, stale preview blocked');
}finally{
  await pool?.close();
  if(master){assert.match(dbName,/^NenovaEstimateFixture_freight_[a-f0-9]{12}$/);await q(master,`IF DB_ID(N'${dbName}') IS NOT NULL BEGIN ALTER DATABASE [${dbName}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${dbName}]; END`);await master.close();}
}}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
