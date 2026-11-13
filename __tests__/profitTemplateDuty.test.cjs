const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const api=import('../lib/profitTemplateDuty.mjs'),allocation=import('../lib/profitDutyFreightAllocation.mjs');
const policy={products:[{prodKey:1,name:'Rose',country:'에콰도르',rate:.25,ruleIds:['excel!K14']}]};
const line=(extra={})=>({prodKey:1,name:'Rose',country:'에콰도르',category:'에콰도르',orderYear:'2026',orderWeek:'02-01',goodsForeign:100,freightForeign:20,currency:'USD',warehouseDetailKey:10,...extra});
const basis=(major,quantity)=>({method:'category_average',year:'2026',major,quantity,value:1200*quantity/100,average:{unitCost:12,purchaseQty:100,totalCost:1200,customsCost:0}});
const row=()=>({category:'에콰도르',currency:'USD',auto:{H:0},manual:{},source:{H:'actual',R:'manual_input'},customsComponents:{Customs1:0,Customs2:0},calc:{C:2000,E:120,F:240,G:1200,H:0,I:1080,J:920,K:.46,R:10,AJ:0,P:1000,T:200,Q:100,S:20},inventoryValuation:{begin:basis('01',10),end:basis('02',20)}});
const ctx=(extra={})=>({year:'2026',major:'02',policy,lines:[line()],customsByWeek:{},previousPayload:{rows:[row()]},...extra});
test('current-master FX cannot become actual declaration FX',async()=>{const m=await api,r=row();r.source.R='currency_master';assert.equal(m.calculateTemplateDuty({...ctx(),category:r.category,row:r}).H,null);const d=m.calculateTemplateDuty({...ctx({lines:[line({storedExchangeRate:11})]}),category:r.category,row:r});assert.equal(d.total,330);assert.equal(d.details[0].fxSource,'freight_cost_snapshot');});
test('actual engine header and recorded-stem fallback preserve complete AWB pool',async()=>{const {computeFreightCost}=await import('../lib/freightCalc.js'),{allocateDutyFreightByAwb:f}=await allocation;const c=computeFreightCost({master:{gw:100,cw:100,rateUSD:5.4,exchangeRate:1000,actualFreightUSD:540},details:[{warehouseDetailKey:1,prodKey:1,prodName:'Rose1',flowerName:'ROSE',counName:'에콰도르',boxQty:3,rawBoxQty:3,steamQty:800,recordedSteamQty:800,bunchQty:0,totalPriceUSD:100},{warehouseDetailKey:2,prodKey:2,prodName:'Rose2',flowerName:'ROSE',counName:'에콰도르',boxQty:0,rawBoxQty:0,steamQty:1600,recordedSteamQty:1600,bunchQty:0,totalPriceUSD:200}],flowerMeta:{ROSE:{stemsPerBox:600,boxWeight:10,boxCBM:.1}}});const result=f(c);assert.equal(result.evidence.invoiceTotal,540);assert.equal([...result.allocations.values()].reduce((a,n)=>a+n,0),540);assert.equal(result.allocations.get(1),180);assert.match(result.evidence.buckets[0].unit,/입고 원행/);});
test('exact fingerprint and 2026 boundary',async()=>{const m=await api;assert.ok(m.resolveTemplateDutyRule(line(),policy,'2026'));for(const l of [line({name:'other'}),line({country:'중국'}),line({orderYear:'2025'})])assert.equal(m.resolveTemplateDutyRule(l,policy,'2026'),null);assert.equal(m.resolveTemplateDutyRule(line(),policy,'2027'),null);});
test('actual/explicit zero/manual H dominate estimate',async()=>{const m=await api;for(const value of [0,77]){const d=m.calculateTemplateDuty({...ctx(),category:'에콰도르',row:row(),customsRow:{Customs1:value}});assert.equal(d.H,value);assert.equal(d.status,'actual_preserved');}const r=row();r.manual.H=999;assert.equal(m.calculateTemplateDuty({...ctx(),category:r.category,row:r}).H,999);});
test('CNF duty replaces old estimate exactly once',async()=>{const m=await api,r=row();r.actualCostEvidence={components:{customs:60}};r.calc.H=160;const d=m.calculateTemplateDuty({...ctx(),category:r.category,row:r});assert.equal(d.total,300);assert.equal(d.H,400);assert.equal(d.deltaH,240);});
test('partial unknown holds full H and company K retaining known subtotal',async()=>{const m=await api;const v=m.applyTemplateDutyView({rows:[row()]},ctx({lines:[line(),line({prodKey:999,warehouseDetailKey:11})]}));assert.equal(v.rows[0].calc.H,null);assert.equal(v.rows[0].calc.K,null);assert.equal(v.totals.H,null);assert.equal(v.totals.K,null);assert.equal(v.rows[0].templateDuty.knownTotal,300);});
test('confirmed clone, same-period average and idempotence',async()=>{const m=await api,p={rows:[row()],confirmed:{key:9},confirmedTotals:{C:2000,J:920}},before=JSON.stringify(p);const v=m.applyTemplateDutyView(p,ctx());assert.equal(v.rows[0].calc.H,300);assert.equal(v.rows[0].calc.F,300);assert.equal(v.rows[0].calc.E,120);assert.equal(v.rows[0].calc.J,680);assert.equal(JSON.stringify(p),before);assert.deepEqual(v.originalConfirmedTotals,p.confirmedTotals);assert.strictEqual(m.applyTemplateDutyView(v,ctx()),v);});
test('previous duty flows to E, wrong valuation week held',async()=>{const m=await api,c=ctx({lines:[line(),line({orderWeek:'01-01'})]});assert.equal(m.applyTemplateDutyView({rows:[row()]},c).rows[0].calc.E,150);const r=row();r.inventoryValuation.begin.major='40';assert.equal(m.applyTemplateDutyView({rows:[r]},c).rows[0].calc.K,null);});
test('wrong original formula and direct FIFO not guessed',async()=>{const m=await api;for(const method of ['category_average','product_cost']){const r=row();r.inventoryValuation.end.method=method;r.calc.F=241;assert.equal(m.applyTemplateDutyView({rows:[r]},ctx()).rows[0].calc.F,null);}});
test('source failure and foreign-currency gaps held',async()=>{const m=await api;assert.equal(m.applyTemplateDutyView({rows:[row()]},ctx({sourceFailure:'failed'})).rows[0].calc.H,null);for(const l of [line({currency:'CNY'}),line({freightForeign:null})])assert.equal(m.calculateTemplateDuty({...ctx({lines:[l]}),category:'에콰도르',row:row()}).H,null);});
test('CO original preserved; cross-year payload unchanged',async()=>{const m=await api,r={...row(),category:'콜롬비아 장미'};assert.equal(m.applyTemplateDutyView({rows:[r]},ctx()).rows[0].calc.H,0);const p={rows:[row()]};assert.strictEqual(m.applyTemplateDutyView(p,ctx({year:'2025'})),p);});
test('AWB native allocation conserves invoice even modelled stem count differs',async()=>{const {allocateDutyFreightByAwb:f}=await allocation;for(const unit of ['단','박스']){const c={header:{freightTotalUSD:540},categories:[{allocationKey:'rose',allocationQuantity:120,allocationUnit:unit,freightUSD:540}],rows:[{warehouseDetailKey:1,freightBucketKey:'rose',freightAllocationQuantity:40,totalPriceUSD:100},{warehouseDetailKey:2,freightBucketKey:'rose',freightAllocationQuantity:80,totalPriceUSD:200}]};const a=f(c);assert.equal(a.allocations.get(1),180);assert.equal(a.allocations.get(2),360);assert.ok(a.evidence.conserved);c.rows[1].freightAllocationQuantity=0;assert.equal(f(c).allocations.get(1),null);}});
test('canonical hook and SELECT-only new loader',()=>{const s=fs.readFileSync('lib/profitTemplateDutyData.js','utf8'),a=fs.readFileSync('pages/api/sales/profit-report.js','utf8');assert.match(s,/WHERE OrderYear=@year/);assert.doesNotMatch(s,/\b(?:INSERT|UPDATE|DELETE|MERGE|CREATE TABLE)\b/);assert.match(a,/const result=await applyTemplateDutyToReport\(raw,orderYear,major,\{strict:true,latestReports,previousPayload:prior\}\)/);assert.match(s,/if\(preservesProfitMoney\(payload\)\)return payload/);});

