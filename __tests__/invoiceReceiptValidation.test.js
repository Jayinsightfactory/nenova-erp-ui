import test from 'node:test';
import assert from 'node:assert/strict';
import {validateInvoiceReceiptLines} from '../lib/invoiceReceiptValidation.js';
import {acquireInvoiceReceiptGate,calculateInvoiceStock,nextInvoiceWarehouseKey} from '../lib/invoiceReceiptNative.js';
const product={ProdKey:1,ProdName:'중국 장미',isDeleted:0,OutUnit:'단',EstUnit:'단',SteamOf1Box:160,SteamOf1Bunch:10};
const doc={orderYear:'2026',orderWeek:'41-01',farmKey:1,invoiceNo:'INV-1',invoiceYear:'2026',reviewedMetadata:{inputDate:'2026-10-01'},
  lines:[{lineId:'line1',prodKey:1,bunchQuantity:48,stemQuantity:null,boxQuantity:null,priceUnit:'단',unitPrice:10,currency:'CNY',lineAmount:480}]};
test('China bunch quantity and currency stay native; only missing ratios derived',()=>{
  const r=validateInvoiceReceiptLines(doc,[product]);assert.deepEqual(r.issues,[]);
  assert.equal(r.lines[0].outQuantity,48);assert.equal(r.lines[0].boxQuantity,3);assert.equal(r.lines[0].stemQuantity,480);assert.equal(r.lines[0].currency,'CNY');
});
test('explicit zero is not replaced, missing cannot become zero',()=>{
  const d=structuredClone(doc);d.lines[0].boxQuantity=0;
  assert.equal(validateInvoiceReceiptLines(d,[product]).lines[0].boxQuantity,0);
  d.lines[0].bunchQuantity=null;d.lines[0].boxQuantity=null;
  assert.ok(validateInvoiceReceiptLines(d,[product]).issues.some(i=>i.code==='UNIT_CONVERSION_REQUIRED'));
});
test('negative, blank prices, wrong unit, missing currency, deleted products fail',()=>{
  for(const [key,value,code] of [['bunchQuantity',-1,'QUANTITY_INVALID'],['unitPrice',null,'PRICE_REQUIRED'],['priceUnit','box','PRICE_UNIT_REQUIRED'],['currency','','CURRENCY_REQUIRED']]){
    const d=structuredClone(doc);d.lines[0][key]=value;assert.ok(validateInvoiceReceiptLines(d,[product]).issues.some(i=>i.code===code));
  }
  assert.ok(validateInvoiceReceiptLines(doc,[{...product,isDeleted:null}]).issues.some(i=>i.code==='PRODUCT_REQUIRED'));
});
test('date rollover, cross-year and nonUSD freight header blocked',()=>{
  for(const [patch,code] of [[{inputDate:'2026-02-30'},'INPUT_DATE_REQUIRED'],[{inputDate:'2027-10-01'},'SOURCE_YEAR_CONFLICT'],[{freightRate:3,freightCurrency:'CNY'},'FREIGHT_CURRENCY_REQUIRED']]){
    const d=structuredClone(doc);Object.assign(d.reviewedMetadata,patch);assert.ok(validateInvoiceReceiptLines(d,[product]).issues.some(i=>i.code===code));
  }
});
const types={Int:'int',NVarChar:'nvarchar'};
test('live decimal(10,2) weights and decimal(10,4) rate reject truncation before SQL',()=>{
  for(const patch of [{gw:0.001},{cw:100000000},{docFee:1.001,freightCurrency:'USD'},{freightRate:0.00001,freightCurrency:'USD'}]){
    const d=structuredClone(doc);Object.assign(d.reviewedMetadata,patch);
    assert.ok(validateInvoiceReceiptLines(d,[product]).issues.some(i=>i.code==='METADATA_PRECISION_INVALID'));
  }
  const d=structuredClone(doc);Object.assign(d.reviewedMetadata,{gw:0.29,cw:12.34,freightRate:2.1234,docFee:0,freightCurrency:'USD'});
  assert.deepEqual(validateInvoiceReceiptLines(d,[product]).issues,[]);
});
const idle={Mode:null,LockedAt:null,Action:null,OrderYear:null,OrderWeek:null,OwnerSessionID:null,OwnerToken:null,CalcProdKey:null,PendingCalc:0,ProtocolVersion:2,SessionID:8,TransactionCount:1,TransactionState:1};
test('native gate refuses busy, unready, absent outer transaction without mutating gate',async()=>{
  for(const row of [{...idle,Mode:'RUN'},{...idle,PendingCalc:1},{...idle,TransactionCount:0}]){
    const statements=[];await assert.rejects(acquireInvoiceReceiptGate(async q=>{statements.push(q);return {recordset:[row]};},types));
    assert.equal(statements.length,1);assert.ok(!statements.some(q=>/UPDATE|DELETE/.test(q)));
  }
});
test('native key and calculation check original transaction before/after call and both result codes',async()=>{
  let statement;assert.equal(await nextInvoiceWarehouseKey(async q=>{statement=q;return {recordset:[{WarehouseKey:99}]};},types,{}),99);
  assert.ok(statement.indexOf('INVOICE_ORIGINAL_TRANSACTION_LOST')<statement.indexOf('usp_GetNextKey'));
  assert.ok(statement.lastIndexOf('INVOICE_ORIGINAL_TRANSACTION_LOST')>statement.indexOf('usp_GetNextKey'));
  await assert.rejects(calculateInvoiceStock(async()=>({recordset:[{result:0,returnCode:-1}]}),types,{},doc,'importer'));
  await calculateInvoiceStock(async q=>{assert.match(q,/@ProdKey=0/);assert.match(q,/INVOICE_GATE_NOT_IDLE_AFTER_CALC/);return {recordset:[{result:0,returnCode:0}]};},types,{},doc,'importer');
});

