const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');
const root=path.resolve(__dirname,'..');
async function handler(deps){
 const {parseMarginScope}=await import('../lib/profitCustomerMargin.mjs');
 const source=fs.readFileSync(path.join(root,'pages/api/sales/profit-customer-margin.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export function createProfitCustomerMarginHandler','function createProfitCustomerMarginHandler').replace(/export default withAuth\(createProfitCustomerMarginHandler\(\)\);/,'this.factory=createProfitCustomerMarginHandler;');
 const context={parseMarginScope,loadProfitCustomerMargin:()=>{throw Error('unexpected real query')},previousMarginScope:()=>{throw Error('unexpected real query')}};vm.runInNewContext(source,context);return context.factory(deps);
}
const response=()=>({headers:{},status(code){this.code=code;return this;},setHeader(k,v){this.headers[k]=v;},json(body){this.body=body;return this;}});
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