test('numeric later subweeks preserve actual first/second duty and count each receipt once',async()=>{
 const m=await api,r=row(),lines=[line(),line({orderWeek:'02-02',warehouseDetailKey:11}),line({orderWeek:'02-03',warehouseDetailKey:12}),line({orderWeek:'02-10',warehouseDetailKey:13,actualDuty:25}),line({orderYear:'2025',orderWeek:'02-03',warehouseDetailKey:14})];
 const input={...ctx({lines}),category:r.category,row:r,customsRow:{Customs1:0,Customs2:0,Customs3:9999}};
 const before=JSON.stringify(input),d=m.calculateTemplateDuty(input);
 assert.equal(d.H,325);assert.equal(d.total,325);assert.equal(d.details.length,4);
 assert.deepEqual(d.details.map(x=>x.half),[1,2,3,10]);assert.equal(d.details[0].amount,0);
 assert.equal(JSON.stringify(input),before);assert.equal(m.calculateTemplateDuty({...input,year:'2025'}).applies,false);
 const aggregate=m.calculateTemplateDuty({...input,customsRow:{Customs1:0,Customs2:77}});
 assert.equal(aggregate.H,null);assert.ok(aggregate.missing.some(x=>x.diagnostic.failed.includes('LATER_SUBWEEK_DUTY_SCOPE_UNCONFIRMED')));
 const alreadyIncluded=row();alreadyIncluded.calc.H=125;alreadyIncluded.actualCostEvidence={components:{customs:25}};
 const included=m.calculateTemplateDuty({...input,row:alreadyIncluded,customsRow:{Customs1:0,Customs2:0},lines:[line({orderWeek:'02-03',actualDuty:25})]});
 assert.equal(included.H,125);assert.equal(included.deltaH,0);
 for(const bad of ['02-03A','02-01B','02-00','02-100']){const v=m.calculateTemplateDuty({...input,lines:[line({orderWeek:bad})]});assert.equal(v.H,null);assert.ok(v.missing.some(x=>x.diagnostic.failed.includes('UNSUPPORTED_SUBWEEK')));}
 const gap=m.calculateTemplateDuty({...input,lines:[line({orderWeek:'02-03',prodKey:999})]});assert.equal(gap.H,null);
});

