import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import JSZip from 'jszip';
import {readFileSync} from 'node:fs';
import {buildNlCustomerComparison,readNlCustomerComparison,nlComparisonForExport} from '../lib/nlCostCustomerComparison.js';
import {createInvoiceCostWorkbook} from '../lib/invoiceReceiptCostExport.js';
import {invoiceCostExportFixture} from './invoiceReceiptCostExport.test.js';
const XLSX=createRequire(import.meta.url)('xlsx');
const row=(prod,qty,extra={})=>({OrderYear:'2026',OrderWeek:'41-02',ProdKey:prod,ProdName:`상품 ${prod}`,SteamQuantity:qty,...extra});
function data(){return {orderYear:'2026',orderWeek:'41-02',warehouseKey:901,customers:[{CustKey:533,OrderCode:'YCL2'}],
 orders:[row(1,80,{CustKey:533}),row(1,30,{CustKey:7}),row(2,20,{CustKey:533}),row(3,5,{CustKey:7}),row(4,7,{CustKey:533})],
 receipts:[row(1,40,{WarehouseKey:900,WdetailKey:1}),row(1,50,{WarehouseKey:901,WdetailKey:1000}),row(2,11,{WarehouseKey:901,WdetailKey:1001}),row(3,60,{WarehouseKey:901,WdetailKey:1002})]};}

