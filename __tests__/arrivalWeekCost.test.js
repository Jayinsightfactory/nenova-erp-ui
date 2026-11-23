import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {prepareArrivalWeekCost,calculateArrivalWeekCost,allocateWeekExpenses} from '../lib/arrivalWeekCost.js';
import {createArrivalWeekCostHandler} from '../lib/arrivalWeekCostHttp.js';
import {createArrivalWeekCostWorkbook} from '../lib/arrivalWeekCostWorkbook.js';
const types={Int:1,NVarChar:n=>n};
const scope={country:'CN',orderYear:'2026',orderWeek:'45-03'};
const row=(key,extra={})=>({WarehouseKey:key,OrderYear:'2026',OrderWeek:'45-03',OrderNo:key===1?'784-69519262':'78469519730',FarmName:'Cloudland',InvoiceNo:`TEST_ONLY-${key}`,FileName:`TEST_ONLY-${key}.xlsx`,InputDate:'2026-11-13',WdetailKey:key*10,ProdKey:2265,OrderCode:'1',ProdName:'ROSE CHINA TEST_ONLY',CounName:'중국',FlowerName:'장미',OutUnit:'단',BoxQuantity:1,BunchQuantity:10,SteamQuantity:100,OutQuantity:10,SteamOf1Bunch:10,SteamOf1Box:100,UPrice:2,TPrice:20,...extra});
const read=(rows,request={...scope,selectedKeys:[1,2]})=>prepareArrivalWeekCost({types,request,queryFn:async(sql,params)=>{assert.doesNotMatch(sql,/\b(INSERT|UPDATE|DELETE|EXEC|MERGE)\b/i);assert.equal(params.orderYear?.value??'2026','2026');return {recordset:sql.includes('invoice-expenses:')?[]:rows};}});
const pool=(kind,sourceId,awbs,amount,extra={})=>({kind,sourceId,awbs,amount,currency:kind==='CUSTOMS'?'KRW':'CNY',basis:kind==='CUSTOMS'?'GW':'CW',mode:'TOTAL',confirmed:true,...extra});
function inputs(prepared){return {confirmed:true,awbInputs:prepared.awbs.map(a=>({awb:a.awb,input:{gw:100,cw:120,exchangeRate:210,exchangeRateSource:'TEST_ONLY 원본 참고',exchangeRateType:'VALIDATION_ONLY',permitAmount:0,fullBoxCounts:{ROSE:1,HYDRANGEA:1}}})),expensePools:[...prepared.awbs.map((a,i)=>pool('FREIGHT',`TEST_ONLY-freight-${i}`,[a.awb],100+i*100)),pool('CUSTOMS','TEST_ONLY-customs',prepared.awbs.map(a=>a.awb),1000)]};}