test('currency inference and freight denominator diagnostics never invent missing values',async()=>{
 const m=await api,ui=await import('../lib/profitReportStatusPresentation.mjs');
 const l=line({currency:'CNY',sourceCountry:'콜롬비아',awb:'AWB-test',freightForeign:null,freightAllocationEvidence:{invoiceTotal:50,nativeTotal:50,conserved:false,buckets:[{key:'장미',amount:0,quantity:0,expectedQuantity:0,unit:'박스',complete:false,positiveGoodsWithoutQuantity:2}]}});
 const d=m.calculateTemplateDuty({...ctx({lines:[l]}),category:'에콰도르',row:row()});assert.equal(d.H,null);
 const evidence=d.missing[0],text=ui.profitDutyEvidenceDetails(evidence).join(' ');
 assert.equal(evidence.diagnostic.sourceRef.productCountry,'콜롬비아');assert.match(text,/국가 기준 추정 CNY/);assert.match(text,/총액은 일치/);assert.match(text,/배분수량이 없는 행 2개/);
 assert.doesNotMatch(text,/SQL 통화 입력이 없습니다/);
});

test('China 40cm duty freight uses exact row metrics without changing legacy arrival outputs',async()=>{
 const {computeFreightCost}=await import('../lib/freightCalc.js'),{allocateDutyFreightByAwb:f}=await allocation;
 for(const cw of [371,400]){
  const details=[
   {warehouseDetailKey:1,prodKey:1,prodName:'ROSE CHINA / Avalanche 40cm',bunchQty:90,flowerName:'장미',totalPriceUSD:675},
   {warehouseDetailKey:2,prodKey:2,prodName:'ROSE CHINA / Proud 75cm',bunchQty:210,flowerName:'장미',totalPriceUSD:5570},
   {warehouseDetailKey:3,prodKey:3,prodName:'CHINA / Gypsophila white',bunchQty:130,flowerName:'안개꽃',totalPriceUSD:2210},
   {warehouseDetailKey:4,prodKey:4,prodName:'Greens CHINA / Asparagus grass',bunchQty:70,flowerName:'기타',totalPriceUSD:1090},
  ].map(r=>({...r,counName:'중국',steamQty:r.bunchQty*10,recordedSteamQty:r.bunchQty*10,stemsPerBunch:10,outUnit:'단'}));
  const c=computeFreightCost({master:{gw:371,cw,actualFreightUSD:4269.5,exchangeRate:226.66},details});
  assert.equal(c.header.dutyFreightMetricCorrection.method,'china_40cm_exact_residual');
  const before=JSON.stringify(c),a=f(c),basis=cw===371?'GW':'CBM';
  assert.equal(JSON.stringify(c),before,'allocator does not mutate legacy output');
  assert.ok(a.evidence.conserved);assert.equal(a.evidence.correction.basis,basis);
  assert.ok(Math.abs([...a.allocations.values()].reduce((s,n)=>s+n,0)-4269.5)<1e-9);
  assert.ok(Math.abs(a.allocations.get(1)-4269.5*90*(basis==='GW'?.45:.6)/cw)<1e-9);
  assert.ok(a.evidence.nativeTotal>4269.5,'legacy over-allocation stays explicitly recorded');
  for(const mutate of [x=>x.rows[0].dutyFreightMetricQuantity=null,x=>x.rows[0].dutyFreightMetricQuantity=-1,
   x=>x.header.dutyFreightMetricCorrection.denominator+=1,x=>x.rows[0].warehouseDetailKey=x.rows[1].warehouseDetailKey,
   x=>x.header.dutyFreightMetricCorrection.basis='VALUE',x=>x.header.gw=0,
   x=>x.header.gw=x.header.cw+1,x=>x.header.cw=NaN]){
   const bad=structuredClone(c);mutate(bad);const failed=f(bad);
   assert.equal(failed.evidence.conserved,false);assert.ok([...failed.allocations.values()].every(v=>v===null));
  }
 }
});

