import assert from 'node:assert/strict';
import fs from 'node:fs';
import {normalizeWeekdayConfirmationScope,buildWeekdayConfirmationSummary,validateWeekdayConfirmationResponse,WEEKDAY_CONFIRMATION_SQL} from '../lib/weekdayConfirmation.js';
import { WEEKDAY_DETAIL_CUSTOMER_MATCH_SQL } from '../lib/weekdayCustomerLink.js';

assert.deepEqual(normalizeWeekdayConfirmationScope({year:'2026',majorWeek:8}),{year:2026,majorWeek:'08',allCustomers:true});
for(const input of [{majorWeek:39},{year:2026,majorWeek:0},{year:2026,majorWeek:54},{year:2026,majorWeek:'39-%'},{year:['2026','2025'],majorWeek:39}]) assert.throws(()=>normalizeWeekdayConfirmationScope(input));
const scope={year:2026,majorWeek:'39'};
const fixture=(week,cf,total,fixed,more={})=>({OrderYear:2026,OrderWeek:week,CountryFlower:cf,TotalCount:total,FixedCount:fixed,UnknownCount:0,...more});
const rows=[fixture('39-01','콜롬비아장미',3,3),fixture('39-02','콜롬비아장미',2,1),fixture('39-03','콜롬비아장미',1,0),fixture('39-01','콜롬비아수국',2,2),
  fixture('39-01','prior sentinel',999,999,{OrderYear:2025}),fixture('40-01','other main',999,999)];