test('China A/B same canonical week, distinct AWBs and invoice rows; grouping independent of upload order',async()=>{
 const raw=[row(1),row(2)],p=await read(raw),request=inputs(p),before=JSON.stringify(raw),r=calculateArrivalWeekCost(p,request);
 assert.equal(r.lines.length,2);assert.equal(r.receiptCount,2);assert.equal(r.totals.freightNative,300);assert.equal(r.totals.customsKRW,1000);assert.equal(r.totals.goodsNative,40);
 const reversed=await read([...raw].reverse(),{...scope,selectedKeys:[2,1]});
 assert.equal(reversed.baselineDigest,p.baselineDigest);
 assert.deepEqual(calculateArrivalWeekCost(reversed,request).lines,r.lines);
 assert.equal(JSON.stringify(raw),before);
 const bytes=await createArrivalWeekCostWorkbook({prepared:p,calculation:r}),book=new ExcelJS.Workbook();await book.xlsx.load(bytes);
 assert.equal(book.worksheets.length,1);assert.equal(book.worksheets[0].getCell('B3').value.result,r.totals.totalCostKRW);assert.equal(book.worksheets[0].getCell('I8').value,20);assert.equal(book.worksheets[0].getCell('I9').value,20);
});
test('expense identity deduplicates normalized AWB repeated source, preserves equal distinct sources; rejects conflicts and missing inputs',async()=>{
 const p=await read([row(1),row(2)]),request=inputs(p),r=calculateArrivalWeekCost(p,request);
 request.expensePools.push({...request.expensePools[0],awbs:['784-69519262']});assert.equal(calculateArrivalWeekCost(p,request).totals.freightNative,r.totals.freightNative);
 request.expensePools.push({...request.expensePools[0],sourceId:'TEST_ONLY-other actual bill'});assert.equal(calculateArrivalWeekCost(p,request).totals.freightNative,400);
 request.expensePools.push({...request.expensePools[0],amount:999});assert.throws(()=>calculateArrivalWeekCost(p,request),/충돌/);
 for(const mutate of [x=>x.expensePools=[],x=>x.expensePools[0].amount='',x=>x.expensePools[0].confirmed=false,x=>x.awbInputs[0].input.cw='',x=>x.expensePools[0].awbs=['99999999999'],x=>x.expensePools[0].currency='USD']){const q=inputs(p);mutate(q);assert.throws(()=>calculateArrivalWeekCost(p,q));}
 const zero=inputs(p);zero.expensePools[0].amount=0;assert.equal(calculateArrivalWeekCost(p,zero).totals.freightNative,200);
});
test('same AWB CO hydrangea/carnation/rose use one whole pool; separate files and combined files identical',async()=>{
 const co={country:'CO',orderYear:'2026',orderWeek:'45-03',selectedKeys:[1,2,3]},raw=[row(1,{CounName:'콜롬비아',OutUnit:'송이',OutQuantity:100,TPrice:200}),row(2,{CounName:'콜롬비아',FlowerName:'수국',ProdName:'HYDRANGEA TEST_ONLY',OrderNo:'78469519262',OutUnit:'송이',OutQuantity:100,TPrice:200}),row(3,{CounName:'콜롬비아',FlowerName:'카네이션',ProdName:'CARNATION TEST_ONLY',OrderNo:'78469519262',OutUnit:'송이',OutQuantity:100,TPrice:200})];
 const p=await read(raw,co);assert.equal(p.awbs.length,1);assert.equal(p.issues.length,0);const q=inputs(p);q.awbInputs[0].input.fullBoxCounts={ROSE:1,HYDRANGEA:1,CARNATION:1};q.expensePools[0].currency='USD';
 const r=calculateArrivalWeekCost(p,q);assert.equal(r.lines.length,3);assert.equal(r.totals.freightNative,100);assert.equal(r.totals.customsKRW,1000);
 const combined=await read(raw.map(r=>({...r,FileName:'TEST_ONLY-combined.xlsx'})),co);assert.deepEqual(calculateArrivalWeekCost(combined,q).totals,r.totals);
});
test('country/year/week/duplicate/detail identities and ambiguous unlinked goods fail safely',async()=>{
 await assert.rejects(read([row(1,{OrderYear:'2025'}),row(2)]),/연도/);
 await assert.rejects(read([row(1),row(2)],{...scope,selectedKeys:[1,1]}),/중복/);
 await assert.rejects(read([row(1),row(2,{InvoiceNo:'TEST_ONLY-1'})]),/중복 입고/);
 const foreign=await read([row(1),row(2,{CounName:'콜롬비아'})],{...scope,selectedKeys:[1]});assert.equal(foreign.candidates.length,1);
 await assert.rejects(read([row(1),row(2,{CounName:'콜롬비아',OrderNo:'78469519262'})],{...scope,selectedKeys:[1]}),/다른 국가/);
 const unknown=await read([row(1),row(1,{WdetailKey:11,ProdKey:null,ProdName:null,CounName:null}),row(2)]);assert(unknown.issues.some(i=>i.code==='PRODUCT_REQUIRED'));assert.throws(()=>calculateArrivalWeekCost(unknown,inputs(unknown)),/품목/);
});
test('invoice extra charges apply only to their receipt, without duplicating the AWB freight or changing goods',async()=>{
 const co={country:'CO',orderYear:'2026',orderWeek:'45-03',selectedKeys:[1,2]},raw=[row(1,{CounName:'콜롬비아',OutUnit:'송이',OutQuantity:100,TPrice:200}),row(2,{CounName:'콜롬비아',OrderNo:'78469519262',OutUnit:'송이',OutQuantity:100,TPrice:200}),row(1,{WdetailKey:11,ProdName:'운송료',CounName:'콜롬비아',UPrice:15,TPrice:15})];
 const p=await read(raw,co),q=inputs(p);q.expensePools[0].currency='USD';q.expenseDecisions=[{wdetailKey:11,evidence:'TEST_ONLY invoice total charges',treatment:'INVOICE_FEE',currency:'USD',basis:'BOX',confirmed:true}];
 const r=calculateArrivalWeekCost(p,q);assert.equal(r.totals.invoiceFeeNative,15);assert.equal(r.totals.freightNative,100);assert.equal(r.lines.find(l=>l.warehouseKey===2).componentAmounts.invoiceFeeNative,undefined);assert.equal(r.lines.find(l=>l.warehouseKey===1).componentAmounts.invoiceFeeNative,15);assert.equal(r.totals.goodsNative,400);
 q.expenseDecisions.push({...q.expenseDecisions[0]});assert.throws(()=>calculateArrivalWeekCost(p,q),/중복/);
});
function response(){return {statusCode:200,headers:{},status(s){this.statusCode=s;return this;},setHeader(k,v){this.headers[k]=v;},json(value){this.body=value;return this;},send(value){this.body=value;return this;}};}
test('late concurrent receipt addition invalidates preview and download; generated binary is never sent stale',async()=>{
 const p=await read([row(1),row(2)]),request={...scope,...inputs(p),action:'download',selectedKeys:[1,2],baselineDigest:p.baselineDigest};request.versionHash=calculateArrivalWeekCost(p,request).versionHash;
 for(const late of ['before','during']){let calls=0;const handler=createArrivalWeekCostHandler({authorize:()=>true,prepare:async()=>{calls++;return {...p,baselineDigest:(late==='before'||calls>1)?'changed':p.baselineDigest};},calculate:calculateArrivalWeekCost,generate:async()=>Buffer.from('TEST_ONLY')});const res=response();await handler({method:'POST',user:{},body:request},res);assert.equal(res.statusCode,409);assert.equal(res.headers['Content-Type'],undefined);}
 const handler=createArrivalWeekCostHandler({authorize:()=>true,prepare:async()=>p,calculate:calculateArrivalWeekCost,generate:createArrivalWeekCostWorkbook});const res=response();await handler({method:'POST',user:{},body:request},res);assert.equal(res.statusCode,200);assert(Buffer.isBuffer(res.body));
});