test('non-China and no exact residual never opt into China duty correction',async()=>{
 const {computeFreightCost}=await import('../lib/freightCalc.js');
 for(const country of ['에콰도르','콜롬비아','중국']){
  const c=computeFreightCost({master:{gw:100,cw:100,actualFreightUSD:100},details:[{
   warehouseDetailKey:1,prodKey:1,prodName:country==='중국'?'ROSE CHINA / Rose 40cm':'Rose 40cm',
   counName:country,flowerName:'장미',boxQty:1,rawBoxQty:1,bunchQty:10,steamQty:100,totalPriceUSD:100}]});
  assert.equal(c.header.dutyFreightMetricCorrection,null);
 }
});

test('all legacy freight outputs match independent pre-change HEAD fixtures',async()=>{
 const {computeFreightCost}=await import('../lib/freightCalc.js');
 const fixture=JSON.parse(fs.readFileSync('__tests__/fixtures/profit-duty-legacy-freight.json','utf8'));
 assert.equal(fixture.baseline,'c0bbc84be');
 for(const {input,expected} of fixture.cases){
  const current=computeFreightCost(input);
  delete current.header.dutyFreightMetricCorrection;
  current.rows.forEach(r=>delete r.dutyFreightMetricQuantity);
  assert.deepEqual(JSON.parse(JSON.stringify(current)),expected);
 }
});