test('EC and US require a verified bunch value whenever shipment or estimate uses bunches', ()=>{
  const current = {...doc, orderWeek:'47-01', reviewedMetadata:{country:'EC',inputDate:'2026-11-17'}};
  const line = {...doc.lines[0], bunchQuantity:null, stemQuantity:7500, boxQuantity:1, priceUnit:'송이', unitPrice:0.2, lineAmount:1500};
  const p = {...product, ProdName:'EC fixture', SteamOf1Bunch:25, BunchOf1Box:20, SteamOf1Box:0};
  for (const value of [null,0]) {
    const result=validateInvoiceReceiptLines({...current,lines:[{...line,bunchQuantity:value}]},[p]);
    assert.ok(result.issues.some(({ code }) => code === 'BUNCH_QUANTITY_REQUIRED'));
    assert.equal(result.lines[0].bunchQuantity,value);
  }
  assert.equal(validateInvoiceReceiptLines({...current,lines:[{...line,bunchQuantity:300}]},[p]).issues.length,0);
  const printed = validateInvoiceReceiptLines({...current,lines:[{...line,
    sourceEvidence:{packing:{stemsPerBunch:25}}}]},[p]);
  assert.deepEqual(printed.issues,[]);
  assert.equal(printed.lines[0].bunchResolution,'derived');
  assert.equal(printed.lines[0].bunchQuantity,300);
  const review = validateInvoiceReceiptLines({...current,lines:[line]},[p]).issues.find(issue=>issue.code==='BUNCH_QUANTITY_REQUIRED');
  const reviewedLine = {...line,reviewed:{bunchConfirmation:{quantity:300,reason:'Printed count checked',snapshot:review.snapshot}}};
  const confirmed = validateInvoiceReceiptLines({...current,lines:[reviewedLine]},[p]);
  assert.deepEqual(confirmed.issues,[]);
  assert.equal(confirmed.lines[0].bunchResolution,'confirmed');
  assert.equal(reviewedLine.bunchQuantity,null);
  assert.ok(validateInvoiceReceiptLines({...current,lines:[reviewedLine]},[{...p,BunchOf1Box:21}])
    .issues.some(({code})=>code==='BUNCH_QUANTITY_REQUIRED'));
  const old = {...current,orderYear:'2025',reviewedMetadata:{country:'US',inputDate:'2025-11-17'}};
  const box = {...p,OutUnit:'박스',EstUnit:'단'};
  assert.ok(validateInvoiceReceiptLines({...old,lines:[line]},[box]).issues.some(({ code })=>code==='BUNCH_QUANTITY_REQUIRED'));
  assert.equal(validateInvoiceReceiptLines({...old,lines:[{...line,bunchQuantity:300}]},[box]).lines[0].outQuantity,1);
});
