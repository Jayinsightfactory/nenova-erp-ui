const test=require('node:test'),assert=require('node:assert/strict');
const {dbCostValue,missingCountryValues,missingColombiaValues}=require('../lib/customsSettlementCostPolicy.cjs');
test('missing-component policy participates in the calculation fingerprint',()=>{
  assert(require('../lib/profitReportCalcHash.cjs').listFiles(process.cwd()).includes('lib/customsSettlementCostPolicy.cjs'));
});

test('missing means null/undefined/empty, never an explicit zero or existing split',()=>{
  for(const value of [null,undefined,''])assert.equal(dbCostValue({Customs1:value},'Customs1_1').protected,false);
  for(const saved of [{Customs1:0},{Customs1:120},{Customs1_2:0},{Customs1_3:120}]){
    assert.equal(dbCostValue(saved,'Customs1_1').protected,true);
    assert.deepEqual(missingCountryValues(saved,{Customs1_1:900},1),{});
  }
});
test('only selected-phase missing fee components are allowed, never freight or warehouse',()=>{
  const values={Customs1_1:100,SunYul1_1:110,Quarantine1:220,Customs2_1:500,WorldFreight1:300,GW:400,WarehouseFee:500};
  assert.deepEqual(missingCountryValues({Customs1_2:0},values,1),{SunYul1_1:110,Quarantine1:220});
  assert.deepEqual(missingCountryValues({},values,2),{Customs2_1:500});
  assert.deepEqual(missingCountryValues({},values,3),{});
  assert.deepEqual(missingColombiaValues({ItemCount:0,CustomsFee:0},{CustomsFee:100,HandlingFee:200,DisinfectFee:300,ActualQuarantineAgencyFee:400,GW:500}),{HandlingFee:200,DisinfectFee:300});
});
test('overlay is immutable and metadata contains only genuinely applied components',async()=>{
  const {settlementCountryRow,settlementCountryValues,settlementColombiaRow}=await import('../lib/customsSettlementEvidence.js');
  const saved=Object.freeze({SunYul1_2:99,Customs1:0,Quarantine1:null,WorldFreight1:700});
  const ledger={values:{'country|태국|01':{SunYul1_1:110,Customs1_1:120,Quarantine1:220,WorldFreight1:999}}};
  const row=settlementCountryRow(saved,ledger,'태국');
  assert.deepEqual(settlementCountryValues(saved,ledger,'태국'),{Quarantine1:220});
  assert.equal(row.Quarantine1,220);assert.equal(row.WorldFreight1,700);assert.equal(row.SunYul1_2,99);assert.equal(row.SunYul1_1,undefined);assert.equal(saved.Quarantine1,null);
  const co=Object.freeze({ItemCount:0,DisinfectFee:0});
  assert.equal(settlementColombiaRow(co,{values:{'colombia|35-01':{ActualQuarantineAgencyFee:400,DisinfectFee:300}}},'35-01'),co);
});
test('disinfection round-trip keeps country gross and Colombia net, excludes import VAT',async()=>{
  const {buildSettlementPlan}=require('../lib/customsSettlementPlan.cjs'),{validateLedger}=require('../lib/customsSettlementStore.cjs');
  const receipt={issuer:'SUNYUL',documentId:'TEST-DISINFECTION',sourceHash:'d'.repeat(64),awb:'12312345678',date:'2026-08-30',charges:[{code:'DISINFECTION',net:2000,vat:200,total:2200},{code:'IMPORT_VAT',net:0,vat:0,total:5000}],total:7200};
  for(const [targetKey,field,basis,expected] of [['country|태국|01','Quarantine1','total',2200],['country|베트남|01','Quarantine1','total',2200],['colombia|35-01','DisinfectFee','net',2000]]){
    const plan=buildSettlementPlan({year:2026,major:35,receipts:[receipt],candidates:[{year:2026,orderWeek:'35-01',awb:receipt.awb,targetKey}],mapping:{[targetKey]:{DISINFECTION:{field,basis}}}});
    assert.equal(plan.issues.length,0);assert.equal(plan.patches.length,1);assert.equal(plan.patches[0].amount,expected);
    const ledger={version:1,year:'2026',major:'35',revision:1,documents:plan.documents,values:{[targetKey]:{[field]:expected}},history:[]};
    assert.equal(validateLedger(ledger,2026,35),ledger);
  }
});