test('official China mapping is exact, dated and conditional, never broad Greens classification',async()=>{
 const m=await api,official=JSON.parse(fs.readFileSync('data/profit-official-duty-2026.json','utf8'));
 // Independently transcribed from KCS 2026 sheets 1.1 / 2.12, rows
 // 804/806 (A) and 21454/21462 (E1); not read back from policy values.
 const officialRates={'0603110000:E1':.214,'0603199000:E1':.214,'0604209000:A':.08,'0604909000:A':.08};
 assert.equal(official.sourceSha256,'BE4450BAB5DAD09A6B8278371F3C078E54AC899AA098212BD09124BFD46407C4');
 assert.equal(official.sourceUrl,'https://www.data.go.kr/data/15051179/fileData.do');
 assert.equal(official.orderYear,'2026');
 assert.equal(new Set(official.products.map(p=>p.prodKey)).size,official.products.length);
 const p={products:[],official};
 for(const product of official.products){
  assert.equal(product.country,'중국');
  assert.equal(product.effectiveFrom,'2026-01-01');assert.equal(product.effectiveTo,'2026-12-31');
  assert.ok(Object.hasOwn(officialRates,`${product.hs}:${product.rateType}`));
  assert.equal(product.rate,officialRates[`${product.hs}:${product.rateType}`]);
  const l=line({prodKey:product.prodKey,name:product.exactName,country:'중국'}),rule=m.resolveTemplateDutyRule(l,p,'2026');
  assert.equal(rule.rate,product.rate);assert.equal(rule.officialEvidence.actualDeclarationVerified,false);
  assert.equal(rule.officialEvidence.shipmentQuantityMatchVerified,false);
  for(const change of [{country:'에콰도르'},{name:'Greens arbitrary'},{orderYear:'2025'}])assert.equal(m.resolveTemplateDutyRule({...l,...change},p,'2026'),null);
  assert.equal(m.resolveTemplateDutyRule(l,p,'2027'),null);
 }
 assert.equal(m.resolveTemplateDutyRule(line({prodKey:3207,name:'Petal Use',country:'중국'}),p,'2026'),null);
 assert.equal(official.products.find(x=>x.prodKey===3120).rate,.08);
 assert.equal(official.products.find(x=>x.prodKey===3210).rate,.08);
 const pink=official.products.find(x=>x.prodKey===3212);
 assert.equal(pink.rate,.08);assert.equal(pink.matchLevel,'SAME_PRODUCT_FORM_INFERENCE');
 assert.equal(pink.observedAwbs,undefined);assert.equal(pink.declarationVerifiedForWeek29,false);
 const china=row();china.category='중국';china.currency='CNY';china.calc.R=224.22;
 const l=line({prodKey:3212,name:pink.exactName,country:'중국',category:'중국',currency:'CNY',orderWeek:'29-01',goodsForeign:1200,freightForeign:487.6155345211585});
 const retained=m.calculateTemplateDuty({year:'2026',major:'29',category:'중국',row:china,lines:[l],policy:p,customsRow:{Customs1:739050,Customs2:420110}});
 assert.equal(retained.total,1159160);assert.equal(retained.status,'actual_preserved');
 assert.ok(official.products.some(x=>/PHYLICA/i.test(x.exactName)&&x.rate===.214));
 const additions=official.products.filter(x=>x.referenceProdKey);
 assert.equal(additions.length,71);
 assert.equal(additions.filter(x=>x.hs==='0603110000').length,65);
 assert.equal(additions.filter(x=>x.matchLevel==='SAME_PRODUCT_FORM_INFERENCE').length,32);
 assert.equal(additions.filter(x=>x.matchLevel==='OFFICIAL_HS_PRODUCT_FORM_INFERENCE').length,39);
 for(const product of additions){
  assert.equal(product.observedAwbs,undefined);assert.equal(product.newDeclarationVerified,false);
  assert.ok(['SAME_PRODUCT_FORM_INFERENCE','OFFICIAL_HS_PRODUCT_FORM_INFERENCE'].includes(product.matchLevel));
  assert.equal(product.basicRate,product.rateType==='E1'?.25:.08);
  const target=line({prodKey:product.prodKey,name:product.exactName,country:'중국',category:'중국',currency:'CNY',orderWeek:'29-01'});
  const rule=m.resolveTemplateDutyRule(target,p,'2026');
  assert.equal(rule.officialEvidence.referenceProdKey,product.referenceProdKey);
  assert.equal(rule.officialEvidence.newDeclarationVerified,false);
  assert.equal(m.resolveTemplateDutyRule({...target,name:product.exactName+' Petal Use'},p,'2026'),null);
  const explicit=m.calculateTemplateDuty({year:'2026',major:'29',category:'중국',row:china,lines:[target],policy:p,customsRow:{Customs1:0,Customs2:0}});
  assert.equal(explicit.total,0);assert.equal(explicit.status,'actual_preserved');
 }
 for(const prodKey of [3207,3453,3462,2454,3351])assert.equal(m.resolveTemplateDutyRule(line({prodKey,name:'Sample Petal Use',country:'중국'}),p,'2026'),null);
});

