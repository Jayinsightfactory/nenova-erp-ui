// Only the existing isolated Docker fixture; never reads application environment files.
const assert=require('node:assert/strict'),{execFileSync}=require('node:child_process'),{randomBytes}=require('node:crypto'),sql=require('mssql');
const CONTAINER='nenova-estimate-sql-test-20260826';
const info=JSON.parse(execFileSync('docker',['inspect',CONTAINER],{encoding:'utf8',windowsHide:true}))[0];
assert.equal(info.Name,`/${CONTAINER}`);assert.equal(info.State.Running,true);assert.match(info.Config.Image,/^mcr\.microsoft\.com\/mssql\/server:2022/);
assert.equal(info.Mounts.length,0);assert.ok(info.HostConfig.PortBindings['1433/tcp'].some(p=>p.HostIp==='127.0.0.1'&&p.HostPort==='14339'));
const password=info.Config.Env.find(v=>v.startsWith('MSSQL_SA_PASSWORD=')).slice('MSSQL_SA_PASSWORD='.length);
const database=`NenovaProductFixture_${randomBytes(8).toString('hex')}`;
assert.match(database,/^NenovaProductFixture_[a-f0-9]{16}$/);
const config={server:'127.0.0.1',port:14339,user:'sa',password,options:{encrypt:false,trustServerCertificate:true},database:'master'};
(async()=>{
 const master=await new sql.ConnectionPool(config).connect();let pool;
 try{
  await master.request().query(`CREATE DATABASE [${database}]`);
  pool=await new sql.ConnectionPool({...config,database}).connect();
  await pool.request().query(`CREATE TABLE Product(ProdKey int IDENTITY PRIMARY KEY,ProdCode nvarchar(100),ProdName nvarchar(200),DisplayName nvarchar(200),FlowerName nvarchar(100),CounName nvarchar(100),CountryFlower nvarchar(200),Cost float,OutUnit nvarchar(20),EstUnit nvarchar(20),BunchOf1Box float,SteamOf1Bunch float,SteamOf1Box float,BoxWeight decimal(10,3),BoxCBM decimal(10,3),TariffRate decimal(10,4),Stock float,ProdGroup nvarchar(100),Descr nvarchar(max),isDeleted bit,CreateID nvarchar(50),CreateDtm datetime,LastUpdateID nvarchar(50),LastUpdateDtm datetime);
  CREATE TABLE Country(CounName nvarchar(100),isSelectFlower bit,isDeleted bit);
  CREATE TABLE Flower(FlowerName nvarchar(100),isDeleted bit);
  INSERT Country VALUES(N'중국',1,0),(N'콜롬비아',0,0);
  INSERT Flower VALUES(N'장미',0),(N'수국',0);
  CREATE TABLE SystemActionLog(Actor nvarchar(100),ActionType nvarchar(50),Method nvarchar(10),Endpoint nvarchar(300),AffectedTable nvarchar(100),AffectedCount int,Payload nvarchar(max),Result nvarchar(20),ResultDesc nvarchar(1000),RiskLevel nvarchar(20));
  CREATE TABLE ProtectedLedger(OrderYear int,OrderWeek nvarchar(10),ProdKey int,OrderQuantity float,ShipmentQuantity float,Amount float,Vat float,isFix bit,ShipmentDateQty float,ShipmentFarmQty float,Stock float,Estimate float,WebProfitReport float);
  INSERT ProtectedLedger VALUES(2025,'42-01',1,10,10,90,10,1,10,10,7,100,100),(2026,'42-01',1,20,20,180,20,1,20,20,9,200,200);`);
  const {saveProductMaster}=await import('../lib/productMasterSave.js');
  const {productMasterSnapshot}=await import('../lib/productMasterPolicy.js');
  const read=async()=> (await pool.request().query('SELECT * FROM Product ORDER BY ProdKey')).recordset;
  const sentinel=JSON.stringify((await pool.request().query('SELECT * FROM ProtectedLedger')).recordset);
  async function save(body,mode='ok'){
   const tx=new sql.Transaction(pool);await tx.begin();
   const q=async(text,params={})=>{
    if(mode==='audit'&&text.startsWith('INSERT INTO SystemActionLog'))throw Error('fixture audit failure');
    const request=new sql.Request(tx);Object.entries(params).forEach(([k,v])=>request.input(k,v.type,v.value));
    const result=await request.query(text);
    if(mode==='readback'&&text.startsWith('SELECT')&&text.includes('FROM Product WHERE'))result.recordset[0].Stock=999;
    return result;
   };
   try {const out=await saveProductMaster(q,sql,body,'fixture');await tx.commit();return out;}
   catch(e){await tx.rollback();throw e;}
  }
  const created=await save({values:{ProdName:'fixture',CounName:'콜롬비아',FlowerName:'장미',OutUnit:'박스',EstUnit:'단',BunchOf1Box:15,SteamOf1Bunch:20,SteamOf1Box:0}});
  assert.equal(created.CountryFlower,'콜롬비아장미');assert.equal(created.SteamOf1Box,0);
  let current=(await read())[0];assert.equal(current.CreateID,'fixture');assert.equal(current.LastUpdateID,'fixture');
  for(const mode of ['audit','readback']){
   const before=JSON.stringify(await read());
   await assert.rejects(()=>save({prodKey:current.ProdKey,expected:productMasterSnapshot(current),values:{ProdName:'rollback'}},mode));
   assert.equal(JSON.stringify(await read()),before);
  }
  await assert.rejects(()=>save({prodKey:current.ProdKey,expected:{...productMasterSnapshot(current),Cost:999},values:{ProdName:'stale'}}),/변경/);
  await assert.rejects(()=>save({prodKey:current.ProdKey,expected:productMasterSnapshot(current),values:{CounName:'invalid'}}),/기준정보/);
  await assert.rejects(()=>save({prodKey:current.ProdKey,expected:productMasterSnapshot(current),values:{OutUnit:'단'}}),/변경 확인/);
  await save({prodKey:current.ProdKey,expected:productMasterSnapshot(current),values:{ProdName:'changed',BoxWeight:'0.125'}});
  current=(await read())[0];assert.equal(current.SteamOf1Box,0);assert.equal(current.BoxWeight,0.125);
  await save({prodKey:current.ProdKey,expected:productMasterSnapshot(current),values:{CounName:'중국'}});
  current=(await read())[0];assert.equal(current.CountryFlower,'중국');assert.equal(current.SteamOf1Box,0);
  await save({prodKey:current.ProdKey,expected:productMasterSnapshot(current),values:{BunchOf1Box:12,SteamOf1Box:null}});
  current=(await read())[0];assert.equal(current.SteamOf1Box,null);
  await save({prodKey:current.ProdKey,expected:productMasterSnapshot(current),values:{DisplayName:'웹 표시'}});
  current=(await read())[0];assert.equal(current.SteamOf1Box,null);
  assert.equal(JSON.stringify((await pool.request().query('SELECT * FROM ProtectedLedger')).recordset),sentinel);
  console.log('Product master actual SQL: create/edit/readback, country grouping, independent zero/null, stale/unit guards, audit/readback rollback, cross-year ledger preservation PASS');
 } finally{if(pool)await pool.close();await master.request().query(`DROP DATABASE [${database}]`);await master.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
