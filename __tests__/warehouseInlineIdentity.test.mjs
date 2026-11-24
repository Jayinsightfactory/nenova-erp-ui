import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectWarehouseIdentity, updateWarehouseIdentity, warehouseIdentityScope } from '../lib/warehouseInlineIdentity.js';
import { incomingCompactDateLabel } from '../lib/incomingDateLabel.js';
import { incomingRoundLabel, normalizeRoundSearch, matchesRound } from '../lib/incomingRoundLabel.js';

const types={Int:'int',NVarChar:'nvarchar',Bit:'bit'};
const scope={warehouseKey:9001,orderYear:'2026',orderWeek:'47-02',field:'invoiceNo'};
const base={WarehouseKey:9001,OrderYear:'2026',OrderWeek:'47-02',FarmName:'Farm A',InvoiceNo:'BASE-1',OrderNo:null};
const before={expectedInvoiceNo:base.InvoiceNo,expectedAwb:base.OrderNo};

function fixture({header=base,links=[],receipts=[],documents=[],forwarder=[],broken=false}={}) {
  const writes=[];
  const calls=[];
  const query=async (sql,params)=>{
    calls.push({sql,params});
    if(sql.includes(':header')) return {recordset:header&&
      params.year.value===header.OrderYear&&params.week.value===header.OrderWeek&&params.warehouseKey.value===header.WarehouseKey?[header]:[]};
    if(sql.includes(':links')) return {recordsets:[links.map(Code=>({Code})),receipts,documents,forwarder]};
    writes.push({sql,params});
    const field=sql.includes('SET\n    InvoiceNo')?'InvoiceNo':'OrderNo';
    return {recordset:[{...header,[field]:params.value.value,...(broken?{OrderYear:'2025'}:{})}]};
  };
  return {query,writes,calls};
}

test('fills a blank AWB or replaces an invoice in one scoped row, with a locked baseline and exact readback',async()=>{
  for(const [field,value,column] of [['invoiceNo',' CH-1 ','InvoiceNo'],['awb','123-45678901','OrderNo']]){
    const f=fixture();
    const result=await updateWarehouseIdentity(f.query,types,{...scope,...before,field,value},'operator');
    assert.equal(result.header[column],value.trim());
    assert.equal(f.writes.length,1);
    assert.match(f.writes[0].sql,/WHERE WarehouseKey=@warehouseKey AND OrderYear=@year AND OrderWeek=@week/);
    assert.match(f.calls[1].sql,/UPDLOCK,HOLDLOCK/);
    assert.match(f.writes[0].sql,new RegExp('SET\\s+'+column+'=@value,LastUpdateID=@actor,LastUpdateDtm=GETDATE\\(\\)'));
    assert.doesNotMatch(f.writes[0].sql,/WarehouseDetail|Stock|Shipment|Estimate|Amount|Vat/);
  }
});

test('preflight and commit share blocking checks with normalized number matching',async()=>{
  const cases=[
    [{links:['DOCUMENT']},'awb','123-45678901','DOCUMENT'],
    [{links:['DECLARATION']},'awb','123-45678901','DECLARATION'],
    [{links:['COST']},'invoiceNo','NEW','COST'],
    [{links:['PROFIT']},'invoiceNo','NEW','PROFIT'],
    [{links:['CORRECTION']},'invoiceNo','NEW','CORRECTION'],
    [{receipts:[{FarmName:'Farm A',InvoiceNo:'cH-1',OrderWeek:'47-01'}]},'invoiceNo','CH-1','DUPLICATE_INVOICE'],
    [{receipts:[{FarmName:'Farm X',OrderNo:'123 4567-8901',OrderWeek:'47-01'}]},'awb','123-45678901','SHARED_AWB'],
    [{documents:[{FarmName:'Farm A',InvoiceNo:'BASE-1'}]},'invoiceNo','NEW','DOCUMENT'],
    [{documents:[{FarmName:'Farm B',Awb:'123 45678901',OrderWeek:'47-03'}]},'awb','123-45678901','SHARED_AWB'],
    [{forwarder:[{Awb:'123 45678901'}]},'awb','123-45678901','FORWARDER'],
  ];
  for(const [fixtureInput,field,value,code] of cases){
    const f=fixture(fixtureInput);
    const input={...scope,...before,field,value};
    const preview=await inspectWarehouseIdentity(f.query,types,input,{next:value});
    const commit=await updateWarehouseIdentity(f.query,types,input,'operator');
    assert.ok(preview.issues.some(issue=>issue.code===code));
    assert.deepEqual(preview.issues,commit.issues);
    assert.equal(f.writes.length,0);
  }
});

test('stale, prior-year keys and invalid values cannot alter a current receipt',async()=>{
  const f=fixture();
  await assert.rejects(updateWarehouseIdentity(f.query,types,{...scope,...before,expectedAwb:'stale',value:'NEW'},'operator'),{code:'WAREHOUSE_IDENTITY_STALE'});
  await assert.rejects(updateWarehouseIdentity(f.query,types,{...scope,...before,orderYear:'2025',value:'NEW'},'operator'),{code:'WAREHOUSE_IDENTITY_NOT_FOUND'});
  await assert.rejects(updateWarehouseIdentity(f.query,types,{...scope,...before,value:''},'operator'),{code:'WAREHOUSE_IDENTITY_VALUE'});
  assert.throws(()=>warehouseIdentityScope({...scope,field:'LastUpdateID'}),{code:'WAREHOUSE_IDENTITY_SCOPE'});
  assert.equal(f.writes.length,0);
  const broken=fixture({broken:true});
  await assert.rejects(updateWarehouseIdentity(broken.query,types,{...scope,...before,value:'NEW'},'operator'),{code:'WAREHOUSE_IDENTITY_READBACK'});
});

test('rounds and dates retain source keys and calendar dates',()=>{
  assert.equal(incomingRoundLabel('47-02'),'47-02');
  assert.equal(incomingRoundLabel('47-02A'),'47-02.A');
  assert.equal(incomingRoundLabel('47-02B'),'47-02.B');
  assert.equal(incomingRoundLabel('47-02.A'),'47-02.A');
  assert.equal(matchesRound('47-02A',normalizeRoundSearch('４７ – ０２.A차')),true);
  assert.equal(matchesRound('47-02.B',normalizeRoundSearch('47-02B')),true);
  assert.equal(matchesRound('47-02B',normalizeRoundSearch('47-02A')),false);
  assert.equal(incomingCompactDateLabel('2026-11-23T23:59:59-08:00'),'26-11-23');
  assert.equal(incomingCompactDateLabel('2026-02-31'),'2026-02-31');
});
