import assert from 'node:assert/strict';
import test from 'node:test';
import {buildWeekdayAllocationPrintItems as build,readWeekdayAllocationPrintInTransaction as read} from '../lib/weekdayAllocationPrint.js';
const scope={year:2026,majorWeek:'42',orderYearWeek:'202642',custKey:533,mode:'dates',dates:['2026-10-15']};
const detail=(patch={})=>({OrderYear:2026,OrderWeek:'42-01',OrderYearWeek:'202642',MasterCustKey:533,DetailCustKey:null,
  SdetailKey:1,ProdKey:389,ActiveCustKey:533,ActiveProdKey:389,ProdName:'Doncel',OutQuantity:12,isFix:false,
  OutUnit:'박스',EstUnit:'송이',BunchOf1Box:1,SteamOf1Box:15,SteamOf1Bunch:15,DetailCost:10500,...patch});
const day=(patch={})=>({SdetailKey:1,SdateKey:10,ShipmentTimestamp:'2026-10-15 00:00:00.000',ShipmentQuantity:12,
  EstQuantity:180,Cost:10500,Amount:1718182,Vat:171818,ExactPeriodDayCount:1,...patch});
test('unfixed stored allocation prints correct estimate conversion without Wilson duplication',()=>{
  const result=build(scope,[detail()],[day()]);
  assert.equal(result.items[0].Quantity,180);assert.equal(result.items[0].Amount,1718182);
  assert.equal(result.confirmation.unfixedCount,1);assert.equal(result.confirmation.required,false);
  assert.equal(result.items.length,1);assert.deepEqual(result.diagnostics,[]);
});
test('selected day includes only its stored quantity; major includes all dates',()=>{
  const days=[day({ShipmentQuantity:6,EstQuantity:90,Amount:859091,Vat:85909}),day({SdateKey:11,ShipmentTimestamp:'2026-10-16 00:00:00.000',ShipmentQuantity:6,EstQuantity:90,Amount:859091,Vat:85909})];
  assert.equal(build(scope,[detail()],days).items[0].Quantity,90);
  assert.equal(build({...scope,mode:'major',dates:[]},[detail()],days).items[0].Quantity,180);
});
test('null or stale date estimate derives from canonical allocation and explains the conversion',()=>{
  for(const EstQuantity of [null,1]) {
    const result=build(scope,[detail()],[day({EstQuantity,Amount:null,Vat:null})]);
    assert.equal(result.items[0].Quantity,180);assert.equal(result.items[0].Amount,1718182);
    assert.equal(result.diagnostics[0].code,'ALLOCATION_EST_RECALCULATED');
  }
  assert.equal(build(scope,[detail()],[day({Cost:null})]).items[0].Cost,10500);
  assert.equal(build(scope,[detail()],[day({Cost:0,Amount:0,Vat:0})]).items[0].Cost,0);
});
test('cross-year/customer, duplicate/missing links, date clock mismatch, corrupt money fail explicitly',()=>{
  for(const [details,dates] of [
    [[detail({OrderYear:2025})],[day()]],[[detail({MasterCustKey:534})],[day()]],
    [[detail(),detail()],[day()]],[[detail({ActiveProdKey:null})],[day()]],
    [[detail({DetailCustKey:534})],[day()]],[[detail()],[day({ExactPeriodDayCount:0})]],
    [[detail()],[day({Amount:1})]],[[detail({OutQuantity:12})],[day({SdetailKey:99})]],[[detail()],[day(),day()]],
    [[detail({SteamOf1Box:0,BunchOf1Box:0,SteamOf1Bunch:0})],[day({EstQuantity:null,Amount:null,Vat:null})]],
  ])assert.throws(()=>build(scope,details,dates),error=>error.status===409);
});
test('transaction read scopes SQL to chosen customer/year, uses selected-date parameters and never mutates ERP',async()=>{
  const calls=[];const sql={Int:'int',NVarChar:()=> 'nvarchar'};
  const major={...scope,mode:'major',dates:[]};
  const query=async(text,params)=>{
    calls.push({text,params});assert.doesNotMatch(text,/\b(INSERT|UPDATE|DELETE|MERGE|EXEC)\b/i);
    if(text.startsWith('SET'))return {};
    if(text.startsWith('SELECT CustKey'))return {recordset:[{CustKey:533,CustName:'주광'}]};
    if(text.includes('DetailCustKey'))return {recordset:[detail()]};
    if(text.includes('ExactPeriodDayCount'))return {recordset:[day()]};
    return {recordset:[]};
  };
  const result=await read(major,query,sql);assert.equal(result.items[0].Quantity,180);
  for(const call of calls.slice(2)) {
    assert.equal(call.params.year.value,2026);assert.equal(call.params.custKey.value,533);
  }
  assert.equal(calls.some(call=>/DetailFix\s*=\s*1|isFix\s*=\s*1/.test(call.text)),false);
});