test('customer priority is per year/week/product across all invoices, not a new grant per invoice',()=>{
 const d=data(),before=JSON.stringify(d),r=buildNlCustomerComparison(d),p=r.rows.find(p=>p.prodKey===1);
 assert.equal(p.own,40);assert.equal(p.other,10);assert.equal(p.weekOwn,80);assert.equal(p.weekOther,10);assert.equal(p.shared,true);
 assert.equal(r.rows.find(p=>p.prodKey===4).current,0);assert.equal(r.rows.find(p=>p.prodKey===3).other,60);
 assert.equal(r.rows.reduce((n,p)=>n+p.own+p.other,0),121);assert.equal(JSON.stringify(d),before);
 const earlier=buildNlCustomerComparison({...d,warehouseKey:900});assert.equal(earlier.rows.find(p=>p.prodKey===1).own+p.own,80);
});
test('prior-year same-week, freight, unrelated codes and explicit zero do not leak',()=>{
 const d=data();d.orders.push(row(1,999,{CustKey:533,OrderYear:'2025'}),row(9,999,{CustKey:533,ProdName:'Gross weight'}));
 d.receipts.push(row(1,999,{WarehouseKey:1,WdetailKey:4,OrderYear:'2025'}),row(9,999,{WarehouseKey:901,WdetailKey:5,ProdName:'Chargeable weight'}));
 const r=buildNlCustomerComparison(d);assert.equal(r.rows.find(p=>p.prodKey===1).ownOrder,80);assert.equal(r.rows.some(p=>p.prodKey===9),false);
 for(const code of ['YCL22','CL000','BCL2'])assert.throws(()=>buildNlCustomerComparison({...d,customers:[{CustKey:533,OrderCode:code}]}),/업체/);
 assert.throws(()=>buildNlCustomerComparison({...d,customers:[...d.customers,{CustKey:7,OrderCode:'CL2'}]}),/유일/);
 const zero=buildNlCustomerComparison({...data(),orders:[row(1,0,{CustKey:533})]});assert.equal(zero.rows[0].own,0);
});
test('missing/negative quantities, duplicate receipts, invalid scope and unavailable SQL fail visibly',async()=>{
 for(const v of [null,undefined,-1,NaN]){const d=data();d.receipts[0].SteamQuantity=v;assert.throws(()=>buildNlCustomerComparison(d),/수량/);}
 const d=data();d.receipts.push(d.receipts[0]);assert.throws(()=>buildNlCustomerComparison(d),/중복/);
 assert.throws(()=>buildNlCustomerComparison({...data(),orderYear:'2026 OR 1=1'}),/연도/);
 await assert.rejects(()=>readNlCustomerComparison({queryFn:async()=>({recordsets:[]}),types:{NVarChar:()=>null},...data()}),/조회 결과/);
});
test('reader uses SELECT only with explicit year/week and exact live customer codes',async()=>{
 const d=data();let called=0;
 const r=await readNlCustomerComparison({...d,types:{NVarChar:()=>null},queryFn:async(sql,params)=>{
  called++;assert.doesNotMatch(sql,/\b(INSERT|UPDATE|DELETE|EXEC|MERGE|ALTER)\b/i);assert.equal(params.orderYear.value,'2026');assert.equal(params.orderWeek.value,'41-02');
  assert.match(sql,/om.OrderYear=@orderYear AND om.OrderWeek=@orderWeek/);assert.match(sql,/wm.OrderYear=@orderYear AND wm.OrderWeek=@orderWeek/);
  assert.doesNotMatch(sql,/wd\.isDeleted/);return {recordsets:[d.customers,d.orders,d.receipts]};}});
 assert.equal(called,1);assert.equal(r.customerKey,533);
 assert.equal(await nlComparisonForExport({document:{reviewedMetadata:{country:'AU'}}}),null);
});
test('workbook retains original formulas, adds left customer labels and estimates with honest zero/missing cost',async()=>{
 const f=invoiceCostExportFixture(3,'NL_AMOUNT_V1'),before=JSON.stringify(f),cmp=buildNlCustomerComparison(data());
 const bytes=await createInvoiceCostWorkbook({...f,nlComparison:cmp}),book=XLSX.read(bytes,{cellFormula:true,cellNF:true}),s=book.Sheets['주광·기타 비교'];
 assert.equal(JSON.stringify(f),before);assert.equal(book.SheetNames.length,4);assert.equal(book.Sheets['원본 양식 계산'].A15.v,'주광');
 assert.equal(book.Sheets['원본 양식 계산'].A17.v,'기타');assert.ok(book.Sheets['원본 양식 계산'].T15.f);
 assert.match(s.A3.v,/추정.*실제 업체 귀속 아님/);const refs=Object.keys(s).filter(k=>/^B\d+$/.test(k));
 const r=Number(refs.find(k=>s[k].v==='상품 1').slice(1));assert.equal(s[`E${r}`].v,40);assert.equal(s[`G${r}`].v,10);assert.equal(s[`H${r}`].v,50);
 assert.match(s[`C${r}`].f,/'원본 양식 계산'!M15/);assert.equal(s[`K${r}`].v,'공동 주문');
 const missing=Number(refs.find(k=>s[k].v==='상품 4').slice(1));assert.equal(s[`H${missing}`].v,0);assert.match(s[`H${missing}`].z,/"-"/);assert.equal(s[`C${missing}`].v,'-');
 assert.equal(s.C7.v,121);assert.match(s.D7.f,/COUNTIF/);
 const zip=await JSZip.loadAsync(bytes);assert.match(await zip.file('xl/workbook.xml').async('string'),/activeTab="3"/);
 assert.match(await zip.file('xl/worksheets/sheet4.xml').async('string'),/xSplit="2" ySplit="8"/);
 assert.doesNotMatch(await zip.file('xl/worksheets/sheet3.xml').async('string'),/tabSelected="1"/);
 await assert.rejects(()=>createInvoiceCostWorkbook({...f,nlComparison:{...cmp,orderYear:'2025'}}),/차수/);
 await assert.rejects(()=>createInvoiceCostWorkbook({...f,nlComparison:{...cmp,rows:cmp.rows.map(p=>({...p,current:p.current+1}))}}),/수량/);
});
test('unregistered invoice compares only existing receipts, never promotes invoice quantities to actual',async()=>{
 const f=invoiceCostExportFixture(3,'NL_AMOUNT_V1'),d=data(),cmp=buildNlCustomerComparison({...d,warehouseKey:null,receipts:[]});
 const book=XLSX.read(await createInvoiceCostWorkbook({...f,nlComparison:cmp}));assert.equal(book.Sheets['주광·기타 비교'].C7.v,0);
 for(const name of ['nativeCostHttp.js','invoiceCostPreview.js','invoiceReceiptCostExport.js']){
  const text=readFileSync(new URL(`../lib/${name}`,import.meta.url),'utf8');assert.match(text,/nlComparisonForExport/);assert.match(text,/digest!==/);
 }
});
