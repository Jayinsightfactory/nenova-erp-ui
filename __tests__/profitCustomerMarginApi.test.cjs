const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');
const root=path.resolve(__dirname,'..');
async function handler(deps){
 const {parseMarginScope}=await import('../lib/profitCustomerMargin.mjs');
 const source=fs.readFileSync(path.join(root,'pages/api/sales/profit-customer-margin.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export function createProfitCustomerMarginHandler','function createProfitCustomerMarginHandler').replace(/export default withAuth\(createProfitCustomerMarginHandler\(\)\);/,'this.factory=createProfitCustomerMarginHandler;');
 const context={parseMarginScope,loadProfitCustomerMargin:()=>{throw Error('unexpected real query')},loadProfitCustomerMarginReconciliation:()=>{throw Error('unexpected diagnostic query')},previousMarginScope:()=>{throw Error('unexpected real query')}};vm.runInNewContext(source,context);return context.factory(deps);
}
const response=()=>({headers:{},status(code){this.code=code;return this;},setHeader(k,v){this.headers[k]=v;},json(body){this.body=body;return this;}});
test('compact reconciliation validates same scope/calendar and avoids full cost loader',async()=>{
 let full=0,compact=0,calendar=0;
 const h=await handler({load:()=>{full++;},previous:async(c,p)=>{calendar++;return p||{year:'2025',major:'53'};},reconcile:async(c,p)=>{compact++;return{ok:true,view:'reconciliation',current:c,previous:p,metadata:{readOnly:true}};}});
 const r=response();await h({method:'GET',query:{year:'2026',week:'01',view:'reconciliation'}},r);
 assert.equal(r.code,200);assert.equal(r.body.previous.year,'2025');assert.equal(full,0);assert.equal(compact,1);assert.equal(calendar,1);
 for(const view of [['reconciliation'],'all','']) {const r=response();await h({method:'GET',query:{year:'2026',week:'01',view}},r);assert.equal(r.code,400);}
 const invalid=response();await h({method:'GET',query:{year:'2026',week:'01',view:'reconciliation',compareWeek:'53'}},invalid);assert.equal(invalid.code,400);
 assert.equal(compact,1);assert.equal(calendar,1);
});
test('nonGET rejected before any source reads or writes',async()=>{let reads=0;const h=await handler({load:()=>{reads++}});for(const method of ['POST','PUT','DELETE']){const r=response();await h({method,query:{}},r);assert.equal(r.code,405);}assert.equal(reads,0);});
test('invalid scope and partial comparison rejected before loader',async()=>{let reads=0;const h=await handler({load:()=>{reads++}});for(const query of [{week:'39'},{year:'2026',week:['39']},{year:'2026',week:'39',compareWeek:'38'}]){const r=response();await h({method:'GET',query},r);assert.equal(r.code,400);}assert.equal(reads,0);});
test('cross-year comparison stays explicit; real calendar used instead of hardcoded52',async()=>{const calls=[];const h=await handler({previous:async scope=>({year:'2025',major:'53'}),load:async(c,p)=>{calls.push([c,p]);return{ok:true,metadata:{readOnly:true}}}});const r=response();await h({method:'GET',query:{year:'2026',week:'01'}},r);assert.equal(r.code,200);assert.equal(calls[0][0].year,'2026');assert.equal(calls[0][1].year,'2025');assert.equal(calls[0][1].major,'53');assert.equal(r.headers['Cache-Control'],'private, no-store');});
test('explicit previous scope is calendar validated, future comparison rejected',async()=>{let reads=0,validated=0;const h=await handler({previous:async(c,p)=>{validated++;assert.equal(p.major,'37');return p;},load:async(c,p)=>{reads++;assert.equal(p.major,'37');return{ok:true}}});let r=response();await h({method:'GET',query:{year:'2026',week:'39',compareYear:'2026',compareWeek:'37'}},r);assert.equal(r.code,200);r=response();await h({method:'GET',query:{year:'2026',week:'39',compareYear:'2027',compareWeek:'01'}},r);assert.equal(r.code,400);assert.equal(reads,1);assert.equal(validated,1);});
test('production SQL is year-scoped, read-only, no report refresh/legacy last-price cost fallback',()=>{
 const data=fs.readFileSync(path.join(root,'lib/profitCustomerMarginData.js'),'utf8');
 assert.match(data,/sm\.OrderYear=@yr AND sm\.OrderWeek LIKE @pfx AND sm\.OrderYearWeek=@yw/);
 assert.match(data,/sd\.isFix,0\)=1/);assert.match(data,/sm\.CustKey/);assert.doesNotMatch(data,/sd\.CustKey|e\.CustKey/);
 assert.doesNotMatch(data,/saveProfit|insertSnapshot|ensure\w*Table|loadReportData\(|autoStockUnitPrices|carriedAcquisitionPriceEvidenceByProduct|fifoPurchaseLayersByProduct|\.execute\(|\.batch\(|new sql\.Transaction/);
 assert.match(data,/rowCount\)===rows\.length/);assert.match(data,/historicalFx/);assert.match(data,/receiptComplete=complete/);
 const api=fs.readFileSync(path.join(root,'pages/api/sales/profit-customer-margin.js'),'utf8');assert.match(api,/export default withAuth\(createProfitCustomerMarginHandler\(\)\)/);
});
test('calendar keeps year-boundary dates and validates explicit period existence',async()=>{
 const source=fs.readFileSync(path.join(root,'lib/profitCustomerMarginData.js'),'utf8');
 const functionSource=source.slice(source.indexOf('export async function previousMarginScope'),source.indexOf('\nasync function salesRows')).replace('export async','async');
 let statement;const context={sql:{NVarChar:'nvarchar'},read:async q=>{statement=q;return[
  {yw:'202553',startDate:'2025-12-30',endDate:'2026-01-05'},
  {yw:'202601',startDate:'2026-01-06',endDate:'2026-01-12'},
 ];}};vm.runInNewContext(functionSource+';this.resolve=previousMarginScope;',context);
 const result=await context.resolve({year:'2026',major:'01'});assert.equal(result.year,'2025');assert.equal(result.major,'53');
 assert.doesNotMatch(statement,/YEAR\(TRY_CONVERT/);
 await assert.rejects(()=>context.resolve({year:'2026',major:'01'},{year:'2025',major:'52'}),/업무 달력/);
});
test('SQL runtime guard rejects mutations/SP/DDL and accepts only SELECT/CTE',()=>{
 const source=fs.readFileSync(path.join(root,'lib/profitCustomerMarginData.js'),'utf8');
 const functionSource=source.slice(source.indexOf('export function assertMarginReadSql'),source.indexOf('\nasync function read')).replace('export function','function');
 const context={};vm.runInNewContext(functionSource+';this.guard=assertMarginReadSql;',context);
 context.guard('SELECT * FROM Product WHERE ProdKey=@pk');context.guard('WITH q AS (SELECT 1 x) SELECT x FROM q');
 for(const query of ['UPDATE Product SET Stock=0','SELECT 1; DELETE Product','EXEC usp_StockCalculation','SELECT * INTO temp FROM Product','CREATE TABLE x(a INT)','BEGIN TRAN'])assert.throws(()=>context.guard(query));
});

test('reconciliation separates proven current classification effect from unproven historical cause',async()=>{
 const {buildMarginReconciliation}=await import('../lib/profitCustomerMarginReconciliation.mjs');
 const stored={source:'stored',asOf:'2026-10-20',rows:[{category:'A',calc:{N:100,L:0,O:0}},{category:'B',calc:{N:0,L:0,O:0}}],totals:{N:100,L:0,O:0}};
 const rows=[{category:'B',baseCategory:'A',prodKey:42,kind:'N',amount:100,sourceYear:'2026',sourceWeek:'39-01',sourceYearWeek:'202639',sourceTable:'ShipmentDetail'}];
 const input={asOf:'2026-10-27',periods:[{side:'current',scope:{year:'2026',major:'39'},rows,stored}]};
 const before=JSON.stringify(input),result=buildMarginReconciliation(input);
 assert.equal(JSON.stringify(input),before);assert.equal(result.summaries[0].totals[0].delta,0);
 assert.equal(result.summaries[0].interpretation,'CATEGORY_REDISTRIBUTION_CANDIDATE');
 const diff=result.entries.filter(r=>r.status==='different');assert.equal(diff.length,2);
 assert(diff.every(r=>r.reason==='CURRENT_CLASSIFICATION_EXPLAINS_DELTA'));
 assert.deepEqual(diff.map(r=>r.delta),[-100,100]);assert.equal(result.summaries[0].classificationEffects[0].amount,100);
 assert.equal(result.summaries[0].observedScopes[0].rawYearWeek,'202639');
 assert.equal(result.summaries[0].storedAt,'2026-10-20');assert.equal(result.atomicSnapshot,false);
 rows[0].baseCategory='B';const unresolved=buildMarginReconciliation(input);
 assert(unresolved.entries.filter(r=>r.status==='different').every(r=>r.reason==='SOURCE_COMPARISON_REQUIRED'));
});
test('reconciliation does not silently omit SQL-only category, NULL money, total mismatch, or cross-year comparison',async()=>{
 const {buildMarginReconciliation}=await import('../lib/profitCustomerMarginReconciliation.mjs');
 const stored={source:'confirmed',asOf:'2026-01-01',rows:[{category:'A',calc:{N:0,L:0,O:0}}],totals:{N:0,L:0,O:0}};
 const periods=[{side:'current',scope:{year:'2026',major:'01'},stored,rows:[{category:'B',kind:'N',amount:50}]},
 {side:'previous',scope:{year:'2025',major:'53'},stored,rows:[{category:'A',kind:'N',amount:null}]}];
 const result=buildMarginReconciliation({periods});
 const only=result.entries.find(r=>r.side==='current'&&r.category==='B'&&r.column==='N');
 assert.equal(only.delta,null);assert.equal(only.reason,'STORED_CATEGORY_MISSING');assert.equal(only.sqlValue,50);
 const missing=result.entries.find(r=>r.side==='previous'&&r.column==='N');assert.equal(missing.sqlValue,null);assert.equal(missing.reason,'SQL_AMOUNT_MISSING');assert.equal(missing.year,'2025');
 assert.equal(result.summaries[0].totals[0].delta,50);assert.equal(result.summaries[0].status,'different');
 assert.equal(result.summaries[1].totals[0].delta,null);assert.equal(result.summaries[1].status,'incomplete');
 assert.equal(result.entries.find(r=>r.column==='L').delta,0);
});
test('each request captures one fresh category map; compact loader skips cost, adjustments and cache refresh',async()=>{
 const data=fs.readFileSync(path.join(root,'lib/profitCustomerMarginData.js'),'utf8');
 const functionSource=data.slice(data.indexOf('function marginClassification'),data.indexOf('\nconst WEIGHT'));
 let label='A',loads=0;
 const context={BASE_CATEGORY:'base',ALLOWED_CATEGORIES:['A','B'],loadProfitCategoryOverrides:force=>{assert.equal(force,true);loads++;return{42:{category:label,savedBy:'private-user'}};},buildProfitOverrideCaseSqlFromMap:(b,a,c,map)=>JSON.stringify(map),createHash:require('node:crypto').createHash};
 vm.runInNewContext(functionSource+';this.classify=marginClassification;',context);
 const a=context.classify();label='B';const b=context.classify();assert.notEqual(a.sql,b.sql);assert.notEqual(a.evidence.fingerprint,b.evidence.fingerprint);assert.equal(loads,2);assert.doesNotMatch(JSON.stringify(b),/private-user/);
 const compact=data.slice(data.indexOf('export async function loadProfitCustomerMarginReconciliation'),data.indexOf('\nexport async function loadProfitCustomerMargin('));
 assert.doesNotMatch(compact,/productCostBasis|historicalArrival|StockHistory|loadProfitCustomerMargin\(/);
 assert.match(compact,/salesRows\(current,classification\)/);assert.match(compact,/salesRows\(previous,classification\)/);
 assert.match(data,/AS BaseCategory/);assert.match(data,/AS SourceYearWeek/);
});
test('N/L/O total uses existing workbook scope; 38차 unclassified 41818원 is not a false warning',async()=>{
 const {buildMarginReconciliation}=await import('../lib/profitCustomerMarginReconciliation.mjs');
 const rows=[{category:'태국',kind:'O',amount:-464546},{category:'기타(미분류)',kind:'O',amount:41818},{category:'국내',kind:'N',amount:200}];
 const stored={source:'stored',rows:[{category:'태국',calc:{N:0,L:0,O:-464546}},{category:'기타(미분류)',calc:{N:0,L:0,O:41818}},{category:'국내',calc:{N:200,L:0,O:0}}],totals:{N:0,L:0,O:-464546}};
 const result=buildMarginReconciliation({periods:[{side:'previous',scope:{year:'2026',major:'38'},rows,stored}]});
 assert.equal(result.summaries[0].status,'match');const o=result.summaries[0].totals.find(r=>r.column==='O');
 assert.equal(o.sqlValue,-464546);assert.equal(o.allSqlValue,-422728);assert.equal(o.excludedSqlValue,41818);assert.equal(o.delta,0);
 assert.equal(result.entries.find(r=>r.category==='기타(미분류)'&&r.column==='O').sqlValue,41818);
});
