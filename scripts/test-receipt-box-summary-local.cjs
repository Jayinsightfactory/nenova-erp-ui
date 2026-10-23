// Invoked only by the isolated native receipt writer harness after actual receipt creation.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
module.exports=async function({pool,ctx,sql},expected){
 assert.equal(pool.config.server,'127.0.0.1');assert.equal(pool.config.port,14339);
 assert.match(pool.config.database,/^NenovaInvoiceFixture_/);
 const {WAREHOUSE_BOX_SQL,summarizeReceipts}=await import('../lib/warehouseBoxSummary.js');
 const snapshot=async()=>JSON.stringify((await ctx.queryFn(`SELECT WarehouseKey,OrderYear,OrderWeek,GrossWeight,ChargeableWeight FROM WarehouseMaster ORDER BY WarehouseKey`)).recordset);
 const before=await snapshot();
 const all=(await ctx.queryFn(WAREHOUSE_BOX_SQL,{year:{type:sql.NVarChar,value:'2025'},toYear:{type:sql.NVarChar,value:'2026'}})).recordset;
 const receipt=all.filter(r=>Number(r.WarehouseKey)===Number(expected.warehouseKey));
 assert(receipt.length>0);
 const report={country:expected.country,week:expected.week,productionAccess:false,rows:receipt,checks:[]};
 for(const period of ['week','month','year'])for(const dimension of ['both','country','flower']){
  const result=summarizeReceipts(receipt,{year:'2026',period,dimension});
  assert.equal(result.totals.boxes,expected.totals.BoxQuantity);
  assert.equal(result.totals.receiptCount,1);
  const gw=Number(receipt[0].gw),cw=Number(receipt[0].cw);
  assert.equal((result.totals.gw??0)+(result.totals.mixedGW??0),gw);
  assert.equal((result.totals.cw??0)+(result.totals.mixedCW??0),cw);
  const countrySum=[...new Set(receipt.map(r=>r.country))].reduce((n,country)=>n+summarizeReceipts(receipt,{year:'2026',period,dimension,country}).totals.boxes,0);
  assert.equal(Math.round(countrySum*1e6)/1e6,expected.totals.BoxQuantity);
  const flowerSum=[...new Set(receipt.map(r=>r.flower))].reduce((n,flower)=>n+summarizeReceipts(receipt,{year:'2026',period,dimension,flower}).totals.boxes,0);
  assert.equal(Math.round(flowerSum*1e6)/1e6,expected.totals.BoxQuantity);
  report.checks.push({period,dimension,boxes:result.totals.boxes,gw:result.totals.gw,mixedGW:result.totals.mixedGW});
 }
 assert.equal(summarizeReceipts(receipt,{year:'2025'}).rows.length,0);
 // Synthetic near-misses use this same SQL in a rollback-only local transaction.
 const rollback=new Error('EXPECTED_FIXTURE_ROLLBACK');
 try{await ctx.withTransactionFn(async q=>{
  await q(`INSERT Product(ProdKey,ProdName,CounName,FlowerName,isDeleted) VALUES(990001,N'TEST_ONLY',N'중국',N'수국',1);
   INSERT WarehouseMaster(WarehouseKey,OrderYear,OrderWeek,InputDate,GrossWeight,ChargeableWeight,isDeleted)
   VALUES(990001,'2026','42-01','20260930',100,120,0),(990002,'2025','42-01','20250930',999,999,0),(990003,'2026','42-01','20261001',888,888,1);
   INSERT WarehouseDetail(WarehouseKey,ProdKey,BoxQuantity) VALUES(990001,990001,1.5),(990001,990001,0),(990001,NULL,NULL),(990002,990001,999),(990003,990001,888);`);
  const probe=(await q(WAREHOUSE_BOX_SQL,{year:{type:sql.NVarChar,value:'2026'},toYear:{type:sql.NVarChar,value:'2026'}})).recordset.filter(r=>r.WarehouseKey>=990000);
  assert.equal(probe.length,2);assert(probe.every(r=>r.WarehouseKey===990001));
  const near=summarizeReceipts(probe,{year:'2026',period:'month'});
  assert.equal(near.totals.boxes,1.5);assert.equal(near.totals.missingBoxes,1);
  assert.equal(near.mixed.length,1);assert.equal(near.totals.mixedGW,100);
  assert(near.rows.every(r=>r.period==='2026-09'));
  throw rollback;
 });assert.fail('fixture must rollback');}catch(e){if(e!==rollback)throw e;}
 report.checks.push('actual SQL: deleted master excluded, deleted product retained, prior year excluded, NULL/zero/decimal and missing classification preserved; rollback verified');
 assert.equal(await snapshot(),before);
 const dir=path.join(__dirname,'../.local-box-summary');fs.mkdirSync(dir,{recursive:true});
 fs.writeFileSync(path.join(dir,expected.country+'.json'),JSON.stringify(report,null,2));
 console.log('PASS invoice -> receipt -> box summary',expected.country,expected.totals.BoxQuantity,'boxes; 9 period/dimension combinations; weights unique; read-only');
};
