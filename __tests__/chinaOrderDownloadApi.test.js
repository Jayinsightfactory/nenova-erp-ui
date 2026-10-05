import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {createChinaOrderDownloadHandler} from '../lib/chinaOrderDownloadApi.js';
const periods=['202551','202552','202553','202601','202602','202603','202604','202605'].map((OrderYearWeek,i)=>({OrderYearWeek,WeekDay:5,BaseYmd:new Date(Date.UTC(2025,11,11+i*7)).toISOString().slice(0,10)}));
const record={OrderYear:'2026',OrderWeek:'01-02',CustKey:1,CustName:'업체',CustOrderCode:'CL2',OrderCode:'OLD',CustCode:'OTHER',ProdKey:9,ProdCode:'0009',ProdName:'품목',FlowerName:'기타',CounName:'중국',OutUnit:'단',OutQuantity:48,BunchOf1Box:16,SteamOf1Box:80};
const types={NVarChar:n=>`nvarchar(${n})`};
function setup({rows=[record],calendar=periods,hidden=0,fail=false,productFail=false,errorMessage='secret-database-string'}={}){
 const calls=[];const handler=createChinaOrderDownloadHandler({types,now:()=>new Date('2026-01-01T16:00:00Z'),queryFn:async(q,p)=>{
  calls.push({q,p});if(fail)throw Error(errorMessage);
  if(q.includes('FROM PeriodDay'))return {recordset:calendar};
  if(q.includes('COUNT_BIG'))return {recordset:[{HiddenCount:hidden}]};
  if(q.includes('FROM Product WHERE')){if(productFail)throw Error('catalog failure');return {recordset:[record]};}
  return {recordset:rows};
 }});
 const res={code:0,headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(v){this.body=v;return this;}};
 return {calls,handler,res};
}
test('GET seven explicit scopes and native current in KST, all read-only',async()=>{
 const s=setup();await s.handler({method:'GET',query:{}},s.res);assert.equal(s.res.code,200);assert.equal(s.res.body.readOnly,true);assert.equal(s.res.body.scope.majorWeek,'01');assert.equal(s.res.body.products.length,1);assert.equal(s.calls.length,4);
 const params=s.calls[1].p;assert.equal(params.year0.value,'2025');assert.equal(params.week0.value,'51-%');assert.equal(params.year3.value,'2026');assert.equal(params.week3.value,'01-%');
 for(const {q}of s.calls)assert.doesNotMatch(q,/\b(?:UPDATE|INSERT|DELETE|CREATE|ALTER|DROP|EXEC)\b/);
 assert.equal(s.res.headers['Cache-Control'],'private, no-store');
 assert.equal(s.res.body.orders[0].custOrderCode,'CL2');
 assert.equal(s.res.body.orders[0].bunchOf1Box,16);assert.equal(s.res.body.orders[0].steamOf1Box,80);
 assert.equal(s.res.body.products[0].bunchOf1Box,16);
 assert.match(s.calls[1].q,/p.BunchOf1Box,p.SteamOf1Box/);
 assert.match(s.calls[1].q,/c.OrderCode AS CustOrderCode/);
 assert.match(s.calls[1].q,/JOIN Customer c ON c.CustKey=v.CustKey AND c.isDeleted=0/);
});
test('missing customer CL is not replaced with order code or internal key',async()=>{
 const s=setup({rows:[{...record,CustOrderCode:null}]});await s.handler({method:'GET',query:{}},s.res);
 assert.equal(s.res.code,200);assert.equal(s.res.body.orders[0].custOrderCode,'');assert.match(s.res.body.warnings[0],/업체 주문코드\(CL\).*1곳/);
});
test('missing and zero master box factors remain distinct raw values without a fallback',async()=>{
 const s=setup({rows:[{...record,BunchOf1Box:0,SteamOf1Box:null}]});await s.handler({method:'GET',query:{}},s.res);
 assert.equal(s.res.code,200);assert.equal(s.res.body.orders[0].bunchOf1Box,0);assert.equal(s.res.body.orders[0].steamOf1Box,null);assert.equal(s.res.body.orders[0].quantity,48);
});
test('invalid incomplete and write requests run zero queries',async()=>{
 for(const req of [{method:'POST',query:{}},{method:'GET',query:{year:2026}},{method:'GET',query:{year:'2026 OR 1=1',majorWeek:'01'}}]){
  const s=setup();await s.handler(req,s.res);assert.ok([400,405].includes(s.res.code));assert.equal(s.calls.length,0);
 }
});
test('hidden native rows are explicit warning, no repair',async()=>{
 const s=setup({hidden:2});await s.handler({method:'GET',query:{year:2026,majorWeek:1}},s.res);assert.equal(s.res.code,200);assert.match(s.res.body.warnings[0],/2행/);
});
test('partial failures, missing calendar, foreign scope and invalid units cannot export',async()=>{
 for(const options of [{fail:true},{productFail:true},{calendar:periods.slice(3)},{rows:[{...record,OrderYear:'2025',OrderWeek:'01-01'}]},{rows:[{...record,OutUnit:''}]},{rows:[{...record,CounName:'콜롬비아'}]}]){
  const s=setup(options);await s.handler({method:'GET',query:{}},s.res);assert.notEqual(s.res.code,200);assert.equal(s.res.body.success,false);assert.equal(s.res.body.orders,undefined);assert.doesNotMatch(s.res.body.error,/secret-database-string/);
 }
});
test('API has authentication wrapper and no write handler',()=>{
 const api=fs.readFileSync(new URL('../pages/api/stats/china-order-download.js',import.meta.url),'utf8');assert.match(api,/withAuth\(createChinaOrderDownloadHandler/);assert.doesNotMatch(api,/withTransaction|apiPost/);
});
test('unexpected driver message containing validation words is masked in response and logs',async()=>{
 const old=console.error,messages=[];console.error=(...args)=>messages.push(args.join(' '));
 try{const s=setup({fail:true,errorMessage:'단위 SQL connection secret=password'});await s.handler({method:'GET',query:{}},s.res);assert.equal(s.res.code,500);assert.doesNotMatch(s.res.body.error,/SQL|secret|password/);assert.doesNotMatch(messages.join('\n'),/SQL|secret|password/);}finally{console.error=old;}
});
