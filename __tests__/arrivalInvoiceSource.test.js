import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { invoiceArrivalRows,loadArrivalInvoiceRows,arrivalInvoiceSourceCte,arrivalInvoiceComparisonSql } from '../lib/arrivalInvoiceSource.js';
import { recalcArrivalCostWithFx } from '../lib/arrivalCostFxPreview.js';
const candidate={WarehouseKey:7345,FarmKey:57,FarmName:'Super Fresh',Country:'TH',SourceFileName:'invoice.pdf',DocumentId:'doc'};
function approved(){return {status:'APPROVED',documentCostStatus:'APPROVED',documentId:'doc',documentRevision:1,operationId:'operation',currentActual:{status:'APPROVED',storedStatus:'APPROVED',basis:'ACTUAL',liveReceiptStatus:'MATCH',documentId:'doc',documentRevision:1,operationId:'operation',warehouseKey:7345,orderYear:'2026',orderWeek:'38-01',costRevisionId:'revision',revisionNo:1,invoiceNo:'6902981',lines:[{lineId:'one',prodKey:667,unit:'BUNCH',quantity:10,costPerUnitKRW:9033.762767}]}};}
test('current approved invoice is a same-unit main-list row without duplicate writes',()=>{
 const rows=invoiceArrivalRows(approved(),candidate,'2026','38-1');
 assert.equal(rows.length,1);assert.equal(rows[0].Unit,'단');assert.equal(rows[0].Quantity,10);assert.equal(rows[0].SourceArrivalCostKRW,9033.762767);assert.equal(rows[0].SourceKind,'INVOICE');assert.equal(rows[0].OrderWeek,'38-1');
 assert.equal(recalcArrivalCostWithFx({sourceKind:'INVOICE',exchangeRate:1400,selectedArrivalCostKRW:100},1500).ok,false);
});
test('cross-year, near-miss week, stale, draft, comparison and changed identity never become current cost',()=>{
 assert.deepEqual(invoiceArrivalRows(approved(),candidate,'2025','38-1'),[]);
 assert.deepEqual(invoiceArrivalRows(approved(),candidate,'2026','38-2'),[]);
 for(const [key,value]of [['status','STALE'],['storedStatus','DRAFT'],['basis','EXPECTED_95'],['liveReceiptStatus','CHANGED'],['documentRevision',2],['operationId','other'],['warehouseKey',99],['documentId','other']]){
  const c=approved();c.currentActual[key]=value;assert.deepEqual(invoiceArrivalRows(c,candidate,'2026'),[],key);
 }
 const c=approved();c.status='STALE';assert.deepEqual(invoiceArrivalRows(c,candidate,'2026'),[]);
});
test('zero cost is valid, cancelled zero quantity omitted and duplicate line fails closed',()=>{
 const c=approved();c.currentActual.lines[0].costPerUnitKRW=0;
 assert.equal(invoiceArrivalRows(c,candidate,'2026')[0].SourceArrivalCostKRW,0);
 c.currentActual.lines.push({...c.currentActual.lines[0]});assert.throws(()=>invoiceArrivalRows(c,candidate,'2026'),/중복/);
 c.currentActual.lines=[{...c.currentActual.lines[0],quantity:0}];assert.deepEqual(invoiceArrivalRows(c,candidate,'2026'),[]);
});
test('loader validates each distinct receipt and propagates unavailable/stale/errors',async()=>{
 const types={NVarChar:'nvarchar'};let reads=0;const queries=[];
 const queryFn=async(q,p)=>{queries.push([q,p]);return {recordset:q.includes(':schema')?[{Available:1}]:[candidate,candidate]};};
 const good=await loadArrivalInvoiceRows({queryFn,types,year:'2026',week:'38-1',readCosts:async()=>{reads++;return approved();}});
 assert.equal(reads,1);assert.equal(good.rows.length,1);assert.equal(queries[1][1].year.value,'2026');assert.match(queries[1][0],/wm.OrderYear\)=@year/);
 const historicalFirst=await loadArrivalInvoiceRows({queryFn:async q=>({recordset:q.includes(':schema')?[{Available:1}]:[{...candidate,DocumentId:'old'},candidate]}),types,year:'2026',readCosts:async()=>approved()});
 assert.equal(historicalFirst.rows.length,1);
 const bad=approved();bad.currentActual=null;bad.status='STALE';
 const stale=await loadArrivalInvoiceRows({queryFn,types,year:'2026',readCosts:async()=>bad});assert.equal(stale.rows.length,0);assert.equal(stale.warnings.length,1);
 await assert.rejects(loadArrivalInvoiceRows({queryFn,types,year:'2026',readCosts:async()=>{throw Error('offline');}}),/offline/);
 assert.deepEqual(await loadArrivalInvoiceRows({queryFn:async()=>({recordset:[{Available:0}]}),types,year:'2026'}),{rows:[],warnings:[]});
});
test('same year/week/product/farm/unit legacy is comparison, not overwritten; history keeps it',()=>{
 const sql=arrivalInvoiceSourceCte();assert.match(sql,/NOT EXISTS/);for(const key of ['OrderYear','ProdKey','FarmKey','CountryName','Unit'])assert.ok(sql.includes(`v.${key}=b.${key}`));
 assert.match(sql,/PARSENAME/);assert.doesNotMatch(arrivalInvoiceSourceCte(true),/NOT EXISTS/);assert.match(arrivalInvoiceComparisonSql,/FOR JSON PATH/);
 const source=fs.readFileSync(new URL('../lib/arrivalInvoiceSource.js',import.meta.url),'utf8');assert.doesNotMatch(source,/\b(?:INSERT INTO|UPDATE dbo|DELETE FROM|CREATE TABLE|ALTER TABLE)\b/);
 const page=fs.readFileSync(new URL('../pages/arrival-cost.js',import.meta.url),'utf8');assert.match(page,/인보이스 자동 반영/);assert.match(page,/legacyComparisons/);assert.match(page,/row.sourceKind === 'INVOICE' \? <>/);
});
