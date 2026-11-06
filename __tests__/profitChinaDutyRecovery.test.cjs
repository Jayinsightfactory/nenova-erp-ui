const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const native=import('../lib/profitNativeUnitCosts.mjs'),duty=import('../lib/profitTemplateDuty.mjs');
const item={prodKey:1,country:'중국',unit:'단',period:2026449900,quantity:20,stockKey:9};
const donor={id:'d',country:'중국',currency:'CNY',unit:'단',period:2026439900,quantity:100,freight:200,customs:300,duty:200};
const purchase={id:'p',prodKey:1,country:'중국',currency:'CNY',unit:'단',period:2026440100,quantity:20,goods:2000};
test('native unit inventory preserves actual goods per bunch without inventing stem packing',async()=>{
 const m=await native,input=JSON.stringify(item),r=m.nativeUnitInventoryValue([item],{donors:[donor,donor],purchases:[purchase,purchase]});
 assert.equal(r.available,true);assert.equal(r.value,2100);assert.equal(r.details[0].goodsPerUnit,100);assert.equal(r.details[0].rawUnit,'단');assert.equal(r.details[0].physicalStemConversionApplied,false);assert.equal(JSON.stringify(item),input);
 assert.equal(m.nativeUnitReceiptCustoms(item,{donors:[donor]}).other,20);
 assert.equal(m.nativeUnitInventoryValue([{...item,quantity:-2}],{donors:[donor],purchases:[purchase]}).value,-210);
 assert.equal(m.nativeUnitInventoryValue([{...item,quantity:0}],{}).value,0);
});
test('native unit costs reject unit currency country future and missing goods near misses',async()=>{
 const m=await native;
 for(const bad of [{unit:'송이'},{currency:'USD'},{country:'호주'},{period:2027010100},{quantity:0}])assert.equal(m.nativeUnitInventoryValue([item],{donors:[{...donor,...bad}],purchases:[purchase]}).available,false);
 for(const bad of [{unit:'송이'},{currency:'USD'},{country:'호주'},{period:2027010100},{prodKey:2}])assert.equal(m.nativeUnitInventoryValue([item],{donors:[donor],purchases:[{...purchase,...bad}]}).available,false);
 assert.equal(m.nativeUnitInventoryValue([item],{donors:[donor],purchases:[]}).available,false);
 assert.equal(m.nativeUnitReceiptCustoms(item,{donors:[{...donor,duty:null}]}).other,null);
 assert.equal(m.nativeUnitInventoryValue([item],{donors:[donor,{...donor,customs:999}],purchases:[purchase]}).missing[0].reason,'NATIVE_UNIT_DUPLICATE_SOURCE_CONFLICT');
 assert.equal(m.nativeUnitInventoryValue([item],{donors:[{...donor,period:2025439900}],purchases:[purchase]}).available,false);
 assert.equal(m.nativeUnitInventoryValue([{...item,period:2027449900}],{donors:[donor],purchases:[purchase]}).available,false);
 for(const value of [null,undefined,'',NaN])assert.equal(m.nativeUnitInventoryValue([item],{donors:[donor],purchases:[{...purchase,goods:value}]}).available,false);
});
test('native H fallback replaces only missing other-cost component, never double adds the existing tariff',async()=>{
 const {applyAverageFallbackView:f}=await import('../lib/profitAverageView.mjs');
 const p={ProdKey:1,ProdName:'Rose',CounName:'중국',FlowerName:'장미',OutUnit:'단',SteamOf1Bunch:10},receipt={OrderYear:'2026',OrderWeek:'44-01',WdetailKey:1,ProdKey:1,BunchQuantity:20,SteamQuantity:20,TPrice:200},
 row={category:'중국',currency:'CNY',calc:{C:5000,G:2000,H:null,E:0,F:null,Q:200,R:10,AJ:0},source:{H:'actual_cost_missing',R:'manual'},manual:{},
  templateDuty:{knownTotal:150,oldDuty:null,missing:[{diagnostic:{failed:['LEGACY_DUTY_SPLIT_UNCONFIRMED']}}]},
  inventoryValuation:{begin:{method:'no_stock',year:'2026',week:'43-01',quantity:0},end:{method:'product_cost',year:'2026',week:'44-01',quantity:20,unit:'단'}},stock:{week:'44-01'}},
 payload={rows:[row]},options={year:'2026',major:'44',rawRows:[row],products:[p],receipts:[receipt],stocks:[{OrderYear:'2026',OrderWeek:'44-01',StockKey:9,ProdKey:1,Stock:20}],nativeUnitCosts:{donors:[donor],purchases:[purchase]}};
 const out=f(payload,options).rows[0];assert.equal(out.calc.H,170);assert.equal(out.averageFallback.evidence.H.knownDuty,150);assert.equal(out.averageFallback.evidence.H.other,20);assert.equal(out.calc.F,2100);assert.equal(out.calc.K,out.calc.J/out.calc.C);
 assert.equal(out.inventoryValuation.end.averageFallbackEvidence.method,'approved_native_unit_acquisition');assert.equal(row.calc.H,null);
});
test('China registry uses exact key country name year and traceable approved form references',async()=>{
 const m=await duty,chinaRecovery=JSON.parse(fs.readFileSync('data/profit-china-duty-recovery-2026.json')),policy={products:[],chinaRecovery};
 assert.equal(chinaRecovery.products.length,124);
 for(const p of chinaRecovery.products){
  const line={prodKey:p.prodKey,name:p.exactName,country:p.country,orderYear:'2026',orderWeek:'44-01'};
  const r=m.resolveTemplateDutyRule(line,policy,'2026');assert.equal(r.rate,p.rate);assert.equal(r.workbookEvidence.actualDeclarationVerified,false);assert.ok(r.workbookEvidence.source.cells.length>=2);
  for(const bad of [{prodKey:99999},{name:p.exactName+' changed'},{country:'호주'},{orderYear:'2025'}])assert.equal(m.resolveTemplateDutyRule({...line,...bad},policy,'2026'),null);
  assert.equal(m.resolveTemplateDutyRule(line,policy,'2027'),null);
 }
});
test('native donors preserve full receipt money and reject mixed units and inferred currency conflict',async()=>{
 const m=await native,product={ProdKey:1,ProdName:'Rose',CounName:'중국',FlowerName:'장미',OutUnit:'단'},receipt={OrderYear:'2026',OrderWeek:'43-01',WdetailKey:1,ProdKey:1,BunchQuantity:10,SteamQuantity:10,TPrice:100};
 const row={category:'중국',currency:'CNY',source:{R:'manual',H:'actual'},calc:{R:10,Q:100,P:1000,G:1100,H:200},templateDuty:{total:100}},reports=[{major:'43',rows:[row]}];
 const good=m.buildNativeUnitCostSources(reports,[product],[receipt],[{warehouseDetailKey:1,currency:'CNY'}]);assert.equal(good.donors.length,1);assert.equal(good.donors[0].quantity,10);assert.equal(good.purchases[0].goods,1000);
 assert.equal(m.buildNativeUnitCostSources(reports,[product],[{...receipt,TPrice:99}],[]).donors.length,0);
 assert.equal(m.buildNativeUnitCostSources(reports,[product],[receipt],[{warehouseDetailKey:1,currency:'USD'}]).donors.length,0);
 assert.equal(m.buildNativeUnitCostSources(reports,[product],[receipt],[{warehouseDetailKey:1,currency:'USD'}]).purchases.length,0);
 assert.equal(m.buildNativeUnitCostSources([{major:'43',rows:[{...row,source:{R:'unknown',H:'actual'}}]}],[product],[receipt],[]).purchases.length,0);
 assert.equal(m.buildNativeUnitCostSources([{major:'43',rows:[{...row,source:{...row.source,H:'missing'}}]}],[product],[receipt],[]).donors.length,0);
});
test('approved receipt formula components require complete live same-year unit identity, not ACTUAL payment certification',async()=>{
 const {approvedReceiptDutyCosts:f}=await import('../lib/profitApprovedReceiptCosts.mjs');
 const line={wdetailKey:2,prodKey:1,quantity:20,unit:'BUNCH',totalCostKRW:1300,costPerUnitKRW:65,componentAmounts:{goodsKRW:1000,freightKRW:100,tariffKRW:150,otherKRW:50}},
 a={status:'APPROVED',storedStatus:'APPROVED',basis:'ACTUAL',liveReceiptStatus:'MATCH',currency:'KRW',editableInput:{input:{nativeCurrency:'CNY',exchangeRateKRW:215,expenseBasis:'ESTIMATED'}},orderYear:'2026',orderWeek:'42-01',warehouseKey:3,documentId:'d',documentRevision:1,operationId:'o',lines:[line]},
 costs={status:'APPROVED',documentCostStatus:'APPROVED',documentId:'d',documentRevision:1,operationId:'o',currentActual:a},
 expected=[{warehouseDetailKey:2,prodKey:1,orderYear:'2026',orderWeek:'42-1',warehouseKey:3,outUnit:'단',outQuantity:20,active:true}],options={year:'2026',warehouseKey:3};
 assert.equal(f(costs,expected,options)[0].duty,150);assert.equal(f(costs,expected,options)[0].other,50);assert.equal(f(costs,expected,options)[0].evidence.actualPaymentCertified,false);
 for(const bad of [{currency:'USD'},{orderYear:'2025'},{orderWeek:'41-01'},{liveReceiptStatus:'CHANGED'},{documentRevision:2},{editableInput:{input:{expenseBasis:'TEST_ONLY'}}}])assert.deepEqual(f({...costs,currentActual:{...a,...bad}},expected,options),[]);
 for(const bad of [{unit:'STEM'},{quantity:19},{prodKey:99},{totalCostKRW:1400},{componentAmounts:{...line.componentAmounts,tariffKRW:null}}])assert.deepEqual(f({...costs,currentActual:{...a,lines:[{...line,...bad}]}},expected,options),[]);
 assert.deepEqual(f(costs,[...expected,{...expected[0],warehouseDetailKey:4}],options),[]);
 assert.deepEqual(f({...costs,currentActual:{...a,lines:[line,line]}},expected,options),[]);
});
