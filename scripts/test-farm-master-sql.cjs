// Fixed loopback disposable database only. No app env, production URL or overrides.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process'),sql=require('mssql');
(async()=>{
 assert.equal(process.argv.length,2,'No database/host overrides allowed');
 const container='nenova-estimate-sql-test-20260826',inspect=spawnSync('docker',['inspect',container],{encoding:'utf8',windowsHide:true});assert.equal(inspect.status,0,'approved container unavailable');
 const info=JSON.parse(inspect.stdout)[0];assert.equal(info.Name,'/'+container);assert.equal(info.State.Running,true);assert.match(info.Config.Image,/^mcr\.microsoft\.com\/mssql\/server:2022(?:-|$)/);assert.equal(info.Mounts.length,0);assert.equal((info.HostConfig.Binds||[]).length,0);
 const bindings=info.HostConfig.PortBindings;assert.deepEqual(Object.keys(bindings),['1433/tcp']);assert.equal(bindings['1433/tcp'].length,1);assert.equal(bindings['1433/tcp'][0].HostIp,'127.0.0.1');assert.equal(bindings['1433/tcp'][0].HostPort,'14339');
 const password=info.Config.Env.find(v=>v.startsWith('MSSQL_SA_PASSWORD='))?.slice('MSSQL_SA_PASSWORD='.length);assert(password);
 const config={server:'127.0.0.1',port:14339,user:'sa',password,options:{encrypt:false,trustServerCertificate:true},requestTimeout:20000};
 const name='NenovaFarmFixture_'+crypto.randomBytes(8).toString('hex');assert.match(name,/^NenovaFarmFixture_[a-f0-9]{16}$/);
 let admin,pool,created=false;
 try{
  admin=await new sql.ConnectionPool({...config,database:'master'}).connect();await admin.request().query(`CREATE DATABASE [${name}]`);created=true;
  pool=await new sql.ConnectionPool({...config,database:name}).connect();
  await pool.request().query(`CREATE TABLE Country(CounKey int PRIMARY KEY,CounName nvarchar(100),isDeleted bit);INSERT Country VALUES(1,N'콜롬비아',0),(2,N'에콰도르',0),(3,N'삭제국가',1);
   CREATE TABLE Farm(FarmKey int IDENTITY PRIMARY KEY,FarmCode nvarchar(20),FarmName nvarchar(100),CounKey int,isDeleted bit,Descr nvarchar(200),CreateID nvarchar(50),CreateDtm datetime,LastUpdateID nvarchar(50),LastUpdateDtm datetime);
   CREATE TABLE ProtectedLedger(OrderYear nvarchar(4),OrderWeek nvarchar(10),Amount decimal(18,2));INSERT ProtectedLedger VALUES('2025','46-02',123),('2026','46-02',456);`);
  const {registerFarmMaster}=await import('../lib/farmMasterRegistration.js');
  const transact=async(body,{failAfterInsert=false}={})=>{const t=new sql.Transaction(pool);await t.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);try{await new sql.Request(t).query('SET XACT_ABORT ON;SET LOCK_TIMEOUT 10000;');const result=await registerFarmMaster(async(q,params)=>{const r=new sql.Request(t);for(const [k,p]of Object.entries(params||{}))r.input(k,p.type,p.value);const value=await r.query(q);if(failAfterInsert&&q.startsWith('INSERT'))throw Error('FIXTURE_READBACK_FAILURE');return value;},sql,body,'fixture');await t.commit();return result;}catch(e){await t.rollback().catch(()=>{});throw e;}};
  const body={farmName:'Demo Balverde',counKey:1,confirmed:true};
  const pair=await Promise.all([transact(body),transact(body)]);assert.equal(pair.filter(r=>r.created).length,1);assert.equal(pair[0].farm.FarmKey,pair[1].farm.FarmKey);
  await assert.rejects(transact({...body,farmName:'CI FLORES DEMO BALVERDE SAS'}),e=>e.status===409);
  await assert.rejects(transact({...body,counKey:2}),e=>e.status===409);
  await assert.rejects(transact({...body,farmName:'Deleted country',counKey:3}));
  await assert.rejects(transact({...body,farmName:'Rollback Demo'},{failAfterInsert:true}),/FIXTURE_READBACK_FAILURE/);
  assert.equal((await pool.request().query("SELECT COUNT(*) n FROM Farm WHERE FarmName=N'Rollback Demo'")).recordset[0].n,0);
  const native=(await pool.request().query('SELECT FarmKey,FarmCode,FarmName,CounKey,isDeleted,Descr,CreateID,CreateDtm,LastUpdateID,LastUpdateDtm FROM Farm WHERE isDeleted=0 ORDER BY FarmKey')).recordset;assert.equal(native.length,1);assert.equal(native[0].FarmName,body.farmName);assert.equal(native[0].CreateID,'fixture');
  assert.deepEqual((await pool.request().query('SELECT OrderYear,OrderWeek,Amount FROM ProtectedLedger ORDER BY OrderYear')).recordset,[{OrderYear:'2025',OrderWeek:'46-02',Amount:123},{OrderYear:'2026',OrderWeek:'46-02',Amount:456}]);
  console.log(JSON.stringify({pass:true,isolatedSql:true,concurrentDuplicate:'one row',rollback:true,nativeReadback:true,crossYearSentinels:'unchanged',productionWrites:0}));
 }finally{await pool?.close();if(created){assert.match(name,/^NenovaFarmFixture_[a-f0-9]{16}$/);await admin.request().query(`ALTER DATABASE [${name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${name}]`);}await admin?.close();}
})().catch(e=>{console.error('ISOLATED_FARM_TEST_FAILED',e.code||e.message);process.exitCode=1;});
