import test from 'node:test';
import assert from 'node:assert/strict';
import { warehouseFarmChoicesSql, warehouseFarmSearch } from '../lib/warehouseFarmChoices.js';
import { readWarehouseCorrection, prepareWarehouseCorrection } from '../lib/warehouseCorrection.js';
import { readIncomingApprovalFacts } from '../lib/incomingApproval.js';
const name='Faguaflowers Intl LLC';
const types={Int:'int',NVarChar:'nvarchar'};
const scope={warehouseKey:90,orderYear:'2026',orderWeek:'44-01'};
const header={WarehouseKey:90,OrderYear:'2026',OrderWeek:'44-01',FarmName:'Farm A',isDeleted:false};
const detail={WdetailKey:901,WarehouseKey:90,ProdKey:1,OutQuantity:10,EstQuantity:10,BoxQuantity:1,BunchQuantity:10,SteamQuantity:10,UPrice:1,TPrice:10};
const product={ProdKey:1,ProdName:'Flower A',OutUnit:'단',EstUnit:'단',CountryFlower:'TEST',isDeleted:false};
function query(eligible=true){const calls=[];const q=async(text,p={})=>{calls.push({text,p});if(text.includes('DECLARE @products TABLE'))return {recordsets:[[product],[{CurrentYearWeek:'20264401',PreviousYearWeek:null,NextYearWeek:null}],[]]};let recordset=[];
 if(text.includes('correction:header'))recordset=p.year.value==='2026'?[header]:[];
 else if(text.includes('correction:details'))recordset=[detail];
 else if(text.includes('correction:farms'))recordset=[{FarmKey:null,FarmName:name}];
 else if(text.includes('correction:farm */'))recordset=eligible&&p.farm.value===name?[{FarmKey:null,FarmName:name}]:[];
 else if(text.includes('correction:products')||text.includes('SELECT ProdKey,ProdName,OutUnit'))recordset=[product];
 else if(text.includes('SELECT FarmKey,FarmName,FarmCode FROM Farm'))recordset=[{FarmKey:1,FarmName:'Farm A',FarmCode:'A'}];
 else if(text.includes('correction:gate-read'))recordset=[{ProtocolVersion:2,Mode:null,LockedAt:null,Action:null,OrderYear:null,OrderWeek:null,OwnerSessionID:null,OwnerToken:null,CalcProdKey:null,PendingCalc:0}];
 else if(text.includes('correction:capability'))recordset=[{ProtocolVersion:2,IsReady:1}];
 else if(text.includes('correction:connections'))recordset=['FREIGHT','INVOICE','INVOICE_COST','FREIGHT_DETAIL','STOCK_TYPE','ARRIVAL','WEEK_COST','PROFIT','FARM_DISTRIBUTION'].map(Code=>({Code,Count:0}));
 return {recordset};};return {q,calls};}
test('search matches canonical names ignoring case/spacing; no aliases or automatic selection',()=>{
 const farms=[{FarmName:name},{FarmName:'Farm B'},{FarmName:name}];
 assert.deepEqual(warehouseFarmSearch(farms,'  fAGUa flowers  INTL llc ',['Farm A']).matches,[name]);
 assert.deepEqual(warehouseFarmSearch(farms,'not a farm',['Farm A']).matches,[]);
 assert.equal(warehouseFarmSearch(farms,'',['Farm A',name]).names.length,3);
 assert.deepEqual(warehouseFarmSearch([],undefined,['current name']).matches,['current name']);
 assert.deepEqual(warehouseFarmSearch(farms,'INTI',[]).matches,[],'do not silently invent an I/L alias');
});
test('GET and legacy preview/locked write validation share the receipt-name candidate scope',async()=>{
 const f=query();const get=await readWarehouseCorrection({queryFn:f.q,types,...scope});assert.equal(get.farms[0].FarmName,name);
 for(const locked of [false,true]){const result=await prepareWarehouseCorrection({queryFn:f.q,types,input:{...scope,mode:'FARM',farmName:name},locked});assert.equal(result.canCommit,true);assert.equal(result.plan.detailsChanged,false);}
 for(const c of f.calls.filter(c=>c.text.includes('correction:farm'))){assert.match(c.text,/dbo\.WarehouseMaster/);assert.match(c.text,/NOT EXISTS/);}
 assert(f.calls.filter(c=>c.text.includes('correction:farm */')).every(c=>c.p.farm.value===name));
 assert(f.calls.some(c=>c.text.includes('WITH (HOLDLOCK)')));
});
test('unknown/deleted/stale candidate cannot pass correction preflight',async()=>{
 for(const farmName of [name,'unknown']){const f=query(false);const result=await prepareWarehouseCorrection({queryFn:f.q,types,input:{...scope,mode:'FARM',farmName}});assert(result.issues.some(i=>i.code==='CORRECTION_FARM_INVALID'));}
});
test('approval accepts a receipt-only name without creating fake distribution FarmKey',async()=>{
 for(const locked of [false,true]){const f=query();const facts=await readIncomingApprovalFacts(f.q,types,{...scope,mode:'FARM',farmName:name},locked);
 assert.equal(facts.correction.farmName,name);assert.deepEqual(facts.farmCandidates[1],[]);assert.equal(facts.farms.length,1);assert.equal(facts.farms[0].FarmKey,1);assert.equal(facts.receiptPlan.detailsChanged,false);}
 const f=query(false);await assert.rejects(readIncomingApprovalFacts(f.q,types,{...scope,mode:'FARM',farmName:name}),{code:'APPROVAL_FARM_INVALID'});
});
test('candidate names are global but selected receipt still requires its exact year',async()=>{
 const f=query();await assert.rejects(readWarehouseCorrection({queryFn:f.q,types,...scope,orderYear:'2027'}),{code:'CORRECTION_NOT_FOUND'});
 const text=warehouseFarmChoicesSql();assert.doesNotMatch(text,/OrderYear|OrderWeek/);assert.match(warehouseFarmChoicesSql({selected:true}),/FarmName=@farm/);
});
