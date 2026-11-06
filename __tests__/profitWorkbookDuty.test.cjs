const test=require('node:test'),assert=require('node:assert/strict');
const api=import('../lib/profitTemplateDuty.mjs');
const line={prodKey:3212,name:'ASPARAGUS CHINA Preserved Pink',country:'중국',category:'중국',orderYear:'2026',orderWeek:'29-01',goodsForeign:100,freightForeign:20,currency:'CNY',warehouseDetailKey:10};
const direct={prodKey:3212,exactName:line.name,country:'중국',rate:.25,matchLevel:'DIRECT_WORKBOOK_FORMULA',source:{sheet:'29-1 CLOUD',cells:['B25','K25']}};
const policy={products:[],official:{orderYear:'2026',products:[{...direct,rate:.08,effectiveFrom:'2026-01-01',effectiveTo:'2026-12-31'}]},workbook:{orderYear:'2026',products:[direct],exceptions:[{...direct,orderWeek:'27-02',rate:.214}]}};
test('direct workbook beats general inference, exact week exception beats product default',async()=>{
 const m=await api;assert.equal(m.resolveTemplateDutyRule(line,policy,'2026').rate,.25);
 const d=m.resolveTemplateDutyRule({...line,orderWeek:'27-02'},policy,'2026');assert.equal(d.rate,.214);assert.equal(d.workbookEvidence.scope,'exact_receipt_week');
 assert.equal(m.resolveTemplateDutyRule({...line,orderWeek:'27-2'},policy,'2026').rate,.214);
 assert.equal(m.resolveTemplateDutyRule({...line,orderWeek:'27-02B'},policy,'2026').rate,.25);
 assert.equal(m.resolveTemplateDutyRule({...line,orderWeek:'28-02'},policy,'2026').rate,.25);
});
test('fingerprint, year, AWB and contradictory-source guards',async()=>{
 const m=await api;
 for(const extra of [{name:'ASPARAGUS CHINA Fresh Pink'},{country:'태국'},{orderYear:'2025'},{prodKey:999}])assert.equal(m.resolveTemplateDutyRule({...line,...extra},policy,'2026'),null);
 assert.equal(m.resolveTemplateDutyRule(line,policy,'2027'),null);
 const scoped=structuredClone(policy);scoped.workbook.exceptions[0].awb='known';
 assert.equal(m.resolveTemplateDutyRule({...line,orderWeek:'27-02',awb:'other'},scoped,'2026').rate,.25);
 assert.equal(m.resolveTemplateDutyRule({...line,orderWeek:'27-02',awb:'known'},scoped,'2026').rate,.214);
 const conflict=structuredClone(policy);conflict.workbook.products.push({...direct,rate:.08});assert.equal(m.resolveTemplateDutyRule(line,conflict,'2026'),null);
});
test('workbook never overrides actual zero or manual and preserves missing FX/freight',async()=>{
 const m=await api,row={category:'중국',currency:'CNY',calc:{H:100,R:10},manual:{},source:{R:'manual_input'},actualCostEvidence:{components:{customs:0}}};
 const ctx={year:'2026',major:'29',category:'중국',row,policy,lines:[line]};
 const before=JSON.stringify(ctx);const d=m.calculateTemplateDuty(ctx);assert.equal(d.H,400);assert.equal(d.total,300);assert.equal(d.details[0].workbookEvidence.actualDeclarationVerified,false);assert.equal(JSON.stringify(ctx),before);
 for(const actual of [0,20]){assert.equal(m.calculateTemplateDuty({...ctx,lines:[{...line,actualDuty:actual}]}).H,100+actual);assert.equal(m.calculateTemplateDuty({...ctx,customsRow:{Customs1:actual}}).H,100+actual);}
 assert.equal(m.calculateTemplateDuty({...ctx,row:{...row,manual:{H:0}}}).H,0);
 for(const extra of [{freightForeign:null},{currency:'USD'}])assert.equal(m.calculateTemplateDuty({...ctx,lines:[{...line,...extra}]}).H,null);
 assert.equal(m.calculateTemplateDuty({...ctx,row:{...row,source:{R:'currency_master'}}}).H,null);
});
test('v3 derived inputs fail closed rather than skipping new rules or double adding',async()=>{
 const m=await api;assert.equal(m.TEMPLATE_DUTY_VERSION,'2026-11-06-china-v5');
 const old={templateDuty:{version:'2026-11-03-v3'},rows:[]},before=JSON.stringify(old);
 assert.throws(()=>m.applyTemplateDutyView(old,{year:'2026',major:'27',policy}),e=>e.code==='DUTY_DERIVED_VERSION_MISMATCH'&&e.statusCode===409);
 assert.equal(JSON.stringify(old),before);
});
test('runtime workbook registry has dated exact provenance and independent known exceptions',async()=>{
 const m=await api,fs=require('node:fs'),w=JSON.parse(fs.readFileSync('data/profit-workbook-duty-2026.json','utf8'));
 assert.equal(w.orderYear,'2026');assert.equal(w.actualPaymentCertified,false);assert.equal(w.certificateOfOriginVerified,false);
 const seen=new Set();for(const p of w.products){assert.ok(!seen.has(p.prodKey));seen.add(p.prodKey);}
 for(const p of [...w.products,...w.exceptions]){
  assert.ok(['중국','태국'].includes(p.country));assert.ok([.05,.08,.214,.25].includes(p.rate));assert.notEqual(p.rate,.032);
  assert.match(p.source.fileSha256,/^[0-9a-f]{64}$/);assert.ok(p.source.sheet&&p.source.cells.length>=2);assert.equal(p.actualDeclarationVerified,false);
  assert.doesNotMatch(p.exactName,/sample/i);
 }
 const registry={products:[],workbook:w};
 for(const [key,week,expected] of [[3075,'17-01',.214],[3086,'17-01',.214],[3087,'17-01',.214],[3088,'17-01',.214],[3089,'17-01',.214],[3210,'27-02',.214],[3210,'28-02',.214],[3120,'32-02',.214],[3212,'29-01',.25],[3210,'29-02',.25]]){
  const p=w.products.find(p=>p.prodKey===key);assert.ok(p);assert.equal(m.resolveTemplateDutyRule({prodKey:key,name:p.exactName,country:p.country,orderYear:'2026',orderWeek:week},registry,'2026').rate,expected);
 }
 for(const key of [3211,3384]){const p=w.products.find(p=>p.prodKey===key);assert.equal(p.rate,.25);assert.equal(p.matchLevel,'USER_APPROVED_SAME_FORM');assert.equal(p.referenceProdKey,3212);}
 for(const key of [2845,623,3473,3497,2173]){const p=w.products.find(p=>p.prodKey===key);assert.equal(p.rate,.05);assert.equal(p.matchLevel,'USER_APPROVED_SAME_CULTIVAR_SIZE');const r=m.resolveTemplateDutyRule({prodKey:key,name:p.exactName,country:p.country,orderYear:'2026',orderWeek:'39-01'},registry,'2026');assert.equal(r.workbookEvidence.referenceProdKey,p.referenceProdKey);assert.equal(r.workbookEvidence.condition,p.condition);assert.equal(r.workbookEvidence.sourceOrderWeek,p.sourceOrderWeek);assert.equal(r.workbookEvidence.actualDeclarationVerified,false);}
 for(const key of [653,1123,656,3219,3239,3238,3295])assert.ok(!w.products.some(p=>p.prodKey===key),'additional Thai forms are scoped only');
 assert.ok(!w.exceptions.some(p=>p.source.sheet==='21-2 MEL '&&p.source.cells.includes('K30')),'wrong next-row reference excluded');
 for(const p of w.exceptions){assert.equal(p.observedInSourceWeek,true);assert.match(p.orderWeek,/^\d{2}-\d{2}$/);}
});
