// Isolated loopback MSSQL: read-only workspace customer scope; no operational environment.
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const sql=require('mssql');
const fixture=require('./test-weekday-distribution-sql.cjs');
async function main(){
 for(const key of ['DB_SERVER','DB_PORT','DB_NAME','DB_USER','DB_PASSWORD']) assert.ok(!process.env[key],'Operational environment forbidden');
 const approved=fixture.inspectFixture();
 const name=`NenovaEstimateFixture_${new Date().toISOString().slice(0,10).replace(/-/g,'')}_${crypto.randomBytes(4).toString('hex')}`;
 fixture.assertDbName(name);
 const config={server:'127.0.0.1',port:14339,user:'sa',password:approved.password,options:{encrypt:false,trustServerCertificate:true}};
 let master,pool;
 try{
  master=await new sql.ConnectionPool({...config,database:'master'}).connect();
  await fixture.query(master,`CREATE DATABASE ${fixture.bracket(name)}`);
  pool=await new sql.ConnectionPool({...config,database:name}).connect();
  await fixture.installSchema(pool);await fixture.seed(pool);
  const q=(statement,params)=>fixture.query(pool,statement,params);

  const {DISTRIBUTION_DATE_INDEX_SQL,DISTRIBUTION_INLINE_DATES_SQL}=await import('../lib/shipmentDistributionDateIndex.js');
  const read=async year=>(await q(DISTRIBUTION_DATE_INDEX_SQL,{year:{type:sql.NVarChar,value:year},week:{type:sql.NVarChar,value:'37-01'}})).recordset;
  await q(`UPDATE ShipmentDetail SET CustKey=NULL;
   INSERT OrderMaster(OrderMasterKey,OrderYear,OrderWeek,OrderYearWeek,CustKey,Manager) VALUES(4000,N'2025',N'37-01',N'202537',533,N'fixture-user');
   INSERT OrderDetail(OrderDetailKey,OrderMasterKey,CustKey,ProdKey,OutQuantity,OrderQuantity) VALUES(4000,4000,533,866,99,99);
   INSERT ShipmentMaster(ShipmentKey,OrderYear,OrderWeek,OrderYearWeek,CustKey,isDeleted,isFix) VALUES(7000,N'2025',N'37-01',N'202537',533,0,0);
   INSERT ShipmentDetail(SdetailKey,ShipmentKey,CustKey,ProdKey,OutQuantity,EstQuantity,Cost,Amount,Vat,BoxQuantity,BunchQuantity,SteamQuantity,ShipmentDtm,isFix) VALUES(99000,7000,NULL,866,99,990,100,90000,9000,99,990,9900,'2025-09-01',0);
   INSERT ShipmentDate(SdateKey,SdetailKey,ShipmentDtm,ShipmentQuantity,EstQuantity,Cost,Amount,Vat) VALUES(99000,99000,'2025-09-01',99,990,100,90000,9000);
   INSERT ShipmentDate(SdateKey,SdetailKey,ShipmentDtm,ShipmentQuantity,EstQuantity,Cost,Amount,Vat) VALUES(99001,89892,'2026-09-04',0.5,5,100,450,50),(99002,89892,'2026-09-05',0,0,100,0,0);`);
  const inlineRead=async year=>(await q(DISTRIBUTION_INLINE_DATES_SQL,{year:{type:sql.NVarChar,value:year},week:{type:sql.NVarChar,value:'37-01'}})).recordset;
  assert((await inlineRead('2026')).some(r=>r.ShipmentQuantity===0),'full baseline retains zero date facts');assert((await inlineRead('2026')).every(r=>r.CustKey===533&&r.Timestamp.startsWith('2026')));assert((await inlineRead('2025')).every(r=>r.OutQuantity===99&&r.Timestamp.startsWith('2025')));
  const {DISTRIBUTION_DATE_CALENDAR_SQL}=await import('../lib/shipmentDistributionDates.js');assert.equal((await q(DISTRIBUTION_DATE_CALENDAR_SQL,{ywk:{type:sql.NVarChar,value:'202537'}})).recordset.length,0,'calendar does not fall back to another year');
  const before=JSON.stringify((await q('SELECT * FROM ShipmentDetail ORDER BY SdetailKey')).recordset);
  const current=await read('2026');assert(current.length>0);assert(current.every(r=>r.CustKey===533));
  assert(current.some(r=>r.ShipmentDate==='2026-09-04'),'multi-day positive date included through master customer');
  assert(!current.some(r=>r.ShipmentDate==='2025-09-01'||r.ShipmentDate==='2026-09-05'),'prior year and zero date excluded');
  assert.deepEqual((await read('2025')).map(r=>r.ShipmentDate),['2025-09-01']);
  await q('DELETE ShipmentDate WHERE SdetailKey=89892');assert((await read('2026')).some(r=>r.ShipmentDate===null),'order without date visible as undated');
  await q('UPDATE OrderDetail SET isDeleted=1 WHERE OrderMasterKey=3701');assert.deepEqual(await read('2026'),[]);
  assert.equal(JSON.stringify((await q('SELECT * FROM ShipmentDetail ORDER BY SdetailKey')).recordset),before,'classification never changes shipment');
  console.log('PASS actual isolated date SQL: cross-year99, master customer with null detail customer, multi-day/zero/undated/deleted, no quantity writes.');

 }finally{
  await pool?.close();if(master)await fixture.query(master,`IF DB_ID(N'${name}') IS NOT NULL BEGIN ALTER DATABASE ${fixture.bracket(name)} SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE ${fixture.bracket(name)}; END`);await master?.close();
 }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
