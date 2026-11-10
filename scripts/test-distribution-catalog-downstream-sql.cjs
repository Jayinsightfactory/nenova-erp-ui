// Isolated loopback MSSQL: shared writer helpers -> native export SQL -> XLSX mapping.
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
  await q(`ALTER TABLE Customer ADD CustCode nvarchar(30); ALTER TABLE Product ADD ProdCode nvarchar(30);`);
  await q(`UPDATE Customer SET CustCode=N'FIX533'; UPDATE Product SET ProdCode=N'FIX-US',CounName=N'미국',FlowerName=N'더글라스'; DELETE ShipmentDate WHERE SdateKey=119700; UPDATE ShipmentDate SET EstQuantity=0,Amount=0,Vat=0 WHERE SdateKey=119701;`);
  await q(`ALTER VIEW dbo.ViewOrder AS SELECT om.OrderMasterKey,od.OrderDetailKey,om.OrderYear,om.OrderWeek,om.OrderYearWeek+RIGHT(om.OrderWeek,2) OrderYearWeek2,om.CustKey,od.ProdKey,od.OutQuantity FROM OrderMaster om JOIN OrderDetail od ON od.OrderMasterKey=om.OrderMasterKey JOIN UserInfo ui ON ui.UserID=om.Manager JOIN Customer c ON c.CustKey=om.CustKey JOIN Product p ON p.ProdKey=od.ProdKey WHERE om.isDeleted=0 AND od.isDeleted=0 AND c.isDeleted=0 AND p.isDeleted=0`);
  const {assertShipmentLineHasOrder,validateShipmentWeek}=await import('../lib/shipmentEstimateGuard.js');
  const {refreshShipmentDatesAfterDetailChange}=await import('../lib/syncShipmentDateEst.js');
  const {sqlEstimateGetExcelDetail}=await import('../lib/exeEstimateViewSql.js');
  const {mapExcelDetailRowToEcount,buildEcountUploadSheet}=await import('../lib/estimateEcountExcel.js');
  const scope={orderYear:'2026',orderWeek:'37-01',custKey:533,prodKey:866};
  await assertShipmentLineHasOrder(q,sql,scope);
  await assert.rejects(()=>assertShipmentLineHasOrder(q,sql,{...scope,orderYear:'2025'}));
  for(const [bad,restore] of [
   ["UPDATE OrderMaster SET Manager=N'missing'","UPDATE OrderMaster SET Manager=N'fixture-user'"],
   ['UPDATE Product SET isDeleted=1','UPDATE Product SET isDeleted=0'],
   ['UPDATE Customer SET isDeleted=1','UPDATE Customer SET isDeleted=0'],
   ['UPDATE OrderDetail SET isDeleted=1','UPDATE OrderDetail SET isDeleted=0']]){
   await q(bad);await assert.rejects(()=>assertShipmentLineHasOrder(q,sql,scope));await q(restore);
  }
  assert.equal(validateShipmentWeek({...scope,orderYearWeek:'20263701'}).ok,false);
  await refreshShipmentDatesAfterDetailChange(q,89892,sql);
  const read=()=>q(sqlEstimateGetExcelDetail({weekDayIn:'1,2,3,4,5,6,7'}),{orderYearWeek:{type:sql.NVarChar,value:'202637'},custKey:{type:sql.Int,value:533}});
  let rows=(await read()).recordset;assert.equal(rows.length,1);assert.equal(Number(rows[0].EstQuantity),750);
  const excel=mapExcelDetailRowToEcount(rows[0]);assert.equal(excel.수량,750);assert.equal(excel.공급가액,Number(rows[0].Amount));assert.equal(excel.부가세,Number(rows[0].Vat));assert.ok(buildEcountUploadSheet(rows)['!ref'].endsWith('2'));
  const money=(await q('SELECT Amount,Vat FROM ShipmentDetail WHERE SdetailKey=89892')).recordset[0];assert.equal(Number(money.Amount),Number(rows[0].Amount));assert.equal(Number(money.Vat),Number(rows[0].Vat));
  for(const [bad,restore] of [
   ['UPDATE ShipmentDetail SET isFix=0','UPDATE ShipmentDetail SET isFix=1'],
   ['UPDATE ShipmentDate SET EstQuantity=0','UPDATE ShipmentDate SET EstQuantity=750'],
   ["UPDATE ShipmentDate SET ShipmentDtm=DATEADD(hour,1,ShipmentDtm)","UPDATE ShipmentDate SET ShipmentDtm=DATEADD(hour,-1,ShipmentDtm)"],
   ["UPDATE ShipmentMaster SET OrderYearWeek=N'20263701'","UPDATE ShipmentMaster SET OrderYearWeek=N'202637'"]]){
   await q(bad);assert.equal((await read()).recordset.length,0);await q(restore);
  }
  assert.equal((await read()).recordset.length,1);
  console.log('PASS real SQL: valid US product -> shared date/amount sync -> native ECOUNT export -> XLSX row; prior-year/no order/bad manager/deleted product/customer/order blocked; unfixed/zero estimate/off-time/full raw key excluded. Operational writes0.');
 }finally{
  await pool?.close();if(master)await fixture.query(master,`IF DB_ID(N'${name}') IS NOT NULL BEGIN ALTER DATABASE ${fixture.bracket(name)} SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE ${fixture.bracket(name)}; END`);await master?.close();
 }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