const partial=buildWeekdayConfirmationSummary(scope,rows);
assert.equal(partial.state,'PARTIAL');assert.equal(partial.totalCount,8);assert.equal(partial.fixedCount,6);
const rose=partial.categories.find(item=>item.countryFlower==='콜롬비아장미');
assert.deepEqual(rose.orderWeeks,['39-01','39-02','39-03']);assert.equal(rose.state,'PARTIAL');assert.equal(rose.totalCount,6);
assert.equal(partial.categories.find(item=>item.countryFlower==='콜롬비아수국').state,'FIXED');
assert.equal(buildWeekdayConfirmationSummary(scope,rows.filter(row=>row.OrderYear===2025)).state,'EMPTY');
assert.equal(buildWeekdayConfirmationSummary(scope,[fixture('39-01','장미',4,0)]).state,'UNFIXED');
assert.equal(buildWeekdayConfirmationSummary(scope,[fixture('39-01','장미',4,4)]).state,'FIXED');
for(const [fixed,state] of [[4,'FIXED'],[2,'PARTIAL'],[0,'UNFIXED']]) {
  const warned=buildWeekdayConfirmationSummary(scope,[fixture('39-01','장미',4,fixed,{UnknownCount:1})]);
  assert.equal(warned.state,state);assert.equal(warned.unknownCount,0);assert.equal(warned.warningCount,1);
  assert.equal(warned.categories[0].warningCount,1);
  validateWeekdayConfirmationResponse(scope,{success:true,readOnly:true,summary:warned});
}
const productionShape=buildWeekdayConfirmationSummary(scope,[fixture('39-01','카네이션',998,998,{UnknownCount:606})]);
assert.equal(productionShape.state,'FIXED');assert.equal(productionShape.warningCount,606);
assert.equal(buildWeekdayConfirmationSummary(scope,[fixture('39-01','',1,1)]).state,'UNKNOWN');
for(const week of ['39-1','39-AB','39-001']) assert.throws(()=>buildWeekdayConfirmationSummary(scope,[fixture('39-01','장미',4,4),fixture(week,'장미',1,0)]),/세부차수/);
for(const patch of [{FixedCount:5},{FixedCount:null},{TotalCount:1.5},{UnknownCount:-1}]) assert.throws(()=>buildWeekdayConfirmationSummary(scope,[fixture('39-01','장미',4,4,patch)]));
const result={success:true,readOnly:true,summary:partial};
assert.equal(validateWeekdayConfirmationResponse(scope,result),partial);
for(const mutation of [{...result,readOnly:false},{...result,summary:{...partial,year:2025}},{...result,summary:{...partial,majorWeek:'40'}},{...result,summary:{...partial,allCustomers:false}},{...result,summary:{...partial,state:'FIXED'}},{...result,summary:{...partial,fixedCount:8}},{...result,summary:{...partial,warningCount:9}},{...result,summary:{...partial,categories:[...partial.categories,rose]}}]) assert.throws(()=>validateWeekdayConfirmationResponse(scope,mutation));
assert.match(WEEKDAY_CONFIRMATION_SQL,/sm.OrderYear=@year AND sm.OrderWeek LIKE @weekPrefix/);
assert.match(WEEKDAY_CONFIRMATION_SQL,/ISNULL\(sd.isFix,0\)=1/);
assert.match(WEEKDAY_CONFIRMATION_SQL,/sd.OutQuantity>0/);
assert.ok(WEEKDAY_CONFIRMATION_SQL.includes(WEEKDAY_DETAIL_CUSTOMER_MATCH_SQL));
assert.match(WEEKDAY_CONFIRMATION_SQL,/LEFT JOIN Customer c ON c\.CustKey=sm\.CustKey AND ISNULL\(c\.isDeleted,0\)=0/);
assert.doesNotMatch(WEEKDAY_CONFIRMATION_SQL,/@custKey|@prodKey|\b(?:INSERT|UPDATE|DELETE|MERGE|EXEC|ALTER|CREATE|DROP)\b/i);
// Execute the actual API with a SELECT-only adapter: supplied customer/product filters
// cannot narrow the main-week all-customer confirmation scope.
const api=fs.readFileSync(new URL('../pages/api/estimate/weekday-confirmation.js',import.meta.url),'utf8');
let calls=0,fail=false;
globalThis.__weekdayConfirmationFixture={sql:{NVarChar:size=>`nvarchar${size}`},withAuth:handler=>handler,
  normalizeWeekdayConfirmationScope,buildWeekdayConfirmationSummary,WEEKDAY_CONFIRMATION_SQL,
  query:async(sql,params)=>{calls++;assert.equal(sql,WEEKDAY_CONFIRMATION_SQL);assert.equal(params.year.value,'2026');assert.equal(params.weekPrefix.value,'39-%');if(fail)throw Error('fixture read failure');return {recordset:rows};}};
const executable=`const {query,sql,withAuth,normalizeWeekdayConfirmationScope,buildWeekdayConfirmationSummary,WEEKDAY_CONFIRMATION_SQL}=globalThis.__weekdayConfirmationFixture;\n${api.replace(/^import[^\n]*\n/gm,'')}`;
const {default:handler}=await import(`data:text/javascript;base64,${Buffer.from(executable).toString('base64')}`);
async function invoke(method='GET',query={year:2026,majorWeek:39,custKey:533,prodKey:866}) {
  let code=200,body,headers={};const res={setHeader(k,v){headers[k]=v;},status(v){code=v;return this;},json(v){body=v;return this;},end(){return this;}};
  await handler({method,query},res);return {code,body,headers};
}
const response=await invoke();assert.equal(response.code,200);assert.deepEqual(response.body.summary,partial);assert.equal(response.headers['Cache-Control'],'no-store');assert.equal(calls,1);
assert.equal((await invoke('POST')).code,405);assert.equal(calls,1);
assert.equal((await invoke('GET',{majorWeek:39})).code,400);assert.equal(calls,1);
fail=true;const original=console.error;console.error=()=>{};try {assert.equal((await invoke()).code,500);} finally {console.error=original;}
delete globalThis.__weekdayConfirmationFixture;
console.log('weekday confirmation: full/partial/unfixed/unknown/empty, all-subcycles/all-customers, cross-year sentinel, invalid counts/scope, read-only API/method/error passed');