test('only verified historical 27 China blank is restored; actual SQL zeros still dominate',async()=>{
 const m=await api,h={Customs1:1092570,Customs2:0};
 const restored=m.restoreHistoricalDutyBlank(h,'2026','27','중국');
 assert.equal(restored.Customs2,null);assert.equal(h.Customs2,0);
 assert.equal(restored.historicalDutyBlank.cell,'J10');
 const laterCorrected={...h,Customs2:100};assert.strictEqual(m.restoreHistoricalDutyBlank(laterCorrected,'2026','27','중국'),laterCorrected);
 for(const args of [['2025','27','중국'],['2026','26','중국'],['2026','27','태국']])assert.strictEqual(m.restoreHistoricalDutyBlank(h,...args),h);
 const s=fs.readFileSync('lib/profitTemplateDutyData.js','utf8');
 assert.match(s,/row\?hydrateCountrySplitColumns\(row\):restoreHistoricalDutyBlank/);
 const r=row();r.category='중국';r.currency='CNY';
 const lines=[line({country:'중국',category:'중국',currency:'CNY',orderWeek:'27-02'})];
 const p={products:[{...policy.products[0],country:'중국'}]};
 const d=m.calculateTemplateDuty({year:'2026',major:'27',category:'중국',row:r,lines,policy:p,customsRow:h});
 assert.equal(d.total,1092570);assert.equal(d.status,'actual_preserved');
 const estimated=m.calculateTemplateDuty({year:'2026',major:'27',category:'중국',row:r,lines,policy:p,customsRow:restored});
 assert.equal(estimated.total,1092870);assert.match(estimated.explanation.join(' '),/J10은 빈칸/);
});

test('older derived payload cannot double-add duty; final cache preserves separate raw donors',async()=>{
 const m=await api,legacy=await import('./fixtures/profitTemplateDutyBaseline-a6360410e.mjs');
 const raw={rows:[row()]},old=legacy.applyTemplateDutyView(raw,ctx()),before=JSON.stringify(old);
 assert.notEqual(old.rows[0].calc.H,raw.rows[0].calc.H);
 assert.throws(()=>m.applyTemplateDutyView(old,ctx()),e=>e.code==='DUTY_DERIVED_VERSION_MISMATCH');
 assert.equal(JSON.stringify(old),before);
 const current=m.applyTemplateDutyView(raw,ctx());assert.strictEqual(m.applyTemplateDutyView(current,ctx()),current);
 const orphan=structuredClone(old);delete orphan.templateDuty;
 assert.throws(()=>m.applyTemplateDutyView(orphan,ctx()),e=>e.code==='DUTY_DERIVED_VERSION_MISMATCH');
 const report=fs.readFileSync('pages/api/sales/profit-report.js','utf8');
 assert.match(report,/saveProfitCache\(options,\(major,orderYear\)=>loadCoherentLatestReport\(major,orderYear,\{forCache:true\}\)\)/);
 assert.match(report,/await loadReportData\(major,orderYear\)/);
 const confirm=fs.readFileSync('pages/api/sales/profit-report-confirm.js','utf8');
 assert.match(confirm,/await loadReportData\(major, orderYear\)/);
 assert.doesNotMatch(confirm,/loadWeeklyReportPayload|applyTemplateDuty/);
 const data=fs.readFileSync('lib/profitTemplateDutyData.js','utf8');
 assert.match(data,/payload:profitCacheSourcePayload\(value.payload\)/);
 assert.match(data,/if\(error\?\.code==='DUTY_DERIVED_VERSION_MISMATCH'\)throw error/);
});
