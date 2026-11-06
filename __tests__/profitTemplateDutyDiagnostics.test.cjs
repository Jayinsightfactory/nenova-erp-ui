const assert=require('node:assert/strict');
(async()=>{
 const current=await import('../lib/profitTemplateDuty.mjs'),baseline=await import('./fixtures/profitTemplateDutyBaseline-a6360410e.mjs');
 const ui=await import('../lib/profitReportStatusPresentation.mjs');
 const basis=(major,quantity)=>({method:'category_average',year:'2026',major,quantity,value:1200*quantity/100,average:{unitCost:12,purchaseQty:100,totalCost:1200,customsCost:0}});
 const row=(category='에콰도르')=>({category,currency:'USD',auto:{H:0},manual:{},source:{H:'actual',R:'manual_input'},customsComponents:{Customs1:0,Customs2:0},calc:{C:2000,E:120,F:240,G:1200,H:0,I:1080,J:920,K:.46,R:10,AJ:0,P:1000,T:200,Q:100,S:20},inventoryValuation:{begin:basis('42',10),end:basis('43',20)}});
 const line=(extra={})=>({prodKey:1,name:'품목 A',country:'에콰도르',category:'에콰도르',orderYear:'2026',orderWeek:'43-01',goodsForeign:100,freightForeign:20,currency:'USD',warehouseDetailKey:10,...extra});
 const ctx=()=>({year:'2026',major:'43',policy:{products:[{prodKey:1,name:'품목 A',country:'에콰도르',rate:.25,ruleIds:['source!K14']}]},lines:[line(),line({orderWeek:'42-01',warehouseDetailKey:9})],customsByWeek:{},previousPayload:{rows:[row()]}});
 // This unchanged-policy matrix keeps every amount/verdict/output field intact.
 // Only the explicit release-version bump, approved display label, and additive diagnostics
 // are normalized. Official mappings/historical blank changes have separate tests.
 assert.equal(current.TEMPLATE_DUTY_VERSION,'2026-11-06-china-v5');
 const clean=value=>Array.isArray(value)?value.map(clean):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([key])=>!['diagnostic','dutyDiagnostic'].includes(key)).map(([key,child])=>[key,key==='version'&&child===current.TEMPLATE_DUTY_VERSION?baseline.TEMPLATE_DUTY_VERSION:key==='label'&&child==='저장본 기반 관세 계산 반영 · 적용기준 상세 확인 · 원본 확정본·DB 미변경'?'저장본 기반 관세 보완(추정 포함) · 원본 확정본·DB 미변경':clean(child)])):value;
 const scenarios=[
  ()=>{},
  (p,c)=>{p.confirmed={key:7};p.confirmedTotals={C:2000,J:920};},
  (p,c)=>{c.year='2025';},
  (p,c)=>{p.rows[0].manual.H=0;},
  (p,c)=>{p.rows[0].manual.H=700;},
  (p,c)=>{c.customsByWeek={'43':{'에콰도르':{Customs1:0}}};},
  (p,c)=>{c.lines=[];},
  (p,c)=>{c.policy.products[0].rate=0;},
  (p,c)=>{c.lines[0].actualDuty=0;},
  (p,c)=>{c.lines[0].actualDuty=70;},
  (p,c)=>{c.lines.push(line({prodKey:99,warehouseDetailKey:11}));},
  (p,c)=>{c.lines[0].name='같은 키 다른 이름';},
  (p,c)=>{c.lines[0].country='태국';},
  (p,c)=>{c.lines[0].orderYear='2025';},
  (p,c)=>{c.lines[0].freightForeign=null;c.lines[0].freightAllocationEvidence={conserved:false};},
  (p,c)=>{c.lines[0].freightForeign=null;},
  (p,c)=>{c.lines[0].goodsForeign=null;c.lines[0].currency='CNY';p.rows[0].source.R='currency_master';},
  (p,c)=>{p.rows[0].calc.R=null;},
  // Numeric 03+ is an intentional policy extension, covered by the dedicated
  // per-subweek tests rather than normalized away in this parity matrix.
  (p,c)=>{delete p.rows[0].customsComponents;},
  (p,c)=>{c.sourceFailure='원천 읽기 실패';},
  (p,c)=>{p.rows[0].inventoryValuation.begin.method='product_cost';},
  (p,c)=>{p.rows[0].inventoryValuation.end.major='42';},
  (p,c)=>{p.rows[0].inventoryValuation.end.average.purchaseQty=0;},
  (p,c)=>{p.rows[0].calc.F=241;},
  (p,c)=>{p.rows[0].inventoryValuation.end={method:'no_stock',quantity:0};p.rows[0].calc.F=0;},
  (p,c)=>{p.rows[0].inventoryValuation.begin=null;},
  (p,c)=>{p.rows[0].calc.F=null;p.rows[0].inventoryValuation.end.average.customsCost=null;},
 ];
 let assertions=0;
 for(const modify of scenarios){const payload={rows:[row()]},context=ctx();modify(payload,context);const before=JSON.stringify({payload,context});const old=baseline.applyTemplateDutyView(payload,context),now=current.applyTemplateDutyView(payload,context);assert.deepEqual(clean(now),old);assert.equal(JSON.stringify({payload,context}),before);assertions++;}
 const missingOriginal={rows:[row()]},missingContext=ctx();missingOriginal.rows[0].calc.F=null;missingOriginal.rows[0].calc.H=null;missingOriginal.rows[0].auto.H=null;
 const missingResult=current.applyTemplateDutyView(missingOriginal,missingContext);
 assert.ok(!missingResult.rows[0].inventoryValuation.end.dutyDiagnostic.failed.includes('VALUATION_FORMULA_MISMATCH'));
 assert.ok(!missingResult.rows[0].inventoryValuation.end.dutyDiagnostic.failed.includes('CUSTOMS_BASIS_MISMATCH'));
 // Real-shape cases, no production amounts or identifiers: Thai policy gap,
 // Chinese product-cost opening + failed AWB conservation, Ecuador zero stock.
 for(const category of ['태국','중국','에콰도르']){
  const payload={rows:[row(category)]},context=ctx();context.previousPayload={rows:[row(category)]};
  context.policy.products[0].country=category;
  context.lines=[line({country:category,category,prodKey:99}),line({country:category,category,freightForeign:null,freightAllocationEvidence:{conserved:false}}),line({country:category,category,orderWeek:'42-01',prodKey:99})];
  if(category==='중국')payload.rows[0].inventoryValuation.begin.method='product_cost';
  if(category==='에콰도르'){payload.rows[0].inventoryValuation={begin:{method:'no_stock',quantity:0},end:{method:'no_stock',quantity:0}};payload.rows[0].calc.E=payload.rows[0].calc.F=0;}
  const now=current.applyTemplateDutyView(payload,context);assert.deepEqual(clean(now),baseline.applyTemplateDutyView(payload,context));
  assert.ok(now.rows[0].templateDuty.missing.some(m=>m.diagnostic?.failed.includes('POLICY_KEY_MISSING')));
  assert.ok(now.rows[0].templateDuty.missing.some(m=>m.diagnostic?.failed.includes('FREIGHT_ALLOCATION_NOT_CONSERVED')));
  const h=ui.profitMissingCell({row:now.rows[0],column:'H'});assert.match(h.reason,/운임 배분 대사 미통과/);assert.match(h.source.status,/DB 부재와 다름/);
  if(category==='중국')assert.ok(now.rows[0].inventoryValuation.begin.dutyDiagnostic.failed.includes('PRODUCT_COST_REQUIRES_ITEM_EVIDENCE'));
  if(category==='태국')assert.deepEqual(now.rows[0].inventoryValuation.end.dutyDiagnostic.failed,['CUSTOMS_DEPENDENCY_UNCONFIRMED']);
  assertions++;
 }
 console.log(`profit tariff diagnostics: ${assertions} before/after full-output parity scenarios PASS; new diagnostic keys only; inputs immutable`);
})().catch(error=>{console.error(error);process.exitCode=1;});
