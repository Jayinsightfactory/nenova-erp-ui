const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),XLSX=require('xlsx');
module.exports=async function verifyMulti(q,sql,config){
 console.log('multi fixture: starting');
 const {refreshShipmentDatesAfterDetailChange}=await import('../lib/syncShipmentDateEst.js');
 const {sqlEstimateGetExcelDetail,sqlEstimateGetPrintDetail}=await import('../lib/exeEstimateViewSql.js');
 const {buildEcountUploadSheet}=await import('../lib/estimateEcountExcel.js');
 const pool=await new sql.ConnectionPool(config).connect();
 console.log('multi fixture: connected');
 try{
  const tq=(statement,params)=>require('./test-weekday-distribution-sql.cjs').query(pool,statement,params);
  for(const [key,qty] of [[534,5],[535,7]]){
   await tq(`INSERT Customer(CustKey,CustName,Manager,OrderCode,BaseOutDay,CustCode) VALUES(${key},N'Fixture ${key}',N'fixture-user',N'F${key}',4,N'F${key}');
    INSERT OrderMaster(OrderMasterKey,OrderYear,OrderWeek,OrderYearWeek,CustKey,Manager) VALUES(${key},N'2026',N'37-01',N'202637',${key},N'fixture-user');
    INSERT OrderDetail(OrderDetailKey,OrderMasterKey,CustKey,ProdKey,OutQuantity,OrderQuantity,BoxQuantity,BunchQuantity,SteamQuantity) VALUES(${key},${key},${key},866,${qty},${qty},${qty},${qty*30},${qty*30});
    INSERT ShipmentMaster(ShipmentKey,OrderYear,OrderWeek,OrderYearWeek,CustKey,isFix,isDeleted,WebCreated,CreateID) VALUES(${key},N'2026',N'37-01',N'202637',${key},1,0,1,N'fixture-user');
    INSERT ShipmentDetail(SdetailKey,ShipmentKey,CustKey,ProdKey,ShipmentDtm,OutQuantity,BoxQuantity,BunchQuantity,SteamQuantity,EstQuantity,Cost,Amount,Vat,isFix) VALUES(${key},${key},${key},866,'2026-09-10',${qty},${qty},${qty*30},${qty*30},${qty*30},100,${qty*3000},${qty*300},1);`);
   await tq(`INSERT ShipmentDate(SdateKey,SdetailKey,ShipmentDtm,ShipmentQuantity,EstQuantity,Cost,Amount,Vat,Descr) VALUES(${key},${key},'2026-09-10',${qty},${qty*30},100,${qty*3000},${qty*300},N'fixture');`);
   await refreshShipmentDatesAfterDetailChange(tq,key,sql);
  }
  console.log('multi fixture: committed');
 }finally{await pool.close();}
 // New connection: no UI/request-memory values are used as readback authority.
 const fresh=await new sql.ConnectionPool(config).connect();
 try{
  const rq=(statement,params)=>require('./test-weekday-distribution-sql.cjs').query(fresh,statement,params);
  if(process.argv.includes('--browser-refresh'))await require('./distribution-localdb-browser.cjs')(rq,sql,refreshShipmentDatesAfterDetailChange,fresh);
  const persisted=(await rq('SELECT CustKey,OutQuantity FROM ShipmentDetail WHERE CustKey IN(534,535) AND ProdKey=866 ORDER BY CustKey')).recordset;
  assert.deepEqual(persisted.map(r=>[r.CustKey,Number(r.OutQuantity)]),[[534,5],[535,7]]);
  // Quote eligibility requires confirmation. This fixture isolates export from stock confirmation.
  await rq("UPDATE ShipmentDetail SET isFix=1 WHERE CustKey IN(534,535) AND ProdKey=866;UPDATE ShipmentMaster SET isFix=1 WHERE CustKey IN(534,535) AND OrderYear=N'2026' AND OrderWeek=N'37-01'");
  const excel=[],print=[];
  const realEstimate=require('./load-isolated-erp-api.cjs')('pages/api/estimate/index.js',{query:rq,sql});
  console.log('fixture saved dates',JSON.stringify((await rq('SELECT sm.OrderYearWeek,sm.CustKey,sd.ShipmentDtm,dt.EstQuantity,dt.ShipmentDtm DateDtm FROM ShipmentMaster sm JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey JOIN ShipmentDate dt ON dt.SdetailKey=sd.SdetailKey WHERE sm.CustKey IN(534,535)')).recordset));
  for(const key of [534,535]){
   const params={orderYearWeek:{type:sql.NVarChar,value:'202637'},custKey:{type:sql.Int,value:key}};
   for(const view of ['excelDetail','print']){
    let status=200,body;const res={status(code){status=code;return this;},json(value){body=value;return this;}};
    await realEstimate({method:'GET',query:{week:'37-01',year:'2026',custKey:String(key),...(view==='excelDetail'?{view}:{byDate:'1',itemsOnly:'1',printDetail:'1'})},user:{userId:'fixture-user',authority:2}},res);
    assert.equal(status,200,JSON.stringify(body));assert.equal(body.success,true);
    if(view==='excelDetail')excel.push(...body.rows);else print.push(...body.items);
   }
  }
  assert.equal(excel.length,2);assert.equal(print.length,2);
  assert.deepEqual(excel.map(r=>Number(r.EstQuantity)),[150,210]);
  const dir=path.join(process.cwd(),'outputs','distribution-multi-save');fs.mkdirSync(dir,{recursive:true});
  for(const [name,sheet] of [['ecount',buildEcountUploadSheet(excel)],['estimate',XLSX.utils.json_to_sheet(print)]]){
   const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,sheet,'Export');const file=path.join(dir,name+'.xlsx');XLSX.writeFile(book,file);
   const back=XLSX.readFile(file);assert.equal(XLSX.utils.sheet_to_json(back.Sheets.Export).length,2);
  }
  console.log('PASS multi customer real SQL COMMIT -> fresh connection 5/7 -> native estimate 2 rows -> ECOUNT 150/210 -> two actual XLSX files reopened, no omissions');
 }finally{await fresh.close();}
};
