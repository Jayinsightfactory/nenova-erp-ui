const assert=require('node:assert/strict');
(async()=>{
 const {buildForwardingLedger}=await import('../lib/customsForwarding.js');
 const row=(extra={})=>({OrderYear:'2026',OrderWeek:'42-01',WarehouseKey:1,WarehouseDetailKey:1,ProdKey:1,OrderNo:'86514699451',CounName:'콜롬비아',FlowerName:'장미',ProdName:'ROSE',TPrice:100,BoxQuantity:1,...extra});
 const freight=row({WarehouseKey:99,WarehouseDetailKey:99,OrderNo:'865-14699451',CounName:'국내',FlowerName:'왁스',ProdName:'운송료',InvoiceNo:'콯카장수국',FarmName:'Apollo',TPrice:34972.05});
 const goods=[row(),row({WarehouseKey:2,WarehouseDetailKey:2,FlowerName:'수국',ProdName:'Hydrangea'})];
 for(const invoice of ['콯카장수국','', 'unrecognized']){
  const r=buildForwardingLedger([...goods,{...freight,InvoiceNo:invoice}],{major:42,orderYear:'2026'});
  assert.equal(r.unmatchedRows.length,0);assert.equal(r.colombiaRest['42-01'],34972.05);
  assert.equal(r.classificationDelta,0);assert.equal(r.status,'ready');
 }
 const wrongYear=buildForwardingLedger([row({...goods[1],OrderYear:'2025'}),freight],{major:42,orderYear:'2026'});
 assert.equal(wrongYear.unmatchedRows.length,1);
 const mixedCountry=buildForwardingLedger([...goods,row({WarehouseKey:3,WarehouseDetailKey:3,CounName:'중국',FlowerName:'장미'}),{...freight,FarmName:'Unknown',InvoiceNo:''}],{major:42,orderYear:'2026'});
 assert.equal(mixedCountry.unmatchedRows.length,1);
 console.log('Colombia mixed AWB freight: PASS (pool, typo-independent, conservation, cross-year, mixed-country)');
})().catch(e=>{console.error(e);process.exitCode=1});
