import test from 'node:test';
import assert from 'node:assert/strict';
import {buildNlInvoiceCustomerComparison,nlComparisonForExport,nlCustomerComparisonSheet,markNlCustomerRows} from '../lib/nlCostCustomerComparison.js';

const line=(id,code,q,prodKey=1)=>({lineId:String(id),prodKey,originalName:prodKey===1?'Strong Gold':'Tulip',stemQuantity:q,sourceEvidence:{invoiceCustomerCode:code}});
const doc=lines=>({orderYear:'2026',orderWeek:'46-02',sourceHash:'invoice-46-2',reviewedMetadata:{country:'NL'},lines});

test('46-2 Strong Gold CL21/CL38/MCL73: all 150 stems are other, never CL2 substring',async()=>{
 const d=doc([line(1,'CL21',50),line(2,'CL38',50),line(3,'MCL73',50)]),before=JSON.stringify(d);
 const r=await nlComparisonForExport({document:d,queryFn:()=>{throw Error('DB orders must not be read');}});
 assert.equal(r.basis,'INVOICE');assert.equal(r.status,'READY');
 assert.equal(r.rows[0].own,0);assert.equal(r.rows[0].other,150);assert.equal(r.rows[0].group,'기타');
 assert.equal(JSON.stringify(d),before);
});

test('exact CL2/YCL2 after space/case normalization; all other customer codes remain other',()=>{
 const codes=['CL2',' ycl 2 ','CL21','CL23','YCL22','BCL2','KCL2','MCL73','YCLS','CLE','CLR'];
 const r=buildNlInvoiceCustomerComparison(doc(codes.map((c,i)=>line(i,c,10))));
 assert.equal(r.rows[0].own,20);assert.equal(r.rows[0].other,90);assert.equal(r.rows[0].current,110);
 assert.equal(r.rows[0].shared,true);
});

test('same product keeps exact invoice split, zero, scope and source identity without priority allocation',()=>{
 const d=doc([line(1,'CL2',24),line(2,'CL21',24),line(3,'YCL2',0)]),r=buildNlInvoiceCustomerComparison(d);
 assert.equal(r.rows[0].own,24);assert.equal(r.rows[0].other,24);
 assert.notEqual(r.digest,buildNlInvoiceCustomerComparison({...d,orderYear:'2025'}).digest);
 assert.notEqual(r.digest,buildNlInvoiceCustomerComparison(doc([line(1,'CL21',24),line(2,'CL21',24)])).digest);
 assert.throws(()=>buildNlInvoiceCustomerComparison({...d,orderYear:2026}),/연도/);
 assert.throws(()=>buildNlInvoiceCustomerComparison(doc([line(1,'CL2',-1)])),/수량/);
});

test('missing invoice codes stay unknown instead of falling back to orders or pretending other',()=>{
 const r=buildNlInvoiceCustomerComparison(doc([line(1,'',150)]));
 assert.equal(r.status,'SOURCE_REQUIRED');assert.deepEqual(r.rows,[]);
 const xml=nlCustomerComparisonSheet({comparison:r});
 assert.match(xml,/원본 코드 확인 필요/);assert.match(xml,/DB 주문으로.*추정하지 않습니다/);
 const marked=markNlCustomerRows('<worksheet><row r="14"></row><row r="15"></row></worksheet>',[{source:{prodKey:1}}],r);
 assert.match(marked,/코드 확인 필요/);assert.doesNotMatch(marked,/>기타</);
});

test('invoice workbook text and quantities never present pre-registration source as actual receipt',()=>{
 const d=doc([line(1,'CL2',10),line(2,'CL21',20)]),r=buildNlInvoiceCustomerComparison(d);
 const rows=d.lines.map((source,i)=>({source,cost:{lineId:source.lineId,quantity:source.stemQuantity,unit:'STEM',totalCostKRW:(i+1)*1000}}));
 const xml=nlCustomerComparisonSheet({comparison:r,rows,snapshot:{input:{lineInputs:[]}},headerStyle:'0',numericStyle:'0'});
 assert.match(xml,/인보이스 총수량/);assert.match(xml,/실제 입고 확정값이 아닙니다/);
 assert.match(xml,/<f>D9<\/f>/);assert.doesNotMatch(xml,/MIN\(MAX\(0,D9-N9\),H9\)/);
 assert.match(xml,/인보이스 기준/);
});
