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

  await q('ALTER TABLE Customer ADD CustArea nvarchar(100)');
  const {sqlDistributionWorkspaceCustomers}=await import('../lib/shipmentDistributionCustomerScope.js');
  const read=async(year,week,group)=>{const scope=sqlDistributionWorkspaceCustomers(group),params={year:{type:sql.NVarChar,value:year},week:{type:sql.NVarChar,value:week}};for(const[k,v]of Object.entries(scope.params))params[k]={...v,type:sql.NVarChar};return(await q(scope.statement,params)).recordset;};
  await q(`DELETE ShipmentDate;DELETE ShipmentDetail;UPDATE Product SET CounName=N'태국',FlowerName=N'레드불';
  INSERT Customer(CustKey,CustName,Manager) VALUES(534,N'Fixture B',N'fixture-user'),(535,N'Fixture C',N'fixture-user');
  INSERT Product(ProdKey,ProdName,CountryFlower,CounName,FlowerName,OutUnit,EstUnit,BunchOf1Box,SteamOf1Bunch,SteamOf1Box,Cost,Stock) VALUES(867,N'Fixture US',N'미국장미',N'미국',N'장미',N'박스',N'단',10,10,100,1000,0);
  INSERT OrderMaster(OrderMasterKey,OrderYear,OrderWeek,OrderYearWeek,CustKey,Manager) VALUES(4000,N'2025',N'37-01',N'202537',534,N'fixture-user'),(4001,N'2026',N'37-01',N'202637',535,N'fixture-user');
  INSERT OrderDetail(OrderDetailKey,OrderMasterKey,CustKey,ProdKey,BoxQuantity,BunchQuantity,SteamQuantity,OutQuantity,OrderQuantity) VALUES(4000,4000,534,866,99,990,9900,99,99),(4001,4001,535,867,2,20,200,2,2);`);
  const before=JSON.stringify((await q('SELECT * FROM OrderDetail ORDER BY OrderDetailKey')).recordset);
  assert.deepEqual((await read('2026','37-01','태국::레드불')).map(r=>r.CustKey),[533],'order-only customer visible without shipment/date');
  assert.deepEqual((await read('2025','37-01','태국::')).map(r=>r.CustKey),[534],'same-week prior year isolated');
  assert.deepEqual((await read('2026','37-01','미국::')).map(r=>r.CustKey),[535]);
  const activeCount=(await q('SELECT COUNT(*) N FROM Customer WHERE isDeleted=0')).recordset[0].N;
  assert.equal((await read('2026','45-03','태국::레드불')).length,activeCount,'empty scope exposes active candidates');
  assert((await read('2026','45-03','태국::레드불')).every(r=>r.noOrder));
  await q('UPDATE Customer SET isDeleted=1 WHERE CustKey=534');assert.equal((await read('2026','45-03','태국::')).length,activeCount-1);assert((await read('2025','37-01','태국::')).every(r=>r.noOrder));
  await q('UPDATE OrderDetail SET isDeleted=1 WHERE OrderMasterKey=3701');assert((await read('2026','37-01','태국::')).every(r=>r.noOrder));
  await q('UPDATE OrderDetail SET isDeleted=0 WHERE OrderMasterKey=3701');
  assert.equal(JSON.stringify((await q('SELECT * FROM OrderDetail ORDER BY OrderDetailKey')).recordset),before,'queries create no orders or quantity changes');
  console.log('PASS isolated customer scope: order-only, country/variety, cross-year99, empty45-03 active candidates, deletion, no writes.');
 }finally{
  await pool?.close();if(master)await fixture.query(master,`IF DB_ID(N'${name}') IS NOT NULL BEGIN ALTER DATABASE ${fixture.bracket(name)} SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE ${fixture.bracket(name)}; END`);await master?.close();
 }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
