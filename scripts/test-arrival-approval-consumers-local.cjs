// SQL integration test only. Never accepts a production connection.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
module.exports=async function(all,keys){
 const {pool,query,ctx,sql}=all;
 assert.equal(pool.config.server,'127.0.0.1');assert.equal(pool.config.port,14339);
 assert.match(pool.config.database,/^NenovaInvoiceFixture_/);
 require('node:module').registerHooks({resolve(spec,context,next){
  if(spec.startsWith('.')&&!path.extname(spec))try{return next(spec+'.js',context);}catch{}
  return next(spec,context);
 }});
 const latest=await import('../lib/latestArrivalReference.js');
 const hotel=await import('../lib/raumPnlArrivalReference.js');
 const pivot=await import('../lib/pivotArrivalLedger.js');
 const {pivotArrivalKey}=await import('../lib/pivotArrivalReference.js');
 const source=await import('../lib/arrivalInvoiceSource.js');
 await query(pool,fs.readFileSync(path.join(__dirname,'../docs/migrations/2026-08-10_web_arrival_cost_schema.sql'),'utf8'));
 for(const key of keys)await query(pool,`INSERT dbo.WebArrivalCostLine(ImportKey,OrderYear,OrderWeek,ProdKey,FarmKey,CountryName,FarmNameRaw,Unit,Quantity,SelectedArrivalCostKRW,IsCurrent)
 VALUES(1,'2026','42-01',@pk,7111,N'콜롬비아',N'Florentina Export S.A.S',N'송이',1,1111,1),
 (1,'2025','43-02',@pk,7111,N'콜롬비아',N'Florentina Export S.A.S',N'송이',1,9999,1);`,{pk:{type:sql.Int,value:key}});
 const products=(await ctx.queryFn(`SELECT * FROM Product WHERE ProdKey IN (${keys.join(',')})`)).recordset;
 const report={productionModified:false,invoice:'2914',year:2026,week:'43-02',costInputs:'TEST_ONLY',checks:[],rows:[]};
 const snapshot=async()=>{
  const tables=['OrderMaster','OrderDetail','ShipmentMaster','ShipmentDetail','StockMaster','ProductStock','StockHistory','WarehouseMaster','WarehouseDetail'];
  const result={};for(const table of tables)result[table]=(await ctx.queryFn(`SELECT * FROM dbo.${table} FOR JSON PATH, INCLUDE_NULL_VALUES`)).recordset;
  return result;
 };
 let before;
 async function readAll(){
  const items=keys.map((prodKey,i)=>({prodKey,itemKey:i+1,major:43,unit:'송이'}));
  const hotels=await hotel.withHotelArrivalReferences(items,'2026',ctx.queryFn);
  assert(hotels.every(r=>!r.arrivalReferenceError),'hotel read failed');
  const catalog=await latest.loadLatestArrivalMap({orderYear:'2026',products},ctx.queryFn);
  const pivotRows=keys.map(ProdKey=>({ProdKey,OrderYear:'2026',OrderWeek:'43-02'}));
  const ledger=await pivot.loadPivotArrivalLedger(pivotRows,ctx.queryFn);
  const incoming=await latest.loadLatestArrivalReferences({orderYear:'2026',items:keys.map(prodKey=>({prodKey,unit:''}))},ctx.queryFn);
  const rows=keys.map((key,i)=>({prodKey:key,hotel:latest.selectLatestArrivalReferences(hotels[i].arrivalHistory,'2026'),catalog:catalog[key],pivot:ledger[pivotArrivalKey(pivotRows[i])],incoming:incoming[`${key}|`]}));
  return rows;
 }
 return {
  async beforeApproval(){
   before=await snapshot();
   const invoice=await source.loadArrivalInvoiceRows({queryFn:ctx.queryFn,types:sql,year:'2026'});
   assert.equal(invoice.rows.length,0);
   const rows=await readAll();
   for(const row of rows){assert.equal(row.hotel[0].cost,1111);assert.equal(row.catalog.arrivalWeek,'42-1');assert.equal(row.pivot.sourceWeek,'42-1');assert.equal(row.incoming[0].week,'42-1');}
   report.checks.push('unapproved invoice excluded; previous 2026/42-01 retained in all consumers');
  },
  async afterApproval(saved,out){
   const approved=await source.loadArrivalInvoiceRows({queryFn:ctx.queryFn,types:sql,year:'2026'});
   assert.equal(approved.rows.length,keys.length);assert.equal(approved.warnings.length,0);
   const rows=await readAll();
   for(const row of rows){
    const original=approved.rows.find(r=>r.ProdKey===row.prodKey),product=products.find(p=>p.ProdKey===row.prodKey);
    const sourceFactor=original.Unit==='박스'?Number(product.SteamOf1Box):original.Unit==='단'?Number(product.SteamOf1Bunch):1;
    assert(sourceFactor>0);
    const expected=original.SelectedArrivalCostKRW/sourceFactor;
    const near=(a,b)=>assert(Math.abs(a-b)<0.0001,`${row.prodKey}: ${a} != ${b}`);
    near(row.hotel[0].cost,expected);near(row.catalog.arrivalCost,expected);near(row.incoming[0].cost,original.SelectedArrivalCostKRW);
    const factor=product.OutUnit==='박스'?Number(product.SteamOf1Box):product.OutUnit==='단'?Number(product.SteamOf1Bunch):1;
    near(row.pivot.arrivalCost,expected*factor);
    for(const week of [row.hotel[0].week,row.catalog.arrivalWeek,row.pivot.sourceWeek,row.incoming[0].week])assert.equal(week,'43-2');
    report.rows.push({prodKey:row.prodKey,costPerStem:expected,hotel:row.hotel[0].cost,catalog:row.catalog.arrivalCost,pivot:row.pivot.arrivalCost,pivotUnit:row.pivot.unit,incoming:row.incoming[0].cost,week:row.hotel[0].week});
   }
   report.checks.push('approved actual cost shared by hotel/catalog/pivot/incoming readers; normalized units agree');
   assert.deepEqual(await snapshot(),before);report.checks.push('cost approval and reads did not change order/shipment/stock/receipt tables');
   const XLSX=require('xlsx');const workbook=XLSX.read(out.buffer,{type:'buffer'});assert(workbook.SheetNames.length>0);
   report.download={bytes:out.buffer.length,sheets:workbook.SheetNames};
   const prior=await latest.loadLatestArrivalReferences({orderYear:'2025',items:[{prodKey:keys[0],unit:'송이'}]},ctx.queryFn);
   assert.equal(prior[`${keys[0]}|송이`][0].cost,9999);report.checks.push('same week in prior year stays isolated');
   const candidate={WarehouseKey:saved.warehouseKey,DocumentId:saved.documentId,Country:'CO',FarmKey:7111};
   const invalid=structuredClone(saved);invalid.currentActual.liveReceiptStatus='MISMATCH';
   assert.equal(source.invoiceArrivalRows(invalid,candidate,'2026').length,0);
   report.checks.push('receipt mismatch rejected');
   const held=structuredClone(saved);held.documentCostStatus='PENDING';
   assert.equal(source.invoiceArrivalRows(held,candidate,'2026').length,0);
   const testOnly=structuredClone(saved);testOnly.currentActual.expenseBasis='TEST_ONLY';
   assert.equal(source.invoiceArrivalRows(testOnly,candidate,'2026').length,0);
   const oldRevision=structuredClone(saved);oldRevision.currentActual.documentRevision+=1;
   assert.equal(source.invoiceArrivalRows(oldRevision,candidate,'2026').length,0);
   report.checks.push('pending approval, test-only basis, stale document revision rejected');
   const historical=(await ctx.queryFn('SELECT * FROM dbo.WebArrivalCostLine FOR JSON PATH, INCLUDE_NULL_VALUES')).recordset;
   const firstLines=JSON.stringify(saved.currentActual.lines);
   const second=await all.costs.saveInvoiceCostRevision({withTransactionFn:ctx.withTransactionFn,types:sql,documentId:saved.documentId,revision:saved.documentRevision,actor:'invoice-fixture',reason:'TEST_ONLY second approval refresh',input:{...saved.currentActual.editableInput.input,formulaApplicabilityConfirmed:true,exchangeRateKRW:1350}});
   const changed=await readAll();
   for(let i=0;i<changed.length;i++){
    assert(changed[i].hotel[0].cost<rows[i].hotel[0].cost);
    assert.equal(changed[i].hotel[0].cost,changed[i].catalog.arrivalCost);
    assert.equal(changed[i].pivot.arrivalCost,changed[i].incoming[0].cost);
   }
   assert.notEqual(second.currentActual.costRevisionId,saved.currentActual.costRevisionId);
   assert.equal(JSON.stringify(saved.currentActual.lines),firstLines);
   assert.deepEqual((await ctx.queryFn('SELECT * FROM dbo.WebArrivalCostLine FOR JSON PATH, INCLUDE_NULL_VALUES')).recordset,historical);
   assert.deepEqual(await snapshot(),before);
   report.checks.push('reapproval refreshes all readers without persistent stale cache; historical ledger and ERP amounts preserved');
   report.renderData=rows;
   const dir=path.join(__dirname,'../.local-arrival-e2e');fs.mkdirSync(dir,{recursive:true});
   fs.writeFileSync(path.join(dir,'report.json'),JSON.stringify(report,null,2));fs.writeFileSync(path.join(dir,'TEST_ONLY-CO-43-2-cost.xlsx'),out.buffer);
   console.log('ARRIVAL_CONSUMERS_PASS',JSON.stringify({...report,renderData:undefined}));
   if(process.env.NENOVA_ARRIVAL_UI==='1')await require('./test-arrival-consumers-ui-local.cjs')({all,products,saved:second,readAll});
  }
 };
};
