// Isolated loopback Docker fixture only. No production environment is loaded.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),sql=require('mssql');
const h=require('./test-weekday-distribution-sql.cjs');
async function main(){
 for(const key of ['DB_SERVER','DB_NAME','DB_USER','DB_PASSWORD'])if(process.env[key])throw new Error('Operational environment forbidden');
 const fixture=h.inspectFixture(),name=`NenovaEstimateFixture_${new Date().toISOString().slice(0,10).replace(/-/g,'')}_${crypto.randomBytes(4).toString('hex')}`;h.assertDbName(name);
 let master,pool;
 const config={server:'127.0.0.1',port:14339,user:'sa',password:fixture.password,options:{encrypt:false,trustServerCertificate:true},requestTimeout:60000};
 try{
  master=await new sql.ConnectionPool({...config,database:'master'}).connect();await h.query(master,`CREATE DATABASE ${h.bracket(name)}`);
  pool=await new sql.ConnectionPool({...config,database:name}).connect();await h.installSchema(pool);await h.seed(pool);
  await h.query(pool,`IF COL_LENGTH('Product','DisplayName') IS NULL ALTER TABLE Product ADD DisplayName nvarchar(200) NULL;
    UPDATE Product SET Stock=100,FlowerName=N'카네이션' WHERE ProdKey=866;
    DELETE FROM ShipmentDate; DELETE FROM ShipmentDetail; UPDATE ShipmentMaster SET isFix=0;
    INSERT OrderMaster(OrderMasterKey,OrderYear,OrderWeek,OrderYearWeek,CustKey,Manager) VALUES(2501,N'2025',N'37-01',N'202537',533,N'fixture-user');
    INSERT OrderDetail(OrderDetailKey,OrderMasterKey,CustKey,ProdKey,BoxQuantity,BunchQuantity,SteamQuantity,OutQuantity,OrderQuantity) VALUES(2501,2501,533,866,99,2970,2970,99,99);`);
  const {previewJugwang,applyJugwang}=await import('../lib/jugwangWeekdayUploadServer.js');
  const source={scope:{year:'2026',orderWeek:'37-01',custKey:533,category:'카네이션'},sourceHash:'fixture',warnings:[],rows:[{id:'sheet!3',label:'Fixture',category:'카네이션',dates:[{date:'2026-09-10',quantity:5},{date:'2026-09-13',quantity:15}]}]};
  const selections=[{id:'sheet!3',prodKey:866,unit:'박스'}],user={userId:'fixture-user',userName:'Fixture'};
  const transaction=async fn=>{const tx=new sql.Transaction(pool);await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);try{const result=await fn(h.tQuery(tx));await tx.commit();return result;}catch(e){await tx.rollback().catch(()=>{});throw e;}};
  const protectedState=async()=>{const result={};for(const table of ['OrderMaster','OrderDetail','OrderHistory','ShipmentFarm','Product','ProductStock','StockHistory','Estimate'])result[table]=(await h.query(pool,`SELECT * FROM ${table}`)).recordset;return JSON.stringify(result);};
  const before=await protectedState();
  const plan=await transaction(q=>previewJugwang(q,sql,source,selections));
  assert.equal(plan.statuses[0].status,'NEW');assert.equal(plan.statuses[0].orderQuantity,25);
  let dateWrites=0;
  await assert.rejects(()=>transaction(q=>applyJugwang(async(statement,params)=>{if(/INSERT INTO ShipmentDate/i.test(statement)&&++dateWrites===2)throw new Error('injected second date failure');return q(statement,params);},sql,plan,user)),/injected second date/);
  assert.equal((await h.query(pool,'SELECT COUNT(*) n FROM ShipmentDetail')).recordset[0].n,0);
  assert.equal(await protectedState(),before);
  const applied=await transaction(q=>applyJugwang(q,sql,plan,user));assert.equal(applied.appliedCount,1);assert.equal(applied.orderPreserved,true);
  assert.equal(await protectedState(),before);
  const again=await transaction(q=>applyJugwang(q,sql,plan,user));assert.equal(again.operationId,applied.operationId);
  const identical=await transaction(q=>previewJugwang(q,sql,source,selections));assert.equal(identical.statuses[0].status,'UNCHANGED');
  assert.equal((await transaction(q=>applyJugwang(q,sql,identical,user))).appliedCount,0);
  const conflict=structuredClone(source);conflict.rows[0].dates[0].quantity=6;
  await assert.rejects(()=>transaction(q=>previewJugwang(q,sql,conflict,selections)),/기존 분배/);
  await h.query(pool,'UPDATE OrderDetail SET OutQuantity=24 WHERE OrderDetailKey=3701');
  await assert.rejects(()=>transaction(q=>applyJugwang(q,sql,identical,user)),/주문 또는 품목/);
  await h.query(pool,'UPDATE OrderDetail SET OutQuantity=25 WHERE OrderDetailKey=3701');
  assert.equal(await protectedState(),before);
  const dates=(await h.query(pool,'SELECT ShipmentQuantity FROM ShipmentDate ORDER BY ShipmentDtm')).recordset;
  assert.deepEqual(dates.map(r=>Number(r.ShipmentQuantity)),[5,15]);
  assert.equal((await h.query(pool,'SELECT isFix FROM ShipmentDetail')).recordset[0].isFix,false);
  console.log('PASS real SQL: new dates, unchanged orders/cross-year/stock/farm/estimate, identical retry/no-op, conflict and stale rollback, no auto-confirm');
 }finally{await pool?.close();if(master){await h.query(master,`ALTER DATABASE ${h.bracket(name)} SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE ${h.bracket(name)}`);await master.close();}}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