test('a valid historical estimate/money tuple survives changed product packaging',()=>{
  const result=build(scope,[detail({SteamOf1Box:20,SteamOf1Bunch:20})],[day()]);
  assert.equal(result.items[0].Quantity,180);assert.equal(result.items[0].Amount,1718182);
  assert.equal(result.diagnostics[0].code,'ALLOCATION_HISTORICAL_EST_PRESERVED');
});

test('selected-date reads bind dates to normal selection and registered deductions',async()=>{
  const calls=[];const sql={Int:'int',NVarChar:()=> 'nvarchar'};
  const calendar=Array.from({length:7},(_,index)=>({OrderYearWeek:'202642',WeekDay:[5,6,7,1,2,3,4][index],BaseYmd:`2026-10-${15+index} 00:00:00.000`}));
  await read(scope,async(text,params)=>{
    calls.push({text,params});
    if(text.startsWith('SET'))return {};
    if(text.includes('WITH anchor'))return {recordset:calendar};
    if(text.startsWith('SELECT CustKey'))return {recordset:[{CustKey:533,CustName:'주광'}]};
    if(text.includes('DetailCustKey'))return {recordset:[detail()]};
    if(text.includes('ExactPeriodDayCount'))return {recordset:[day()]};
    return {recordset:[]};
  },sql);
  const normal=calls.find(call=>call.text.includes('ExactPeriodDayCount'));
  const deduction=calls.find(call=>call.text.includes('FROM Estimate e'));
  assert.match(normal.text,/IN \(@printDate0\)/);assert.equal(normal.params.printDate0.value,'2026-10-15');
  assert.match(deduction.text,/CONVERT\(date,e.EstimateDtm\) IN \(@printDate0\)/);
  assert.match(deduction.text,/ISNULL\(sm.isDeleted,0\)=0/);
});

test('historical tuple remains printable with unavailable current packaging; unrelated undated detail does not block selected date',()=>{
  const missingFactor=build(scope,[detail({SteamOf1Box:0,BunchOf1Box:0,SteamOf1Bunch:0})],[day()]);
  assert.equal(missingFactor.items[0].Quantity,180);
  const unrelated=detail({SdetailKey:2,ProdKey:447,ActiveProdKey:447,ProdName:'Moon',OutQuantity:42});
  assert.equal(build(scope,[detail(),unrelated],[day()]).items.length,1);
  assert.throws(()=>build({...scope,mode:'major',dates:[]},[detail(),unrelated],[day()]),error=>error.status===409);
});

import {createRequire} from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const require=createRequire(import.meta.url);
test('API source contract returns unfixed allocation without any write or canonical quote call',async()=>{
  const Module=require('node:module'),{transformSync}=require('next/dist/build/swc');
  const filename=path.resolve('pages/api/estimate/weekday-allocation-print.js'),loaded=new Module(filename);
  loaded.filename=filename;loaded.paths=Module._nodeModulePaths(path.dirname(filename));
  let reads=0;
  loaded.require=id=>id.includes('/auth')?{withAuth:handler=>handler}:id.includes('/db')?{withTransaction:()=>{},sql:{}}:
    id.includes('weekdayAllocationPrint')?{normalizeWeekdayPrintRequest:body=>({...scope,dates:body.dates}),
      readWeekdayAllocationPrintInTransaction:async()=>{reads++;return {customer:{CustKey:533,CustName:'주광'},
        ...build(scope,[detail()],[day()])};}}:require(id);
  loaded._compile(transformSync(fs.readFileSync(filename,'utf8'),{filename,jsc:{parser:{syntax:'ecmascript'},target:'es2022'},module:{type:'commonjs'}}).code,filename);
  const handler=loaded.exports.createWeekdayAllocationPrintHandler({transaction:callback=>callback(()=>{}),types:{}});
  const invoke=async body=>{let result,status;const res={setHeader(){},status(value){status=value;return this;},json(value){result=value;return this;}};
    await handler({method:'POST',body},res);return {result,status};};
  assert.equal((await invoke({...scope})).status,400);assert.equal(reads,0);
  const {result,status}=await invoke({...scope,source:'ALLOCATION'});
  assert.equal(status,200);assert.equal(result.source,'ALLOCATION');assert.equal(result.readOnly,true);
  assert.equal(result.draftIncluded,false);assert.equal(result.confirmation.unfixedCount,1);assert.equal(result.items[0].Quantity,180);
});
