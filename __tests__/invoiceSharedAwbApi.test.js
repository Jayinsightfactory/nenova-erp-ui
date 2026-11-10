import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareSharedAwb,createSharedAwbHandler} from '../lib/invoiceSharedAwbApi.js';
import {calculateSharedAwbCost} from '../lib/invoiceSharedAwbCost.js';
import {createSharedAwbCostWorkbook} from '../lib/invoiceReceiptCostExport.js';
import XLSX from 'xlsx';

function fixture(){
 const docs=Array.from({length:13},(_,i)=>({documentId:`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,revision:1,sourceHash:'a'.repeat(64),orderYear:'2026',orderWeek:'45-01',invoiceNo:`INV${i}`,
  reviewedMetadata:{country:'CO',transportMode:'AIR',awb:'160-17338005',farmName:`FARM${i}`,inputDate:'2026-10-30'},
  lines:[{lineId:`11111111-0000-4000-8000-${String(i+1).padStart(12,'0')}`,prodKey:i+1,originalName:'Hydrangea White',outQuantity:10,outUnit:'박스',priceUnit:'송이',currency:'USD',unitPrice:1,lineAmount:300,boxQuantity:10,bunchQuantity:null,stemQuantity:300}]}));
 for(const doc of docs)doc.lines[0].sourceEvidence={packing:{stemsPerBunch:1,stemsPerBox:30}};
 const request={orderYear:'2026',orderWeek:'45-01',awb:'16017338005'};
 const queryFn=async(sql,params)=>{assert.match(sql,/^\/\* invoice-cost:shared-awb-members \*\/ SELECT/);assert.equal(params.orderYear.value,'2026');return{recordset:docs.map(d=>({DocumentId:d.documentId}))};};
 const readDocument=async({documentId})=>docs.find(d=>d.documentId===documentId);
 const readReceipt=async({document})=>({operation:{warehouseKey:docs.indexOf(document)+1},lines:document.lines});
 return{docs,request,queryFn,readDocument,readReceipt,types:{Char:()=>1,VarChar:()=>1}};
}
test('prepare reads every AWB member and revalidates receipts, source digest stable under cost edits',async()=>{
 const f=fixture();const a=await prepareSharedAwb(f);assert.equal(a.members.length,13);
 assert.equal(a.members[0].rows[0].unit,'STEM');assert.equal(a.members[0].rows[0].actualQuantity,300);
 assert.equal(a.members[0].rows[0].receiptUnit,'BOX');assert.equal(f.docs[0].lines[0].bunchQuantity,null);
 f.request.lineInputs=a.members.flatMap(m=>m.rows.map(row=>({lineId:row.lineId,groupId:'HYDRANGEA'})));
 const b=await prepareSharedAwb(f);assert.equal(a.baselineDigest,b.baselineDigest);
 f.docs[0].revision++;assert.notEqual((await prepareSharedAwb(f)).baselineDigest,a.baselineDigest);
 f.docs[0].orderYear='2025';await assert.rejects(()=>prepareSharedAwb(f),/변경/);
});
test('shared workbook has all farms, test-value marking and formula sheets',async()=>{
 const f=fixture(),p=await prepareSharedAwb(f);
 for(const member of p.members)for(const setting of member.lineInputs)setting.groupId='HYDRANGEA';
 const input={gw:3483,cw:4307,freightAmount:12777.65,freightCurrency:'USD',exchangeRate:1400,customsTotalKRW:1000,exchangeRateType:'TEST_ONLY'};
 const result=calculateSharedAwbCost({manifest:p.manifest,members:p.members,input});assert.equal(result.status,'CALCULATED');
 const document={...f.docs[0],receiptStatus:'SHARED_AWB_PREVIEW',receiptLines:p.receiptLines,reviewedMetadata:{...f.docs[0].reviewedMetadata,gw:3483,cw:4307}};
 const bytes=await createSharedAwbCostWorkbook({document,input:{...input,nativeCurrency:'USD',exchangeRateKRW:1400,costGroups:result.costGroups,lineInputs:result.lineInputs},result});
 const book=XLSX.read(bytes,{cellFormula:true});assert.ok(book.SheetNames.length>=3);
 const values=Object.values(book.Sheets[book.SheetNames[0]]).map(c=>c?.v).join('\n');
 assert.match(values,/시험/);for(let i=0;i<13;i++)assert.match(values,new RegExp(`FARM${i} · Hydrangea White`));
 assert.ok(Object.values(book.Sheets['원본 양식 계산']).some(cell=>cell?.f));
});
test('API authorization, stale digest and post-render drift never send download',async()=>{
 const f=fixture(),p=await prepareSharedAwb(f);
 for(const member of p.members)for(const setting of member.lineInputs)setting.groupId='HYDRANGEA';
 const body={action:'download',baselineDigest:p.baselineDigest,completeManifestConfirmed:true,input:{gw:3483,cw:4307,freightAmount:10,freightCurrency:'USD',exchangeRate:1400,customsTotalKRW:0}};
 const response=()=>({code:200,setHeader(){},status(code){this.code=code;return this;},json(data){this.data=data;},send(){throw Error('download should not be sent');}});
 let r=response();await createSharedAwbHandler({authorize:()=>false})({method:'POST',body},r);assert.equal(r.code,403);
 r=response();await createSharedAwbHandler({authorize:()=>true,prepare:async()=>p})({method:'POST',body:{...body,baselineDigest:'stale'}},r);assert.equal(r.code,409);
 let calls=0;r=response();await createSharedAwbHandler({authorize:()=>true,prepare:async()=>++calls===1?p:{...p,baselineDigest:'changed'},generate:async()=>Buffer.from('test')})({method:'POST',body},r);assert.equal(r.code,409);
});

test('production handler exports the same auto-customs input used by preview; approved sources untouched',async()=>{
 const f=fixture(),p=await prepareSharedAwb(f);
 for(const m of p.members)for(const line of m.lineInputs)line.groupId='HYDRANGEA';
 const before=JSON.stringify(p),body={action:'download',baselineDigest:p.baselineDigest,completeManifestConfirmed:true,
  input:{gw:100,cw:120,freightCurrency:'USD',freightAmount:10,exchangeRate:1400,customsMode:'FORMULA',customsTotalKRW:123}};
 let exported;
 const res={setHeader(){},status(code){throw Error(`unexpected ${code}`);},send(){},json(){throw Error('expected xlsx');}};
 await createSharedAwbHandler({authorize:()=>true,prepare:async()=>p,generate:async data=>{exported=data;return Buffer.from('xlsx');}})({method:'POST',body},res);
 assert.equal(exported.input.customsTotalKRW,228000);assert.equal(exported.result.totals.customsKRW,228000);
 assert.equal(exported.input.expenseBasis,'ESTIMATED');assert.equal(JSON.stringify(p),before);
});

test('verified receipt weighted FOB rounding does not mutate the DB snapshot or hide non-rounding errors',async()=>{
 const f=fixture();Object.assign(f.docs[0].lines[0],{stemQuantity:600,lineAmount:206,unitPrice:.3433});
 const p=await prepareSharedAwb(f);assert.equal(p.members[0].rows[0].unitPrice,206/600);assert.equal(f.docs[0].lines[0].unitPrice,.3433);
 f.docs[0].lines[0].unitPrice=.34;assert.equal((await prepareSharedAwb(f)).members[0].rows[0].unitPrice,.34);
});
